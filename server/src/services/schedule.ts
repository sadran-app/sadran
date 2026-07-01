// Bridges the DB <-> the pure engine. Builds ScheduleInput from Prisma rows,
// runs generateSchedule, and persists the resulting assignments + fairness log.

import { generateSchedule, isEligible, type AvailabilityState, type ScheduleInput, type Slot } from '@engine';
import { prisma, parseLaborRules } from '../db';

// Israeli weekend: Friday (5) and Saturday (6). dayIndex 0 = Sunday.
export const WEEKEND_DAYS = [5, 6];
export const DAYS = 7;

export async function buildEngineInput(orgId: string, cycleId: string): Promise<ScheduleInput> {
  const [org, shifts, demand, employees, availability] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.shift.findMany({ where: { orgId }, orderBy: [{ dayIndex: 'asc' }, { order: 'asc' }] }),
    prisma.shiftSlot.findMany({ where: { shift: { orgId } } }),
    prisma.employee.findMany({ where: { orgId, active: true }, include: { roles: true } }),
    prisma.availability.findMany({ where: { cycleId } }),
  ]);

  return {
    weekendDays: WEEKEND_DAYS,
    laborRules: parseLaborRules(org.laborRules),
    shifts: shifts.map((s) => ({
      id: s.id,
      dayIndex: s.dayIndex,
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      order: s.order,
      colorTier: s.colorTier,
    })),
    demand: demand.map((d) => ({ id: d.id, shiftId: d.shiftId, roleId: d.roleId, startTime: d.startTime, count: d.count })),
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      roleIds: e.roles.map((r) => r.roleId),
      minShifts: e.minShifts,
      maxShifts: e.maxShifts,
      isMinor: e.isMinor,
      fairnessCredit: e.fairnessCredit,
    })),
    availability: availability.map((a) => ({ employeeId: a.employeeId, shiftId: a.shiftId, state: a.state as AvailabilityState })),
  };
}

/** Build an engine Slot from a demand requirement (ShiftSlot) id. */
export async function slotFromDemand(slotId: string): Promise<Slot | null> {
  const d = await prisma.shiftSlot.findUnique({ where: { id: slotId }, include: { shift: true } });
  if (!d) return null;
  return { dayIndex: d.shift.dayIndex, shiftId: d.shiftId, slotId: d.id, roleId: d.roleId, startTime: d.startTime, endTime: d.shift.endTime };
}

/** Validate a manual assignment against the same hard constraints the engine uses. */
export async function isEligibleForSlot(orgId: string, cycleId: string, employeeId: string, slot: Slot): Promise<boolean> {
  const input = await buildEngineInput(orgId, cycleId);
  const emp = input.employees.find((e) => e.id === employeeId);
  if (!emp) return false;

  const availByEmp = new Map<string, Map<string, AvailabilityState>>();
  for (const a of input.availability) {
    let m = availByEmp.get(a.employeeId);
    if (!m) availByEmp.set(a.employeeId, (m = new Map()));
    m.set(a.shiftId, a.state);
  }
  const currentRaw = await prisma.assignment.findMany({ where: { cycleId, employeeId }, include: { shift: true } });
  const current = currentRaw.map((a) => ({
    employeeId: a.employeeId,
    shiftId: a.shiftId,
    slotId: a.slotId,
    roleId: a.roleId,
    dayIndex: a.shift.dayIndex,
    startTime: a.startTime,
    endTime: a.shift.endTime,
  }));
  return isEligible(emp, slot, current, { availByEmp, rules: input.laborRules });
}

export async function generateAndStore(orgId: string, cycleId: string) {
  const input = await buildEngineInput(orgId, cycleId);
  const result = generateSchedule(input);

  await prisma.$transaction([
    // full rebuild — clear the whole week's schedule before regenerating
    prisma.assignment.deleteMany({ where: { cycleId } }),
    prisma.fairnessLog.deleteMany({ where: { cycleId } }),
    prisma.assignment.createMany({
      data: result.assignments.map((a) => ({
        cycleId,
        employeeId: a.employeeId,
        shiftId: a.shiftId,
        slotId: a.slotId,
        roleId: a.roleId,
        startTime: a.startTime,
        status: 'proposed',
      })),
    }),
    prisma.fairnessLog.createMany({
      data: result.fairness.map((f) => ({ cycleId, employeeId: f.employeeId, undesirableLoad: f.undesirableLoad, count: f.count })),
    }),
    prisma.weekCycle.update({ where: { id: cycleId }, data: { status: 'proposed' } }),
  ]);

  return result;
}
