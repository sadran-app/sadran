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
  | 'availability' // marked "cant" for this shift
  | 'max_shifts' // reached their weekly shift cap
  | 'same_shift' // already assigned to this exact shift
  | 'overlap' // overlaps a shift they already hold
  | 'rest' // not enough rest before/after an adjacent shift
  | 'curfew' // minor: shift ends after curfew
  | 'max_daily_hours' // would exceed daily hours cap
  | 'max_weekly_hours'; // would exceed weekly hours cap

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
}

export interface EngineEmployee {
  id: string;
  name: string;
  roleIds: string[];
  minShifts: number;
  maxShifts: number;
  isMinor: boolean;
  fairnessCredit: number;
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
}

// A single unit of demand (one seat to fill).
export interface Slot {
  dayIndex: number;
  shiftId: string;
  slotId: string;
  roleId: string;
  startTime: string;
  endTime: string;
}

export interface EngineAssignment {
  employeeId: string;
  shiftId: string;
  slotId: string;
  roleId: string;
  dayIndex: number;
  startTime: string;
  endTime: string;
}

export interface Gap {
  dayIndex: number;
  shiftId: string;
  slotId: string;
  roleId: string;
  startTime: string;
  missing: number;
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
