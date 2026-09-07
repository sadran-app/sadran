import { describe, it, expect } from 'vitest';
import {
  generateSchedule,
  isEligible,
  checkEligibility,
  restRespected,
  curfewRespected,
  notSameShift,
  underMaxShifts,
  type ConstraintContext,
} from '../src/index';
import type { EngineAssignment, EngineEmployee, ScheduleInput, Slot } from '../src/types';

// ---- fixtures -------------------------------------------------------------
// Day 0 (Sunday): morning shift ends 16:00, evening shift ends 23:30.

const rules = { minRestHours: 8, maxWeeklyHours: 100, maxDailyHours: 12, minorCurfewHour: 22, closingHour: 21 };

function ctx(over: Partial<typeof rules> = {}): ConstraintContext {
  return { availByEmp: new Map(), rules: { ...rules, ...over } };
}

function emp(overrides: Partial<EngineEmployee> = {}): EngineEmployee {
  return { id: 'e1', name: 'Test', roleIds: ['waiter'], minShifts: 0, maxShifts: 6, isMinor: false, fairnessCredit: 0, ...overrides };
}

const morningSeat: Slot = { dayIndex: 0, shiftId: 'sM', slotId: 'dM', roleId: 'waiter', startTime: '08:00', endTime: '16:00' };
const eveningSeat: Slot = { dayIndex: 0, shiftId: 'sE', slotId: 'dE', roleId: 'waiter', startTime: '18:00', endTime: '23:30' };

// ---- hard-constraint unit tests ------------------------------------------

describe('hard constraints', () => {
  it('rejects an employee without the required role', () => {
    expect(isEligible(emp({ roleIds: ['cook'] }), eveningSeat, [], ctx())).toBe(false);
  });

  it('rejects when the employee said "cant" for that shift', () => {
    const c = ctx();
    c.availByEmp.set('e1', new Map([['sE', 'cant']]));
    expect(isEligible(emp(), eveningSeat, [], c)).toBe(false);
  });

  it('allows when availability is missing (treated as ok)', () => {
    expect(isEligible(emp(), eveningSeat, [], ctx())).toBe(true);
  });

  it('enforces maxShifts', () => {
    const existing: EngineAssignment[] = Array.from({ length: 6 }, (_, i) => ({
      employeeId: 'e1', shiftId: 's' + i, slotId: 'x', roleId: 'waiter', dayIndex: i, startTime: '08:00', endTime: '16:00',
    }));
    expect(underMaxShifts(existing, emp({ maxShifts: 6 }))).toBe(false);
    expect(isEligible(emp({ maxShifts: 6 }), eveningSeat, existing, ctx())).toBe(false);
  });

  it('forbids being placed in the same shift twice', () => {
    const existing: EngineAssignment[] = [
      { employeeId: 'e1', shiftId: 'sE', slotId: 'dE', roleId: 'waiter', dayIndex: 0, startTime: '18:00', endTime: '23:30' },
    ];
    const otherSeatSameShift: Slot = { ...eveningSeat, slotId: 'dE2', startTime: '19:00' };
    expect(notSameShift(existing, otherSeatSameShift)).toBe(false);
  });

  it('enforces minimum rest between shifts', () => {
    const prevEvening: EngineAssignment[] = [
      { employeeId: 'e1', shiftId: 'sE', slotId: 'dE', roleId: 'waiter', dayIndex: 0, startTime: '18:00', endTime: '23:30' },
    ];
    const nextMorning: Slot = { dayIndex: 1, shiftId: 'sM2', slotId: 'dM2', roleId: 'waiter', startTime: '08:00', endTime: '16:00' };
    expect(restRespected(prevEvening, nextMorning, 8)).toBe(true); // 8.5h
    expect(restRespected(prevEvening, nextMorning, 10)).toBe(false);
  });

  it('replaces staff at a new same-day shift (no rest between 06–16 and 16–23)', () => {
    const morning: EngineAssignment[] = [
      { employeeId: 'e1', shiftId: 'sM', slotId: 'dM', roleId: 'waiter', dayIndex: 0, startTime: '06:00', endTime: '16:00' },
    ];
    const eveningSameDay: Slot = { dayIndex: 0, shiftId: 'sE', slotId: 'dE', roleId: 'waiter', startTime: '16:00', endTime: '23:00' };
    expect(restRespected(morning, eveningSameDay, 8)).toBe(false); // 0h rest → cannot do both
  });

  it('enforces minor curfew (shift must end by curfew)', () => {
    const minor = emp({ isMinor: true });
    expect(curfewRespected(minor, eveningSeat, 22)).toBe(false); // ends 23:30
    expect(curfewRespected(minor, morningSeat, 22)).toBe(true); // ends 16:00
    expect(curfewRespected(emp({ isMinor: false }), eveningSeat, 22)).toBe(true);
  });
});

