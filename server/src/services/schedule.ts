// Bridges the DB <-> the pure engine. Builds ScheduleInput from Prisma rows,
// runs generateSchedule, and persists the resulting assignments + fairness log.

import { generateSchedule, type AvailabilityState, type ScheduleInput, type Slot } from '@engine';
import { prisma, parseLaborRules } from '../db';
import { solveOptimal } from './optimize';

// Israeli weekend: Friday (5) and Saturday (6). dayIndex 0 = Sunday.
export const WEEKEND_DAYS = [5, 6];

export async function buildEngineInput(orgId: string, cycleId: string): Promise<ScheduleInput> {
  const [org, cycle, shifts, demand, employees, availability, dayAvail, timeOff, standing] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.weekCycle.findUniqueOrThrow({ where: { id: cycleId } }),
    prisma.shift.findMany({ where: { orgId }, orderBy: [{ dayIndex: 'asc' }, { order: 'asc' }] }),
    prisma.shiftSlot.findMany({ where: { shift: { orgId } } }),
    prisma.employee.findMany({ where: { orgId, active: true }, include: { roles: true } }),
    prisma.availability.findMany({ where: { cycleId } }),
    prisma.dayAvailability.findMany({ where: { cycleId } }),
    prisma.timeOffRequest.findMany({ where: { orgId, status: 'approved' } }),
    prisma.standingRule.findMany({ where: { orgId, status: 'approved' } }),
  ]);

  // 3.1 — approved time-off overlapping THIS week → hard blocked weekdays per employee.
  const dateFloor = (dt: Date) => Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  const weekStart = new Date(cycle.weekStartDate);
  const blockedByEmp = new Map<string, Set<number>>();
  for (const t of timeOff) {
    const from = dateFloor(new Date(t.startDate));
    const to = dateFloor(new Date(t.endDate));
    for (let d = 0; d < 7; d++) {
      const day = new Date(weekStart);
      day.setUTCDate(day.getUTCDate() + d);
      const dayMs = dateFloor(day);
      if (dayMs >= from && dayMs <= to) {
        let set = blockedByEmp.get(t.employeeId);
        if (!set) blockedByEmp.set(t.employeeId, (set = new Set()));
        set.add(d);
      }
    }
  }

  // 3.2 — approved standing rules act as this week's DEFAULT availability for any day
  // the employee didn't explicitly submit. 'off' → those shifts 'cant'; 'hours' → a window.
  const explicitDay = new Set(dayAvail.map((a) => `${a.employeeId}|${a.dayIndex}`));
  const stdAvail: { employeeId: string; shiftId: string; state: string }[] = [];
  const stdWindows: { employeeId: string; dayIndex: number; fromTime: string; toTime: string }[] = [];
  const hasStanding = new Set<string>();
  for (const r of standing) {
    hasStanding.add(r.employeeId);
    if (explicitDay.has(`${r.employeeId}|${r.dayIndex}`)) continue; // the employee overrode this week
    if (r.mode === 'off') {
      for (const sh of shifts) if (sh.dayIndex === r.dayIndex) stdAvail.push({ employeeId: r.employeeId, shiftId: sh.id, state: 'cant' });
    } else if (r.mode === 'hours' && r.fromTime && r.toTime) {
      stdWindows.push({ employeeId: r.employeeId, dayIndex: r.dayIndex, fromTime: r.fromTime, toTime: r.toTime });
    }
  }

  const dayWindows = [
    ...dayAvail.filter((w) => w.mode === 'hours' && w.fromTime && w.toTime).map((w) => ({ employeeId: w.employeeId, dayIndex: w.dayIndex, fromTime: w.fromTime as string, toTime: w.toTime as string })),
    ...stdWindows,
  ];
  const allAvailability = [
    ...availability.map((a) => ({ employeeId: a.employeeId, shiftId: a.shiftId, state: a.state })),
    ...stdAvail,
  ];
  // known this cycle = a per-shift reply, a manual day config, OR an approved standing pattern
  const hasInfo = (empId: string) =>
    availability.some((a) => a.employeeId === empId) || dayAvail.some((a) => a.employeeId === empId) || hasStanding.has(empId);

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
    demand: demand.map((d) => ({ id: d.id, shiftId: d.shiftId, roleId: d.roleId, startTime: d.startTime, count: d.count, minLevel: d.minLevel })),
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      roleIds: e.roles.map((r) => r.roleId),
      roleLevels: Object.fromEntries(e.roles.map((r) => [r.roleId, r.level])),
      maxConsecutiveDays: e.maxConsecutiveDays,
      minShifts: e.minShifts,
      maxShifts: e.maxShifts,
      isMinor: e.isMinor,
      fairnessCredit: e.fairnessCredit,
      blockedDays: [...(blockedByEmp.get(e.id) ?? [])],
      dayWindows: dayWindows
        .filter((w) => w.employeeId === e.id)
        .map((w) => ({ dayIndex: w.dayIndex, fromTime: w.fromTime, toTime: w.toTime })),
      availabilityUnknown: !hasInfo(e.id),
    })),
    availability: allAvailability.map((a) => ({ employeeId: a.employeeId, shiftId: a.shiftId, state: a.state as AvailabilityState })),
  };
}

