// Framework-agnostic engine contract. No Prisma / DB types leak in here —
// this is the clean boundary that lets us swap the heuristic for OR-Tools later.

export type AvailabilityState = 'ok' | 'prefer' | 'cant';

export interface LaborRules {
  minRestHours: number; // minimum rest between two shifts
  maxWeeklyHours: number; // hard cap on total hours per employee per week
  maxDailyHours: number; // hard cap on total hours per employee per single day
  minorCurfewHour: number; // e.g. 22 → a minor's shift must END at or before 22:00
  closingHour: number; // shifts ending at/after this hour count as "closing" (undesirable)
}

export type ViolationCode =
  | 'role' // lacks the required role
  | 'time_off' // approved vacation / reserve duty on this day — hard, never force-filled
  | 'level' // has the role but below the seat's required seniority level
  | 'availability' // marked "cant" for this shift
  | 'max_shifts' // reached their weekly shift cap
  | 'same_shift' // already assigned to this exact shift
  | 'overlap' // overlaps a shift they already hold
  | 'rest' // not enough rest before/after an adjacent shift
  | 'curfew' // minor: shift ends after curfew
  | 'max_daily_hours' // would exceed daily hours cap
  | 'max_weekly_hours' // would exceed weekly hours cap
  | 'max_consecutive'; // would exceed the employee's max consecutive worked days

export interface Violation {
  code: ViolationCode;
  conflictDayIndex?: number; // for overlap/rest — the shift being conflicted with
  conflictStart?: string;
}

export interface EligibilityResult {
  ok: boolean;
  violations: Violation[];
}

// A manager-defined segment on ONE weekday (e.g. Sunday "בוקר" 06:00–16:00).
export interface EngineShift {
  id: string;
  dayIndex: number; // 0–6 (0 = Sunday)
  label: string;
  startTime: string; // 'HH:MM'
  endTime: string; // 'HH:MM' — when the segment ends
  order: number;
  colorTier: number;
}

// A staffing requirement inside a shift: `count` of `roleId` arriving at `startTime`.
export interface EngineDemandSlot {
  id: string;
  shiftId: string;
  roleId: string;
  startTime: string; // 'HH:MM'
  count: number;
  minLevel?: number; // required seniority (default 1) — 3.3
}

// A day on which an employee can work only a bounded window (free-hours). Absent =
// fully available that day. Used to clip an assignment to the hours they can work.
export interface DayWindow {
  dayIndex: number; // 0–6
  fromTime: string; // 'HH:MM'
  toTime: string; // 'HH:MM'
}

export interface EngineEmployee {
  id: string;
  name: string;
  roleIds: string[];
  roleLevels?: Record<string, number>; // roleId -> seniority level (default 1) — 3.3
  maxConsecutiveDays?: number | null; // cap on consecutive worked days (undefined/null = no cap) — 3.3
  blockedDays?: number[]; // approved time-off weekdays (0–6) — hard, never scheduled/forced — 3.1
  minShifts: number;
  maxShifts: number;
  isMinor: boolean;
  fairnessCredit: number;
  dayWindows?: DayWindow[]; // free-hours limits; absent/empty = available all day
  // true when we have NO availability info for this employee this cycle (no WhatsApp
  // reply, not configured). They are NOT treated as available — only force-fillable,
  // and as the last resort (after employees who did submit availability).
  availabilityUnknown?: boolean;
}

export interface EngineAvailability {
  employeeId: string;
  shiftId: string;
  state: AvailabilityState;
}

export interface ScheduleInput {
  weekendDays: number[]; // dayIndexes treated as weekend, e.g. [5, 6]
  laborRules: LaborRules;
  shifts: EngineShift[];
  demand: EngineDemandSlot[];
  employees: EngineEmployee[];
  availability: EngineAvailability[];
  // Manager-pinned assignments to keep fixed. They are seeded before the greedy
  // fill (counted toward coverage, load, rest/hours limits) and never moved.
  preAssigned?: EngineAssignment[];
}

// A single unit of demand (one seat to fill).
export interface Slot {
  dayIndex: number;
  shiftId: string;
  slotId: string;
  roleId: string;
  startTime: string;
  endTime: string;
  minLevel?: number; // required seniority (default 1) — 3.3
}

export interface EngineAssignment {
  employeeId: string;
  shiftId: string;
  slotId: string;
  roleId: string;
  dayIndex: number;
  startTime: string;
  endTime: string;
  // Set when the seat could not be filled by a normally-eligible employee and the
  // engine force-filled it (relaxing ONLY preferences — availability / max shifts —
  // never a labor-law rule). Needs manager approval; shown in strong red.
  forced?: boolean;
  forceReason?: string; // Hebrew explanation: what was overridden + why this person
  overrides?: ViolationCode[]; // which soft constraints were relaxed
  partial?: boolean; // the worked interval was clipped to the employee's free-hours window
  locked?: boolean; // manager-pinned — seeded as a fixed pre-assignment, never moved by any pass
}

export interface Gap {
  dayIndex: number;
  shiftId: string;
  slotId: string;
  roleId: string;
  startTime: string;
  endTime?: string; // when the uncovered hole is only part of the seat's interval
  missing: number;
  reason?: string; // Hebrew explanation of WHY it couldn't be filled (actionable)
}

export interface FairnessResult {
  employeeId: string;
  undesirableLoad: number;
  count: number;
}

export interface ScheduleResult {
  assignments: EngineAssignment[];
  gaps: Gap[];
  fairness: FairnessResult[];
  warnings: string[];
}
