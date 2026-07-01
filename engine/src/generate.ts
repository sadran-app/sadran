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
} from './types';
import { availabilityFor, isEligible, type ConstraintContext } from './constraints';
import { candidateScore, undesirableWeight } from './scoring';

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

  // 1. expand demand into unit seats
  const remaining: Slot[] = [];
  for (const d of input.demand) {
    const shift = shiftsById.get(d.shiftId);
    if (!shift) continue;
    for (let i = 0; i < d.count; i++) {
      remaining.push({
        dayIndex: shift.dayIndex,
        shiftId: d.shiftId,
        slotId: d.id,
        roleId: d.roleId,
        startTime: d.startTime,
        endTime: shift.endTime,
      });
    }
  }

  const assignmentsByEmp = new Map<string, EngineAssignment[]>();
  const undesirableByEmp = new Map<string, number>();
  const undesirableCountByEmp = new Map<string, number>();
  for (const e of input.employees) {
    assignmentsByEmp.set(e.id, []);
    undesirableByEmp.set(e.id, 0);
    undesirableCountByEmp.set(e.id, 0);
  }

  const eligibleFor = (slot: Slot): EngineEmployee[] =>
    input.employees.filter((e) => isEligible(e, slot, assignmentsByEmp.get(e.id)!, ctx));

  const assignments: EngineAssignment[] = [];
  const rawGaps: Gap[] = [];

  // 2 + 3. most-constrained-first greedy fill
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestCands: EngineEmployee[] = [];
    let bestCount = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cands = eligibleFor(remaining[i]!);
      if (cands.length < bestCount) {
        bestCount = cands.length;
        bestCands = cands;
        bestIdx = i;
        if (bestCount === 0) break;
      }
    }

    const slot = remaining.splice(bestIdx, 1)[0]!;

    if (bestCands.length === 0) {
      rawGaps.push({ dayIndex: slot.dayIndex, shiftId: slot.shiftId, slotId: slot.slotId, roleId: slot.roleId, startTime: slot.startTime, missing: 1 });
      continue;
    }

    const slotWeight = undesirableWeight(slot, input.weekendDays, input.laborRules);
    let chosen = bestCands[0]!;
    let chosenScore = Infinity;
    for (const e of bestCands) {
      const prefer = availabilityFor(availByEmp, e.id, slot.shiftId) === 'prefer';
      const sc = candidateScore({
        slotWeight,
        empUndesirable: undesirableByEmp.get(e.id)!,
        fairnessCredit: e.fairnessCredit,
        currentCount: assignmentsByEmp.get(e.id)!.length,
        minShifts: e.minShifts,
        prefer,
      });
      if (sc < chosenScore) {
        chosenScore = sc;
        chosen = e;
      }
    }

    const asg: EngineAssignment = {
      employeeId: chosen.id,
      shiftId: slot.shiftId,
      slotId: slot.slotId,
      roleId: slot.roleId,
      dayIndex: slot.dayIndex,
      startTime: slot.startTime,
      endTime: slot.endTime,
    };
    assignments.push(asg);
    assignmentsByEmp.get(chosen.id)!.push(asg);
    if (slotWeight > 0) {
      undesirableByEmp.set(chosen.id, undesirableByEmp.get(chosen.id)! + slotWeight);
      undesirableCountByEmp.set(chosen.id, undesirableCountByEmp.get(chosen.id)! + 1);
    }
  }

  // 4. local-improvement pass (re-validated → never illegal)
  for (const asg of assignments) {
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
      assignmentsByEmp.get(best.id)!.push(asg);
      undesirableByEmp.set(best.id, undesirableByEmp.get(best.id)! + weight);
      undesirableCountByEmp.set(best.id, undesirableCountByEmp.get(best.id)! + 1);
    }
  }

  // aggregate gaps per demand requirement
  const gapMap = new Map<string, Gap>();
  for (const g of rawGaps) {
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
    const total = gaps.reduce((s, g) => s + g.missing, 0);
    warnings.push(`${total} משבצות לא אוישו (${gaps.length} דרישות עם חוסר)`);
  }

  return { assignments, gaps, fairness, warnings };
}