describe('checkEligibility — detailed reasons', () => {
  it('reports overlap when the new shift overlaps an existing one', () => {
    const existing: EngineAssignment[] = [
      { employeeId: 'e1', shiftId: 'sX', slotId: 'dX', roleId: 'waiter', dayIndex: 0, startTime: '07:00', endTime: '15:00' },
    ];
    const overlapping: Slot = { dayIndex: 0, shiftId: 'sY', slotId: 'dY', roleId: 'waiter', startTime: '14:00', endTime: '22:00' };
    const r = checkEligibility(emp(), overlapping, existing, ctx());
    expect(r.ok).toBe(false);
    expect(r.violations.map((x) => x.code)).toContain('overlap');
  });

  it('reports a rest violation for a 3am → 7am next-day pattern', () => {
    const nightShift: EngineAssignment[] = [
      { employeeId: 'e1', shiftId: 'sN', slotId: 'dN', roleId: 'waiter', dayIndex: 0, startTime: '19:00', endTime: '03:00' },
    ];
    const nextMorning: Slot = { dayIndex: 1, shiftId: 'sM', slotId: 'dM', roleId: 'waiter', startTime: '07:00', endTime: '15:00' };
    const r = checkEligibility(emp(), nextMorning, nightShift, ctx());
    expect(r.violations.map((x) => x.code)).toContain('rest'); // only 4h rest
  });

  it('reports max_daily_hours when a day would exceed the cap', () => {
    const existing: EngineAssignment[] = [
      { employeeId: 'e1', shiftId: 'sA', slotId: 'dA', roleId: 'waiter', dayIndex: 2, startTime: '06:00', endTime: '14:00' }, // 8h
    ];
    // add another 6h the same day (with a different, non-overlapping window) → 14h > 12
    const more: Slot = { dayIndex: 2, shiftId: 'sB', slotId: 'dB', roleId: 'waiter', startTime: '14:00', endTime: '20:00' };
    const r = checkEligibility(emp(), more, existing, ctx({ minRestHours: 0 }));
    expect(r.violations.map((x) => x.code)).toContain('max_daily_hours');
  });

  it('is ok (no violations) for a clean assignment', () => {
    expect(checkEligibility(emp(), morningSeat, [], ctx()).ok).toBe(true);
  });
});

// ---- full-generation invariants ------------------------------------------

function buildInput(): ScheduleInput {
  const employees: EngineEmployee[] = [
    emp({ id: 'a', name: 'A', maxShifts: 3 }),
    emp({ id: 'b', name: 'B', maxShifts: 3 }),
    emp({ id: 'c', name: 'C', isMinor: true, maxShifts: 3 }),
  ];
  // 7 days, each with a morning + evening shift; evening needs a non-minor waiter
  const shifts = [] as ScheduleInput['shifts'];
  const demand = [] as ScheduleInput['demand'];
  for (let d = 0; d < 7; d++) {
    shifts.push({ id: `m${d}`, dayIndex: d, label: 'בוקר', startTime: '08:00', endTime: '16:00', order: 0, colorTier: 0 });
    shifts.push({ id: `e${d}`, dayIndex: d, label: 'ערב', startTime: '18:00', endTime: '23:30', order: 1, colorTier: 1 });
    demand.push({ id: `dm${d}`, shiftId: `m${d}`, roleId: 'waiter', startTime: '08:00', count: 1 });
    demand.push({ id: `de${d}`, shiftId: `e${d}`, roleId: 'waiter', startTime: '18:00', count: 1 });
  }
  return {
    weekendDays: [5, 6],
    laborRules: rules,
    shifts,
    demand,
    employees,
    availability: [],
  };
}

