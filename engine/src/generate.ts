// generateSchedule — deterministic heuristic:
//   1. expand each demand requirement into unit seats
//   2. most-constrained-first: fill the seat with the fewest eligible candidates
//   3. choose the best candidate by soft score
//   4. local-improvement pass to balance undesirable (weekend/closing) load

import type {
  AvailabilityState,
  EngineAssignment,
  EngineEmployee,
  Gap,
  ScheduleInput,
  ScheduleResult,
  Slot,
  ViolationCode,
} from './types';
import { availabilityFor, checkEligibility, clipSlot, isEligible, isForceEligible, type ConstraintContext } from './constraints';
import { candidateScore, undesirableWeight } from './scoring';
import { shiftDuration } from './time';

// Don't schedule anyone for less than this — a sliver of availability isn't a shift.
const MIN_PARTIAL_MINUTES = 60;
// Per uncovered hour, added to a candidate's score so the engine prefers whoever
// covers MORE of the seat (a fully-available person beats a partially-available one),
// while a partial worker still beats leaving the seat empty.
const PARTIAL_PENALTY = 4;

export function generateSchedule(input: ScheduleInput): ScheduleResult {
  const warnings: string[] = [];
  const shiftsById = new Map(input.shifts.map((s) => [s.id, s]));

  const availByEmp = new Map<string, Map<string, AvailabilityState>>();
  for (const a of input.availability) {
    let m = availByEmp.get(a.employeeId);
    if (!m) availByEmp.set(a.employeeId, (m = new Map()));
    m.set(a.shiftId, a.state);
  }
  const ctx: ConstraintContext = { availByEmp, rules: input.laborRules };

  // 1. expand demand into unit seats. Each seat is an interval [origStart, origEnd]
  // to cover; `coverStart` advances as we fill it left-to-right (a seat may be split
  // across several employees, so it can be re-opened for its remainder).
  type OpenSeat = {
    dayIndex: number; shiftId: string; slotId: string; roleId: string;
    origStart: string; origEnd: string; coverStart: string; minLevel: number;
  };
  // required seniority per demand seat — also used to rebuild slots in the later passes.
  const minLevelBySlot = new Map(input.demand.map((d) => [d.id, d.minLevel ?? 1]));

  // manager-pinned assignments occupy seats up front; the greedy fills only the rest.
  const preAssigned = input.preAssigned ?? [];
  const pinnedBySlot = new Map<string, number>();
  for (const p of preAssigned) pinnedBySlot.set(p.slotId, (pinnedBySlot.get(p.slotId) ?? 0) + 1);

  const remaining: OpenSeat[] = [];
  for (const d of input.demand) {
    const shift = shiftsById.get(d.shiftId);
    if (!shift) continue;
    const open = Math.max(0, d.count - (pinnedBySlot.get(d.id) ?? 0));
    for (let i = 0; i < open; i++) {
      remaining.push({
        dayIndex: shift.dayIndex, shiftId: d.shiftId, slotId: d.id, roleId: d.roleId,
        origStart: d.startTime, origEnd: shift.endTime, coverStart: d.startTime, minLevel: d.minLevel ?? 1,
      });
    }
  }
  const residualSlot = (s: OpenSeat): Slot => ({
    dayIndex: s.dayIndex, shiftId: s.shiftId, slotId: s.slotId, roleId: s.roleId,
    startTime: s.coverStart, endTime: s.origEnd, minLevel: s.minLevel,
  });

  const assignmentsByEmp = new Map<string, EngineAssignment[]>();
  const undesirableByEmp = new Map<string, number>();
  const undesirableCountByEmp = new Map<string, number>();
  for (const e of input.employees) {
    assignmentsByEmp.set(e.id, []);
    undesirableByEmp.set(e.id, 0);
    undesirableCountByEmp.set(e.id, 0);
  }

  // A candidate for a seat: the employee plus the exact interval they'd work,
  // already clipped to their free-hours window. `worked` may be a sub-interval of
  // the seat (partial availability); labor-law checks run against that real interval.
  type Cand = { emp: EngineEmployee; worked: Slot };
  const candidatesFor = (seat: Slot): Cand[] => {
    const out: Cand[] = [];
    for (const e of input.employees) {
      const worked = clipSlot(e, seat);
      if (!worked) continue; // window doesn't overlap the seat at all
      if (shiftDuration(worked.startTime, worked.endTime) < MIN_PARTIAL_MINUTES) continue;
      if (isEligible(e, worked, assignmentsByEmp.get(e.id)!, ctx)) out.push({ emp: e, worked });
    }
    return out;
  };

  const assignments: EngineAssignment[] = [];
  const rawGaps: Gap[] = [];

  // Seed pinned assignments as fixed: they count toward each employee's load and
  // occupy their slot, so subsequent fills respect rest/hours/max-shifts around them.
  for (const p of preAssigned) {
    const list = assignmentsByEmp.get(p.employeeId);
    if (!list) continue; // pinned employee no longer active — drop defensively
    const asg: EngineAssignment = { ...p, locked: true };
    assignments.push(asg);
    list.push(asg);
    const w = undesirableWeight(
      { dayIndex: p.dayIndex, shiftId: p.shiftId, slotId: p.slotId, roleId: p.roleId, startTime: p.startTime, endTime: p.endTime ?? p.startTime },
      input.weekendDays,
      input.laborRules,
    );
    if (w > 0) {
      undesirableByEmp.set(p.employeeId, undesirableByEmp.get(p.employeeId)! + w);
      undesirableCountByEmp.set(p.employeeId, undesirableCountByEmp.get(p.employeeId)! + 1);
    }
  }

  // FORCE-FILL: no normally-eligible employee for this seat. Pick the fairest
  // person whose ONLY blockers are relaxable preferences (availability / max
  // shifts) — never a labor-law rule — and assign them, flagged for approval.
  const forceFill = (slot: Slot): boolean => {
    let best: { emp: EngineEmployee; overrides: ViolationCode[]; score: number; count: number } | null = null;
    for (const e of input.employees) {
      const current = assignmentsByEmp.get(e.id)!;
      const res = checkEligibility(e, slot, current, ctx);
      if (!isForceEligible(res)) continue; // role/law/structural block → cannot force
      const count = current.length;
      const overrides = res.violations.map((v) => v.code);
      const overAvail = overrides.includes('availability');
      // Priority (lowest score wins): employees who SUBMITTED availability are forced
      // before employees we have no info about at all. Within each group prefer
      // overriding a max-shift cap over an explicit "cant", then the fairest (least load).
      const unknown = e.availabilityUnknown ? 1_000_000 : 0;
      const score = unknown + (overAvail ? 1000 : 0) + count * 10 + (undesirableByEmp.get(e.id)! + e.fairnessCredit);
      if (!best || score < best.score) best = { emp: e, overrides, score, count };
    }
    if (!best) return false;

    const parts: string[] = [];
    if (best.emp.availabilityUnknown) parts.push('טרם התקבלה ממנו זמינות לשבוע');
    else if (best.overrides.includes('availability')) parts.push('לא סימן זמינות למשמרת זו');
    if (best.overrides.includes('max_shifts')) parts.push('חריגה ממקסימום המשמרות שהוגדר לו');
    const forceReason = `שובץ בכפייה — ${parts.join(' + ') || 'אין מועמד זמין אחר'}. נבחר כבעל העומס ההוגן הנמוך ביותר (${best.count} משמרות השבוע עד כה). כל חוקי העבודה נשמרו.`;

    const slotWeight = undesirableWeight(slot, input.weekendDays, input.laborRules);
    const asg: EngineAssignment = {
      employeeId: best.emp.id, shiftId: slot.shiftId, slotId: slot.slotId, roleId: slot.roleId,
      dayIndex: slot.dayIndex, startTime: slot.startTime, endTime: slot.endTime,
      forced: true, forceReason, overrides: best.overrides,
    };
    assignments.push(asg);
    assignmentsByEmp.get(best.emp.id)!.push(asg);
    if (slotWeight > 0) {
      undesirableByEmp.set(best.emp.id, undesirableByEmp.get(best.emp.id)! + slotWeight);
      undesirableCountByEmp.set(best.emp.id, undesirableCountByEmp.get(best.emp.id)! + 1);
    }
    return true;
  };

  // pick the fairest candidate; a partial one is penalised by its uncovered hours so
  // whoever covers MORE of the remaining interval wins ties on fairness.
  const pickBest = (cands: Cand[], seat: OpenSeat): Cand => {
    const remDur = shiftDuration(seat.coverStart, seat.origEnd);
    let best = cands[0]!;
    let bestScore = Infinity;
    for (const c of cands) {
      const covDur = shiftDuration(c.worked.startTime, c.worked.endTime);
      const slotWeight = undesirableWeight(c.worked, input.weekendDays, input.laborRules);
      const prefer = availabilityFor(availByEmp, c.emp.id, seat.shiftId) === 'prefer';
      let sc = candidateScore({
        slotWeight,
        empUndesirable: undesirableByEmp.get(c.emp.id)!,
        fairnessCredit: c.emp.fairnessCredit,
        currentCount: assignmentsByEmp.get(c.emp.id)!.length,
        minShifts: c.emp.minShifts,
        prefer,
      });
      sc += ((remDur - covDur) / 60) * PARTIAL_PENALTY;
      if (sc < bestScore) { bestScore = sc; best = c; }
    }
    return best;
  };

  const assignPiece = (seat: OpenSeat, c: Cand) => {
    const worked = c.worked;
    const partial = !(worked.startTime === seat.origStart && worked.endTime === seat.origEnd);
    const slotWeight = undesirableWeight(worked, input.weekendDays, input.laborRules);
    const asg: EngineAssignment = {
      employeeId: c.emp.id, shiftId: seat.shiftId, slotId: seat.slotId, roleId: seat.roleId,
      dayIndex: seat.dayIndex, startTime: worked.startTime, endTime: worked.endTime,
      partial: partial || undefined,
    };
    assignments.push(asg);
    assignmentsByEmp.get(c.emp.id)!.push(asg);
    if (slotWeight > 0) {
      undesirableByEmp.set(c.emp.id, undesirableByEmp.get(c.emp.id)! + slotWeight);
      undesirableCountByEmp.set(c.emp.id, undesirableCountByEmp.get(c.emp.id)! + 1);
    }
    if (worked.endTime < seat.origEnd) { seat.coverStart = worked.endTime; remaining.push(seat); } // reopen the remainder
  };

  // 2 + 3. most-constrained-first greedy fill, covering each seat left-to-right.
  // Priority per the manager's rule: (a) an employee who covers the WHOLE remaining
  // interval, else (b) split it among employees who cover part, else (c) force-fill.
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestFronts: Cand[] = [];
    let bestCands: Cand[] = [];
    let bestCount = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cands = candidatesFor(residualSlot(remaining[i]!));
      const fronts = cands.filter((c) => c.worked.startTime === remaining[i]!.coverStart);
      if (fronts.length < bestCount) {
        bestCount = fronts.length;
        bestFronts = fronts;
        bestCands = cands;
        bestIdx = i;
        if (bestCount === 0) break;
      }
    }

    const seat = remaining.splice(bestIdx, 1)[0]!;
    const fullFronts = bestFronts.filter((c) => c.worked.endTime === seat.origEnd);

    if (fullFronts.length > 0) {
      assignPiece(seat, pickBest(fullFronts, seat)); // (a) one employee finishes the seat
    } else if (bestFronts.length > 0) {
      assignPiece(seat, pickBest(bestFronts, seat)); // (b) split — take the front piece, re-open remainder
    } else {
      // (c) nobody can start at coverStart. Force-fill (or gap) only up to the next
      // employee who CAN cover a later part, so those partial workers still get used.
      let nextStart = seat.origEnd;
      for (const c of bestCands) if (c.worked.startTime > seat.coverStart && c.worked.startTime < nextStart) nextStart = c.worked.startTime;
      const hole: Slot = { dayIndex: seat.dayIndex, shiftId: seat.shiftId, slotId: seat.slotId, roleId: seat.roleId, startTime: seat.coverStart, endTime: nextStart, minLevel: seat.minLevel };
      if (!forceFill(hole)) {
        rawGaps.push({ dayIndex: seat.dayIndex, shiftId: seat.shiftId, slotId: seat.slotId, roleId: seat.roleId, startTime: seat.coverStart, endTime: nextStart, missing: 1 });
      }
      if (nextStart < seat.origEnd) { seat.coverStart = nextStart; remaining.push(seat); }
    }
  }

  // ---- shared mutators for the improvement passes (keep the maps consistent) ----
  const slotOf = (a: EngineAssignment): Slot => ({ dayIndex: a.dayIndex, shiftId: a.shiftId, slotId: a.slotId, roleId: a.roleId, startTime: a.startTime, endTime: a.endTime, minLevel: minLevelBySlot.get(a.slotId) ?? 1 });
  const place = (empId: string, slot: Slot): EngineAssignment => {
    const asg: EngineAssignment = { employeeId: empId, shiftId: slot.shiftId, slotId: slot.slotId, roleId: slot.roleId, dayIndex: slot.dayIndex, startTime: slot.startTime, endTime: slot.endTime };
    assignments.push(asg);
    assignmentsByEmp.get(empId)!.push(asg);
    const w = undesirableWeight(slot, input.weekendDays, input.laborRules);
    if (w > 0) { undesirableByEmp.set(empId, undesirableByEmp.get(empId)! + w); undesirableCountByEmp.set(empId, undesirableCountByEmp.get(empId)! + 1); }
    return asg;
  };
  const unplace = (a: EngineAssignment) => {
    const list = assignmentsByEmp.get(a.employeeId)!; const i = list.indexOf(a); if (i >= 0) list.splice(i, 1);
    const j = assignments.indexOf(a); if (j >= 0) assignments.splice(j, 1);
    const w = undesirableWeight(slotOf(a), input.weekendDays, input.laborRules);
    if (w > 0) { undesirableByEmp.set(a.employeeId, undesirableByEmp.get(a.employeeId)! - w); undesirableCountByEmp.set(a.employeeId, undesirableCountByEmp.get(a.employeeId)! - 1); }
  };
  // employees who can legally & FULLY cover a slot right now (optionally excluding one)
  const fullCoverers = (slot: Slot, exclude?: string): Cand[] =>
    candidatesFor(slot).filter((c) => c.emp.id !== exclude && c.worked.startTime === slot.startTime && c.worked.endTime === slot.endTime);
  const pickFair = (cands: Cand[]): Cand => {
    let best = cands[0]!, bs = Infinity;
    for (const c of cands) { const sc = undesirableByEmp.get(c.emp.id)! + c.emp.fairnessCredit + assignmentsByEmp.get(c.emp.id)!.length * 0.5; if (sc < bs) { bs = sc; best = c; } }
    return best;
  };

  // 3b. GAP REPAIR — fill a leftover gap by a single LEGAL reshuffle (augmenting swap):
  // if employee E could cover the gap after one of their shifts is handed to someone
  // else who can fully cover it, do that chain. Never breaks a rule (all re-validated).
  const repairGap = (g: Gap): boolean => {
    if (!g.endTime) return false;
    const slot: Slot = { dayIndex: g.dayIndex, shiftId: g.shiftId, slotId: g.slotId, roleId: g.roleId, startTime: g.startTime, endTime: g.endTime };
    const direct = fullCoverers(slot);
    if (direct.length) { place(pickFair(direct).emp.id, slot); return true; }
    for (const e of input.employees) {
      const worked = clipSlot(e, slot);
      if (!worked || worked.startTime !== slot.startTime || worked.endTime !== slot.endTime) continue;
      const cur = assignmentsByEmp.get(e.id)!;
      for (const a of [...cur]) {
        if (a.locked) continue; // never hand off a pinned shift
        if (!isEligible(e, slot, cur.filter((x) => x !== a), ctx)) continue;
        const repl = fullCoverers(slotOf(a), e.id);
        if (repl.length) { unplace(a); place(pickFair(repl).emp.id, slotOf(a)); place(e.id, slot); return true; }
      }
    }
    return false;
  };
  const repaired = new Set<Gap>();
  for (const g of rawGaps) if (repairGap(g)) repaired.add(g);

  // 3c. MIN-SHIFTS — give an employee below their minimum more shifts by swapping in
  // for an over-minimum holder they can fully cover (net coverage unchanged; never
  // pushes the holder below THEIR minimum, never breaks a rule).
  for (const e of input.employees) {
    let held = assignmentsByEmp.get(e.id)!.length;
    if (held >= e.minShifts) continue;
    for (const a of [...assignments]) {
      if (held >= e.minShifts) break;
      if (a.employeeId === e.id || a.locked) continue; // don't displace a pinned holder
      const holderList = assignmentsByEmp.get(a.employeeId)!;
      const holder = input.employees.find((x) => x.id === a.employeeId);
      if (!holder || holderList.length <= holder.minShifts) continue;
      const slot = slotOf(a);
      const w = clipSlot(e, slot);
      if (!w || w.startTime !== slot.startTime || w.endTime !== slot.endTime) continue;
      if (!isEligible(e, slot, assignmentsByEmp.get(e.id)!, ctx)) continue;
      unplace(a); place(e.id, slot); held++;
    }
  }

  // 4. local-improvement pass (re-validated → never illegal)
  for (const asg of assignments) {
    if (asg.locked) continue; // pinned — never rebalanced away
    const slot: Slot = { dayIndex: asg.dayIndex, shiftId: asg.shiftId, slotId: asg.slotId, roleId: asg.roleId, startTime: asg.startTime, endTime: asg.endTime };
    const weight = undesirableWeight(slot, input.weekendDays, input.laborRules);
    if (weight === 0) continue;

    const holderId = asg.employeeId;
    const holder = input.employees.find((e) => e.id === holderId)!;
    const holderLoad = undesirableByEmp.get(holderId)! + holder.fairnessCredit;

    let best: EngineEmployee | null = null;
    let bestResultingLoad = holderLoad;
    for (const e of input.employees) {
      if (e.id === holderId) continue;
      const resulting = undesirableByEmp.get(e.id)! + e.fairnessCredit + weight;
      if (resulting >= bestResultingLoad) continue;
      // the replacement must be able to work this exact interval (not just part of it)
      const cs = clipSlot(e, slot);
      if (!cs || cs.startTime !== slot.startTime || cs.endTime !== slot.endTime) continue;
      if (!isEligible(e, slot, assignmentsByEmp.get(e.id)!, ctx)) continue;
      best = e;
      bestResultingLoad = resulting;
    }

    if (best) {
      const holderList = assignmentsByEmp.get(holderId)!;
      holderList.splice(holderList.indexOf(asg), 1);
      undesirableByEmp.set(holderId, undesirableByEmp.get(holderId)! - weight);
      undesirableCountByEmp.set(holderId, undesirableCountByEmp.get(holderId)! - 1);

      asg.employeeId = best.id;
      asg.forced = false; // new holder is normally eligible → no longer a forced seat
      asg.forceReason = undefined;
      asg.overrides = undefined;
      assignmentsByEmp.get(best.id)!.push(asg);
      undesirableByEmp.set(best.id, undesirableByEmp.get(best.id)! + weight);
      undesirableCountByEmp.set(best.id, undesirableCountByEmp.get(best.id)! + 1);
    }
  }

  // aggregate gaps per demand requirement — excluding any we repaired via reshuffle
  const gapMap = new Map<string, Gap>();
  for (const g of rawGaps) {
    if (repaired.has(g)) continue;
    const ex = gapMap.get(g.slotId);
    if (ex) ex.missing += 1;
    else gapMap.set(g.slotId, { ...g });
  }

  const fairness = input.employees.map((e) => ({
    employeeId: e.id,
    undesirableLoad: undesirableByEmp.get(e.id)!,
    count: undesirableCountByEmp.get(e.id)!,
  }));

  for (const e of input.employees) {
    const c = assignmentsByEmp.get(e.id)!.length;
    if (c < e.minShifts) warnings.push(`עובד ${e.name} מתחת ל-minShifts (${c}/${e.minShifts})`);
  }
  const gaps = [...gapMap.values()];
  if (gaps.length > 0) {
    // Diagnose WHY each gap survived — a surviving gap means even force-fill (which
    // relaxes availability / max-shifts) found no one, so it's a role gap or everyone
    // is blocked by a labor LAW. This is what tells the manager what to actually fix.
    const HEB_DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const HEB_CODE: Record<string, string> = { rest: 'מנוחה בין משמרות', curfew: 'עוצר קטינים', max_daily_hours: 'מקס׳ שעות ליום', max_weekly_hours: 'מקס׳ שעות לשבוע', overlap: 'חפיפה בין משמרות', level: 'דרושה בכירות גבוהה יותר', max_consecutive: 'חריגה ממקס׳ ימים רצופים', time_off: 'חופשה/מילואים מאושרים' };
    for (const g of gaps) {
      const gSlot: Slot = { dayIndex: g.dayIndex, shiftId: g.shiftId, slotId: g.slotId, roleId: g.roleId, startTime: g.startTime, endTime: g.endTime ?? shiftsById.get(g.shiftId)?.endTime ?? g.startTime };
      const withRole = input.employees.filter((e) => e.roleIds.includes(g.roleId));
      if (!withRole.length) g.reason = 'אין עובד עם התפקיד הנדרש';
      else {
        const codes = new Set<string>();
        for (const e of withRole) for (const v of checkEligibility(e, gSlot, assignmentsByEmp.get(e.id)!, ctx).violations) {
          if (v.code !== 'availability' && v.code !== 'max_shifts' && v.code !== 'same_shift' && v.code !== 'role') codes.add(v.code);
        }
        g.reason = codes.size ? `כל המתאימים חסומים: ${[...codes].map((c) => HEB_CODE[c] ?? c).join(', ')}` : 'אין מספיק עובדים זמינים';
      }
    }
    const total = gaps.reduce((s, g) => s + g.missing, 0);
    warnings.push(`${total} משבצות לא אוישו (${gaps.length} דרישות עם חוסר)`);
    for (const g of gaps.slice(0, 8)) warnings.push(`חוסר: יום ${HEB_DAY[g.dayIndex]} · ${g.startTime}–${g.endTime ?? ''} (חסרים ${g.missing}) — ${g.reason}`);
  }
  // some seats were staffed by splitting the hours between employees (partial
  // availability) — worth a heads-up so the manager can eyeball the handoffs.
  const partialCount = assignments.filter((a) => a.partial).length;
  if (partialCount > 0) {
    warnings.push(`${partialCount} שיבוצים חלקיים — משבצות אחת או יותר חולקו בין עובדים לפי שעות הזמינות שלהם`);
  }

  return { assignments, gaps, fairness, warnings };
}
