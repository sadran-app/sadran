// Hard constraints — NEVER violated. Each is a pure predicate so it can be
// unit-tested in isolation and reused by the swap-eligibility check.

import type {
  AvailabilityState,
  EligibilityResult,
  EngineAssignment,
  EngineEmployee,
  LaborRules,
  Slot,
  Violation,
} from './types';
import { absStart, absEnd, endHour } from './time';

const hoursOf = (a: { dayIndex: number; startTime: string; endTime: string }) =>
  (absEnd(a.dayIndex, a.startTime, a.endTime) - absStart(a.dayIndex, a.startTime)) / 60;

export interface ConstraintContext {
  availByEmp: Map<string, Map<string, AvailabilityState>>; // emp -> shiftId -> state
  rules: LaborRules;
}

export function hasRole(emp: EngineEmployee, roleId: string): boolean {
  return emp.roleIds.includes(roleId);
}

export function availabilityFor(
  availByEmp: Map<string, Map<string, AvailabilityState>>,
  employeeId: string,
  shiftId: string,
): AvailabilityState {
  // Missing availability is treated as 'ok' (available unless the employee said "cant").
  return availByEmp.get(employeeId)?.get(shiftId) ?? 'ok';
}

export function isAvailable(state: AvailabilityState): boolean {
  return state !== 'cant';
}

export function underMaxShifts(current: EngineAssignment[], emp: EngineEmployee): boolean {
  return current.length < emp.maxShifts;
}

/** An employee cannot be assigned to the same shift segment twice. */
export function notSameShift(current: EngineAssignment[], slot: Slot): boolean {
  return !current.some((a) => a.shiftId === slot.shiftId);
}

/** Minimum rest between this new seat and every seat the employee already holds. */
export function restRespected(
  current: EngineAssignment[],
  slot: Slot,
  minRestHours: number,
): boolean {
  const newStart = absStart(slot.dayIndex, slot.startTime);
  const newEnd = absEnd(slot.dayIndex, slot.startTime, slot.endTime);
  const restMin = minRestHours * 60;
  for (const a of current) {
    const s = absStart(a.dayIndex, a.startTime);
    const e = absEnd(a.dayIndex, a.startTime, a.endTime);
    const gap = newStart >= e ? newStart - e : s - newEnd;
    if (gap < restMin) return false;
  }
  return true;
}

/** A minor's shift must end at or before the curfew hour. */
export function curfewRespected(emp: EngineEmployee, slot: Slot, minorCurfewHour: number): boolean {
  if (!emp.isMinor) return true;
  return endHour(slot.startTime, slot.endTime) <= minorCurfewHour;
}

/**
 * The single source of truth for eligibility. Returns EVERY reason an employee
 * can't take this seat (not just the first), so the UI can explain exactly why.
 */
export function checkEligibility(
  emp: EngineEmployee,
  slot: Slot,
  current: EngineAssignment[],
  ctx: ConstraintContext,
): EligibilityResult {
  const v: Violation[] = [];
  const { rules } = ctx;

  if (!hasRole(emp, slot.roleId)) v.push({ code: 'role' });
  if (!isAvailable(availabilityFor(ctx.availByEmp, emp.id, slot.shiftId))) v.push({ code: 'availability' });
  if (!underMaxShifts(current, emp)) v.push({ code: 'max_shifts' });
  if (!notSameShift(current, slot)) v.push({ code: 'same_shift' });
  if (!curfewRespected(emp, slot, rules.minorCurfewHour)) v.push({ code: 'curfew' });

  // time-conflict checks against every shift the employee already holds
  const newStart = absStart(slot.dayIndex, slot.startTime);
  const newEnd = absEnd(slot.dayIndex, slot.startTime, slot.endTime);
  const restMin = rules.minRestHours * 60;
  for (const a of current) {
    if (a.shiftId === slot.shiftId) continue; // reported as same_shift already
    const s = absStart(a.dayIndex, a.startTime);
    const e = absEnd(a.dayIndex, a.startTime, a.endTime);
    if (newStart < e && s < newEnd) {
      v.push({ code: 'overlap', conflictDayIndex: a.dayIndex, conflictStart: a.startTime });
      continue;
    }
    const gap = newStart >= e ? newStart - e : s - newEnd;
    if (gap < restMin) v.push({ code: 'rest', conflictDayIndex: a.dayIndex, conflictStart: a.startTime });
  }

  // hours caps
  const newHours = (newEnd - newStart) / 60;
  const dayHours = current.filter((a) => a.dayIndex === slot.dayIndex).reduce((sum, a) => sum + hoursOf(a), 0);
  if (dayHours + newHours > rules.maxDailyHours) v.push({ code: 'max_daily_hours' });
  const weekHours = current.reduce((sum, a) => sum + hoursOf(a), 0);
  if (weekHours + newHours > rules.maxWeeklyHours) v.push({ code: 'max_weekly_hours' });

  return { ok: v.length === 0, violations: v };
}

/** Boolean convenience wrapper over checkEligibility. */
export function isEligible(emp: EngineEmployee, slot: Slot, current: EngineAssignment[], ctx: ConstraintContext): boolean {
  return checkEligibility(emp, slot, current, ctx).ok;
}
