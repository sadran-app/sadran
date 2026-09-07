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
  ViolationCode,
} from './types';
import { absStart, absEnd, endHour, toMinutes, fromMinutes } from './time';

const hoursOf = (a: { dayIndex: number; startTime: string; endTime: string }) =>
  (absEnd(a.dayIndex, a.startTime, a.endTime) - absStart(a.dayIndex, a.startTime)) / 60;

export interface ConstraintContext {
  availByEmp: Map<string, Map<string, AvailabilityState>>; // emp -> shiftId -> state
  rules: LaborRules;
}

export function hasRole(emp: EngineEmployee, roleId: string): boolean {
  return emp.roleIds.includes(roleId);
}

/** The employee's free-hours window for a given weekday, if they set one. */
export function windowFor(emp: EngineEmployee, dayIndex: number): { fromTime: string; toTime: string } | null {
  return emp.dayWindows?.find((w) => w.dayIndex === dayIndex) ?? null;
}

/**
 * The interval an employee would actually work for a seat, after clipping to their
 * free-hours window that day. Returns the seat unchanged when they're fully available;
 * null when their window doesn't overlap the seat at all. Overnight seats
 * (end <= start) are never clipped, to avoid cross-midnight math.
 */
export function clipSlot(emp: EngineEmployee, slot: Slot): Slot | null {
  const w = windowFor(emp, slot.dayIndex);
  if (!w) return slot;
  const ss = toMinutes(slot.startTime);
  const se = toMinutes(slot.endTime);
  if (se <= ss) return slot; // overnight seat — keep whole
  const ws = Math.max(ss, toMinutes(w.fromTime));
  const we = Math.min(se, toMinutes(w.toTime));
  if (we - ws <= 0) return null; // window doesn't overlap the seat
  if (ws === ss && we === se) return slot; // covers the whole seat
  return { ...slot, startTime: fromMinutes(ws), endTime: fromMinutes(we) };
}

export function availabilityFor(
  availByEmp: Map<string, Map<string, AvailabilityState>>,
  employeeId: string,
  shiftId: string,
): AvailabilityState {
  // Missing availability is treated as 'ok' (available unless the employee said "cant").
  return availByEmp.get(employeeId)?.get(shiftId) ?? 'ok';
}

/**
 * Availability for eligibility purposes. Same as availabilityFor, EXCEPT an employee
 * we have no info about (availabilityUnknown) defaults to 'cant' instead of 'ok' —
 * so they are never auto-scheduled, only force-filled.
 */
export function effectiveAvailability(
  ctx: ConstraintContext,
  emp: EngineEmployee,
  shiftId: string,
): AvailabilityState {
  const st = ctx.availByEmp.get(emp.id)?.get(shiftId);
  if (st) return st;
  return emp.availabilityUnknown ? 'cant' : 'ok';
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
  else if ((emp.roleLevels?.[slot.roleId] ?? 1) < (slot.minLevel ?? 1)) v.push({ code: 'level' }); // 3.3 seniority
  if (emp.blockedDays?.includes(slot.dayIndex)) v.push({ code: 'time_off' }); // 3.1 approved absence — hard
  if (!isAvailable(effectiveAvailability(ctx, emp, slot.shiftId))) v.push({ code: 'availability' });
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

  // 3.3 — max consecutive worked days (per-employee opt-in; null = no limit)
  if (emp.maxConsecutiveDays != null) {
    const days = new Set(current.map((a) => a.dayIndex));
    days.add(slot.dayIndex);
    let run = 0;
    let maxRun = 0;
    for (let d = 0; d <= 6; d++) {
      if (days.has(d)) { run += 1; maxRun = Math.max(maxRun, run); } else run = 0;
    }
    if (maxRun > emp.maxConsecutiveDays) v.push({ code: 'max_consecutive' });
  }

  return { ok: v.length === 0, violations: v };
}

/** Boolean convenience wrapper over checkEligibility. */
export function isEligible(emp: EngineEmployee, slot: Slot, current: EngineAssignment[], ctx: ConstraintContext): boolean {
  return checkEligibility(emp, slot, current, ctx).ok;
}

// Preferences the engine MAY relax to force-fill an otherwise-empty seat. Everything
// else — role, structural (same_shift/overlap), and every LABOR-LAW rule (rest,
// curfew, daily/weekly hour caps) — is NEVER relaxed, so a forced assignment is
// still always legal.
export const RELAXABLE_CODES: ReadonlySet<ViolationCode> = new Set<ViolationCode>(['availability', 'max_shifts']);

/**
 * True if the ONLY things blocking this employee are relaxable preferences —
 * so they can be force-assigned without breaking any law. (Empty violations means
 * they're normally eligible, not "forced".)
 */
export function isForceEligible(result: EligibilityResult): boolean {
  return result.violations.length > 0 && result.violations.every((v) => RELAXABLE_CODES.has(v.code));
}
