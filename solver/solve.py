#!/usr/bin/env python3
"""
Optimal shift-scheduler — the "math brain" (layer 2 on top of the greedy engine).

Reads a ScheduleInput JSON on stdin, returns a ScheduleResult JSON on stdout
(same contract as engine/src/types.ts). Uses Google OR-Tools CP-SAT to find a
PROVABLY optimal assignment under a lexicographic objective:

    1. maximum coverage        (fewest uncovered seats)
    2. minimum forced          (fewest availability / max-shift overrides)
    3. fairest undesirable load (minimise the worst-off employee — minimax)
    4. honour preferences       (bonus for "prefer" shifts)

Hard constraints are NEVER violated (role, rest, curfew, daily/weekly hours,
overlap, same-shift) — exactly the labour-law rules the greedy engine enforces.

v1 note: this is a WHOLE-SEAT model — an employee covers a demand's full interval
or not at all. Free-hours windows are honoured as a hard limit (you can't work
outside your hours), but partial-hour SPLITTING of one seat across two employees
is a greedy-only feature for now; here such a seat may be left as a gap instead.

All logs go to stderr; stdout carries ONLY the result JSON.
"""

import sys
import json


def to_min(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def dur(start: str, end: str) -> int:
    a, b = to_min(start), to_min(end)
    if b <= a:  # overnight — ends next day
        b += 1440
    return b - a


def abs_start(day: int, start: str) -> int:
    return day * 1440 + to_min(start)


def abs_end(day: int, start: str, end: str) -> int:
    return abs_start(day, start) + dur(start, end)


def end_hour(start: str, end: str) -> float:
    a, b = to_min(start), to_min(end)
    if b <= a:
        b += 1440
    return b / 60.0


HEB_DAY = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"]

# Objective weights — separated by orders of magnitude so the sum behaves
# lexicographically: coverage dominates everything, then forced, etc.
W_GAP = 1_000_000      # one uncovered seat is worse than any amount of the rest
W_UNKNOWN = 10_000     # scheduling someone we have NO availability info about
W_CANT = 5_000         # scheduling someone who said "can't" for this shift
W_OVERMAX = 1_000      # a shift beyond the employee's personal max
W_UNDER = 500          # a shift below the employee's personal minimum
W_FAIR = 50            # balancing the worst-off undesirable load
W_PREFER = 1           # small bonus for honouring a "prefer"


def solve(inp: dict) -> dict:
    from ortools.sat.python import cp_model

    shifts = {s["id"]: s for s in inp["shifts"]}
    emps = inp["employees"]
    rules = inp["laborRules"]
    weekend = set(inp["weekendDays"])

    # availability: (empId, shiftId) -> 'ok' | 'prefer' | 'cant'
    avail = {(a["employeeId"], a["shiftId"]): a["state"] for a in inp["availability"]}

    def category(e: dict, shift_id: str) -> str:
        """How the engine sees this (employee, shift): ok/prefer/cant/unknown."""
        st = avail.get((e["id"], shift_id))
        if st:
            return st
        return "unknown" if e.get("availabilityUnknown") else "ok"

    def window(e: dict, day: int):
        for w in (e.get("dayWindows") or []):
            if w["dayIndex"] == day:
                return w
        return None

    # expand demand rows into meta (one row can require `count` seats)
    demands = []
    for d in inp["demand"]:
        sh = shifts.get(d["shiftId"])
        if not sh:
            continue
        day, start, end = sh["dayIndex"], d["startTime"], sh["endTime"]
        demands.append({
            "id": d["id"], "shiftId": d["shiftId"], "roleId": d["roleId"],
            "dayIndex": day, "startTime": start, "endTime": end, "count": d["count"],
            "aStart": abs_start(day, start), "aEnd": abs_end(day, start, end),
            "minutes": dur(start, end), "minLevel": d.get("minLevel") or 1,
            "weight": (1 if day in weekend else 0)
                      + (1 if end_hour(start, end) >= rules["closingHour"] else 0),
        })

    # manager-pinned (locked) pre-assignments — fixed occupancy the solver must respect.
    emp_idx = {e["id"]: i for i, e in enumerate(emps)}
    pinned_by_emp = {}   # ei -> [{shiftId, aStart, aEnd, minutes, dayIndex, weight}]
    pinned_by_slot = {}  # slotId -> count
    for p in (inp.get("preAssigned") or []):
        ei = emp_idx.get(p["employeeId"])
        if ei is None:
            continue
        day = p["dayIndex"]
        st = p["startTime"]
        en = p.get("endTime") or shifts.get(p["shiftId"], {}).get("endTime", st)
        pinned_by_emp.setdefault(ei, []).append({
            "shiftId": p["shiftId"], "aStart": abs_start(day, st), "aEnd": abs_end(day, st, en),
            "minutes": dur(st, en), "dayIndex": day,
            "weight": (1 if day in weekend else 0) + (1 if end_hour(st, en) >= rules["closingHour"] else 0),
        })
        pinned_by_slot[p["slotId"]] = pinned_by_slot.get(p["slotId"], 0) + 1
    for d in demands:  # pinned seats are already filled — the solver fills only the rest
        d["count"] = max(0, d["count"] - pinned_by_slot.get(d["id"], 0))

    def pin_conflict(ei, d):
        """True if demand d clashes (same-shift / overlap / rest) with a pinned shift of ei."""
        rest_min = rules["minRestHours"] * 60
        for pp in pinned_by_emp.get(ei, []):
            if pp["shiftId"] == d["shiftId"]:
                return True
            if d["aStart"] < pp["aEnd"] and pp["aStart"] < d["aEnd"]:
                return True
            g = (d["aStart"] - pp["aEnd"]) if d["aStart"] >= pp["aEnd"] else (pp["aStart"] - d["aEnd"])
            if g < rest_min:
                return True
        return False

    model = cp_model.CpModel()
    x = {}            # (ei, di) -> BoolVar
    elig = {di: [] for di in range(len(demands))}  # di -> list of eligible ei

    for di, d in enumerate(demands):
        for ei, e in enumerate(emps):
            if d["roleId"] not in e["roleIds"]:
                continue  # role — hard
            if e["isMinor"] and end_hour(d["startTime"], d["endTime"]) > rules["minorCurfewHour"]:
                continue  # curfew — hard (law)
            if (e.get("roleLevels") or {}).get(d["roleId"], 1) < d["minLevel"]:
                continue  # below the seat's required seniority — hard (3.3)
            if d["dayIndex"] in (e.get("blockedDays") or []):
                continue  # approved time-off / reserve duty that day — hard (3.1)
            w = window(e, d["dayIndex"])
            if w and to_min(d["endTime"]) > to_min(d["startTime"]):  # skip window on overnight seats
                if not (to_min(w["fromTime"]) <= to_min(d["startTime"])
                        and to_min(w["toTime"]) >= to_min(d["endTime"])):
                    continue  # free-hours window doesn't fully cover the seat — hard
            if pin_conflict(ei, d):
                continue  # clashes with one of this employee's pinned shifts
            v = model.NewBoolVar(f"x_{ei}_{di}")
            x[(ei, di)] = v
            elig[di].append(ei)

    # coverage: assigned + gap == count
    gap = {}
    for di, d in enumerate(demands):
        g = model.NewIntVar(0, d["count"], f"gap_{di}")
        gap[di] = g
        model.Add(sum(x[(ei, di)] for ei in elig[di]) + g == d["count"])

    obj = []
    for di in gap:
        obj.append(W_GAP * gap[di])

    # per-assignment soft costs (forced / preference)
    for (ei, di), v in x.items():
        cat = category(emps[ei], demands[di]["shiftId"])
        if cat == "unknown":
            obj.append(W_UNKNOWN * v)
        elif cat == "cant":
            obj.append(W_CANT * v)
        elif cat == "prefer":
            obj.append(-W_PREFER * v)

    # fairness minimax bound
    max_load_ub = sum(d["weight"] * d["count"] for d in demands) \
        + max((round(e.get("fairnessCredit", 0)) for e in emps), default=0) + 1
    lmax = model.NewIntVar(0, max(max_load_ub, 1), "lmax")

    # per-employee hard constraints + soft over/under + fairness
    for ei, e in enumerate(emps):
        mine = [di for di in range(len(demands)) if (ei, di) in x]

        # same-shift: at most one seat per shift segment
        by_shift = {}
        for di in mine:
            by_shift.setdefault(demands[di]["shiftId"], []).append(di)
        for dis in by_shift.values():
            if len(dis) > 1:
                model.Add(sum(x[(ei, di)] for di in dis) <= 1)

        # overlap + rest: at most one of any too-close pair (different shifts)
        rest_min = rules["minRestHours"] * 60
        for a_i in range(len(mine)):
            for b_i in range(a_i + 1, len(mine)):
                d1, d2 = demands[mine[a_i]], demands[mine[b_i]]
                if d1["shiftId"] == d2["shiftId"]:
                    continue
                overlap = d1["aStart"] < d2["aEnd"] and d2["aStart"] < d1["aEnd"]
                if overlap:
                    model.Add(x[(ei, mine[a_i])] + x[(ei, mine[b_i])] <= 1)
                    continue
                gap_between = (d2["aStart"] - d1["aEnd"]) if d2["aStart"] >= d1["aEnd"] \
                    else (d1["aStart"] - d2["aEnd"])
                if gap_between < rest_min:
                    model.Add(x[(ei, mine[a_i])] + x[(ei, mine[b_i])] <= 1)

        pins = pinned_by_emp.get(ei, [])
        pin_shifts = len(pins)

        # daily hours cap (law) — pinned minutes already consume the day's budget
        by_day = {}
        for di in mine:
            by_day.setdefault(demands[di]["dayIndex"], []).append(di)
        for day, dis in by_day.items():
            pin_day = sum(pp["minutes"] for pp in pins if pp["dayIndex"] == day)
            model.Add(sum(demands[di]["minutes"] * x[(ei, di)] for di in dis)
                      <= rules["maxDailyHours"] * 60 - pin_day)

        # weekly hours cap (law)
        pin_week = sum(pp["minutes"] for pp in pins)
        if mine:
            model.Add(sum(demands[di]["minutes"] * x[(ei, di)] for di in mine)
                      <= rules["maxWeeklyHours"] * 60 - pin_week)

        # 3.3 — max consecutive worked days. y[day]=1 iff the employee works that day
        # (from x or a pinned shift); no window of (cap+1) days may all be worked.
        cap = e.get("maxConsecutiveDays")
        if cap is not None and mine:
            pin_days = {pp["dayIndex"] for pp in pins}
            y = {}
            for day in range(7):
                yv = model.NewBoolVar(f"y_{ei}_{day}")
                y[day] = yv
                if day in pin_days:
                    model.Add(yv == 1)  # a pinned shift fixes this day as worked
                else:
                    for di in by_day.get(day, []):
                        model.Add(yv >= x[(ei, di)])
            for s in range(0, 7 - cap):
                model.Add(sum(y[day] for day in range(s, s + cap + 1)) <= cap)

        total = sum(x[(ei, di)] for di in mine) if mine else 0

        # max_shifts — soft (relaxable, like force-fill). Pinned count toward the cap.
        over = model.NewIntVar(0, (len(mine) if mine else 0) + pin_shifts, f"over_{ei}")
        model.Add(over >= total + pin_shifts - e["maxShifts"])
        obj.append(W_OVERMAX * over)

        # min_shifts — soft
        under = model.NewIntVar(0, e["minShifts"], f"under_{ei}")
        model.Add(under >= e["minShifts"] - total - pin_shifts)
        obj.append(W_UNDER * under)

        # fairness: worst-off undesirable load (this cycle + historical credit + pinned)
        credit = round(e.get("fairnessCredit", 0))
        pin_load = sum(pp["weight"] for pp in pins)
        load_expr = sum(demands[di]["weight"] * x[(ei, di)] for di in mine) if mine else 0
        model.Add(lmax >= load_expr + credit + pin_load)

    obj.append(W_FAIR * lmax)
    model.Minimize(sum(obj))

    solver = cp_model.CpSolver()
    # Bound worst-case latency on large orgs (the 3-year pilot saw a 15s spike at ~50
    # employees x 168 seats). Typical instances prove optimal in well under a second;
    # this cap only trims the tail on the hardest instances, still returning a good result.
    n_vars = len(x)
    solver.parameters.max_time_in_seconds = 6.0 if n_vars > 3000 else 9.0
    solver.parameters.num_search_workers = 1   # single worker => fully deterministic
    solver.parameters.random_seed = 1
    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"solver returned {status_name}")

    # per-employee totals (to flag over-max assignments) — pinned count too
    emp_total = [len(pinned_by_emp.get(i, [])) for i in range(len(emps))]
    for (ei, di), v in x.items():
        if solver.Value(v) == 1:
            emp_total[ei] += 1

    assignments = []
    # pinned assignments are fixed — emit them verbatim so the caller keeps them
    for p in (inp.get("preAssigned") or []):
        if p["employeeId"] not in emp_idx:
            continue
        a = {
            "employeeId": p["employeeId"], "shiftId": p["shiftId"], "slotId": p["slotId"],
            "roleId": p["roleId"], "dayIndex": p["dayIndex"],
            "startTime": p["startTime"], "endTime": p.get("endTime"), "locked": True,
        }
        if p.get("forced"):
            a["forced"] = True
            a["forceReason"] = p.get("forceReason")
        assignments.append(a)
    for (ei, di), v in x.items():
        if solver.Value(v) != 1:
            continue
        e, d = emps[ei], demands[di]
        cat = category(e, d["shiftId"])
        over_max = emp_total[ei] > e["maxShifts"]
        overrides = []
        parts = []
        if cat == "unknown":
            overrides.append("availability"); parts.append("טרם התקבלה ממנו זמינות לשבוע")
        elif cat == "cant":
            overrides.append("availability"); parts.append("לא סימן זמינות למשמרת זו")
        if over_max:
            overrides.append("max_shifts"); parts.append("חריגה ממקסימום המשמרות שהוגדר לו")
        forced = len(overrides) > 0
        asg = {
            "employeeId": e["id"], "shiftId": d["shiftId"], "slotId": d["id"],
            "roleId": d["roleId"], "dayIndex": d["dayIndex"],
            "startTime": d["startTime"], "endTime": d["endTime"],
        }
        if forced:
            asg["forced"] = True
            asg["forceReason"] = ("שובץ בכפייה (פתרון אופטימלי) — "
                                  + " + ".join(parts)
                                  + ". כל חוקי העבודה נשמרו.")
            asg["overrides"] = overrides
        assignments.append(asg)

    # gaps — uncovered seats, with an actionable reason
    gaps = []
    for di, d in enumerate(demands):
        gv = solver.Value(gap[di])
        if gv <= 0:
            continue
        with_role = [e for e in emps if d["roleId"] in e["roleIds"]]
        reason = ("אין עובד עם התפקיד הנדרש" if not with_role
                  else "כל המתאימים חסומים בחוקי עבודה או מחוץ לשעות הזמינות")
        gaps.append({
            "dayIndex": d["dayIndex"], "shiftId": d["shiftId"], "slotId": d["id"],
            "roleId": d["roleId"], "startTime": d["startTime"], "endTime": d["endTime"],
            "missing": gv, "reason": reason,
        })

    fairness = []
    for ei, e in enumerate(emps):
        pins = pinned_by_emp.get(ei, [])
        load = sum(demands[di]["weight"] for di in range(len(demands))
                   if (ei, di) in x and solver.Value(x[(ei, di)]) == 1) + sum(pp["weight"] for pp in pins)
        count = sum(1 for di in range(len(demands))
                    if (ei, di) in x and solver.Value(x[(ei, di)]) == 1
                    and demands[di]["weight"] > 0) + sum(1 for pp in pins if pp["weight"] > 0)
        fairness.append({"employeeId": e["id"], "undesirableLoad": load, "count": count})

    warnings = []
    total_gap = sum(g["missing"] for g in gaps)
    if total_gap > 0:
        warnings.append(f"{total_gap} משבצות לא אוישו ({len(gaps)} דרישות עם חוסר)")
        for g in gaps[:8]:
            warnings.append(f"חוסר: יום {HEB_DAY[g['dayIndex']]} · {g['startTime']}–{g['endTime']} "
                            f"(חסרים {g['missing']}) — {g['reason']}")
    forced_count = sum(1 for a in assignments if a.get("forced"))
    if forced_count > 0:
        warnings.append(f"{forced_count} שיבוצים בכפייה — דורשים אישור מנהל")
    opt = "אופטימום מוכח" if status == cp_model.OPTIMAL else "פתרון חלקי (נעצר בזמן)"
    warnings.append(f"מנוע אופטימלי (CP-SAT) · {opt} · {solver.WallTime():.2f}s")

    return {"assignments": assignments, "gaps": gaps, "fairness": fairness, "warnings": warnings}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        raw = sys.stdin.buffer.read().decode("utf-8")
        inp = json.loads(raw)
        result = solve(inp)
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.flush()
        return 0
    except Exception as exc:  # any failure -> Node falls back to the greedy engine
        sys.stderr.write(f"solver error: {exc}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