describe('generateSchedule invariants', () => {
  const result = generateSchedule(buildInput());
  const input = buildInput();

  it('never assigns a minor to a shift ending after curfew', () => {
    const eveningShiftIds = new Set(input.shifts.filter((s) => s.endTime === '23:30').map((s) => s.id));
    expect(result.assignments.some((a) => a.employeeId === 'c' && eveningShiftIds.has(a.shiftId))).toBe(false);
  });

  it('never exceeds maxShifts for non-forced assignments', () => {
    // maxShifts is a PREFERENCE the engine may relax when force-filling, so we only
    // assert it for the normally-eligible (non-forced) assignments.
    for (const e of input.employees) {
      const count = result.assignments.filter((a) => a.employeeId === e.id && !a.forced).length;
      expect(count).toBeLessThanOrEqual(e.maxShifts);
    }
  });

  it('never places an employee in the same shift twice', () => {
    const seen = new Set<string>();
    for (const a of result.assignments) {
      const key = `${a.employeeId}:${a.shiftId}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('force-fills short-staffed seats instead of leaving gaps — without breaking a law', () => {
    // 14 seats but only A+B can staff evenings (C is a minor → curfew). Their
    // maxShifts=3 is a preference, so the engine force-fills the overflow.
    expect(result.assignments.some((a) => a.forced)).toBe(true);
    // a minor is STILL never placed on a post-curfew evening, even under force
    const eveningShiftIds = new Set(input.shifts.filter((s) => s.endTime === '23:30').map((s) => s.id));
    expect(result.assignments.some((a) => a.employeeId === 'c' && eveningShiftIds.has(a.shiftId))).toBe(false);
  });

  it('leaves a LEGAL gap when a post-curfew seat can only be filled by a minor', () => {
    const minorOnly: ScheduleInput = {
      weekendDays: [5, 6],
      laborRules: rules,
      shifts: [{ id: 'e0', dayIndex: 0, label: 'ערב', startTime: '18:00', endTime: '23:30', order: 0, colorTier: 0 }],
      demand: [{ id: 'de0', shiftId: 'e0', roleId: 'waiter', startTime: '18:00', count: 1 }],
      employees: [emp({ id: 'm', name: 'Minor', isMinor: true })],
      availability: [],
    };
    const r = generateSchedule(minorOnly);
    expect(r.gaps.length).toBeGreaterThan(0); // curfew is a LAW → cannot force-fill
    expect(r.assignments.length).toBe(0);
    // the gap explains WHY it couldn't be filled (actionable for the manager)
    expect(r.gaps[0]!.reason).toContain('עוצר');
  });

  it('labels a gap "no such role" when nobody has the required role', () => {
    const noRole: ScheduleInput = {
      weekendDays: [5, 6], laborRules: rules,
      shifts: [{ id: 'k0', dayIndex: 0, label: 'בוקר', startTime: '08:00', endTime: '16:00', order: 0, colorTier: 0 }],
      demand: [{ id: 'dk', shiftId: 'k0', roleId: 'chef', startTime: '08:00', count: 1 }],
      employees: [emp({ id: 'w', name: 'Waiter' })], // has 'waiter', not 'chef'
      availability: [],
    };
    const r = generateSchedule(noRole);
    expect(r.gaps.length).toBe(1);
    expect(r.gaps[0]!.reason).toContain('התפקיד');
  });

  it('brings an employee up to their minShifts when seats allow', () => {
    const minFill: ScheduleInput = {
      weekendDays: [5, 6], laborRules: rules,
      shifts: [0, 1, 2].map((d) => ({ id: 'd' + d, dayIndex: d, label: 'בוקר', startTime: '08:00', endTime: '16:00', order: 0, colorTier: 0 })),
      demand: [0, 1, 2].map((d) => ({ id: 'x' + d, shiftId: 'd' + d, roleId: 'waiter', startTime: '08:00', count: 1 })),
      employees: [
        emp({ id: 'wants', name: 'Wants', minShifts: 2, maxShifts: 3 }),
        emp({ id: 'flex', name: 'Flex', minShifts: 0, maxShifts: 3 }),
      ],
      availability: [],
    };
    const r = generateSchedule(minFill);
    expect(r.assignments.filter((a) => a.employeeId === 'wants').length).toBeGreaterThanOrEqual(2);
  });
});