/** Build an engine Slot from a demand requirement (ShiftSlot) id. */
export async function slotFromDemand(slotId: string): Promise<Slot | null> {
  const d = await prisma.shiftSlot.findUnique({ where: { id: slotId }, include: { shift: true } });
  if (!d) return null;
  return { dayIndex: d.shift.dayIndex, shiftId: d.shiftId, slotId: d.id, roleId: d.roleId, startTime: d.startTime, endTime: d.shift.endTime, minLevel: d.minLevel };
}

export async function generateAndStore(orgId: string, cycleId: string, opts?: { optimize?: boolean }) {
  const input = await buildEngineInput(orgId, cycleId);

  // Preserve manager-pinned (locked) assignments across a regenerate: seed them as
  // fixed pre-assignments so the engine keeps them and schedules everyone else around.
  const locked = await prisma.assignment.findMany({
    where: { cycleId, locked: true, status: { in: ['proposed', 'published'] } },
    include: { shift: true },
  });
  input.preAssigned = locked.map((a) => ({
    employeeId: a.employeeId, shiftId: a.shiftId, slotId: a.slotId, roleId: a.roleId,
    dayIndex: a.shift.dayIndex, startTime: a.startTime, endTime: a.endTime ?? a.shift.endTime,
    forced: a.forced, forceReason: a.forceReason ?? undefined, locked: true,
  }));

  // Layer 2 (optional): the CP-SAT "math brain". If requested and it succeeds we
  // use its provably-optimal result; otherwise we transparently use the greedy engine.
  let result = opts?.optimize ? solveOptimal(input) : null;
  const engine: 'optimal' | 'greedy' = result ? 'optimal' : 'greedy';
  if (!result) result = generateSchedule(input);

  await prisma.$transaction(async (tx) => {
    // Serialize concurrent regenerates of the SAME cycle: a per-cycle transaction-scoped
    // advisory lock makes a second generate wait for the first to commit instead of both
    // racing on delete+createMany (which surfaced as unique-constraint 500s under load).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${cycleId})::bigint)`;
    // full rebuild — clear the whole week's schedule before regenerating
    await tx.assignment.deleteMany({ where: { cycleId } });
    await tx.fairnessLog.deleteMany({ where: { cycleId } });
    await tx.assignment.createMany({
      data: result.assignments.map((a) => ({
        cycleId,
        employeeId: a.employeeId,
        shiftId: a.shiftId,
        slotId: a.slotId,
        roleId: a.roleId,
        startTime: a.startTime,
        endTime: a.endTime ?? null,
        status: 'proposed',
        forced: a.forced ?? false,
        forceReason: a.forceReason ?? null,
        locked: a.locked ?? false,
      })),
    });
    await tx.fairnessLog.createMany({
      data: result.fairness.map((f) => ({ cycleId, employeeId: f.employeeId, undesirableLoad: f.undesirableLoad, count: f.count })),
    });
    await tx.weekCycle.update({ where: { id: cycleId }, data: { status: 'proposed' } });
  }, { timeout: 20000 });

  return { ...result, engine };
}
