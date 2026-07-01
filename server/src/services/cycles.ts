// Multi-week support: each WeekCycle is one week's schedule (an archived
// "folder" once published). Provides per-week stats for the history view and
// a full detail payload for viewing any past week.

import { shiftDuration } from '@engine';
import { prisma } from '../db';
import { currentGaps } from './gaps';

export interface CycleSummary {
  id: string;
  weekStartDate: Date;
  status: string;
  shifts: number;
  hours: number;
  laborCost: number;
  coverageRate: number;
  gaps: number;
}

export async function listCyclesWithStats(orgId: string): Promise<CycleSummary[]> {
  const [cycles, demand, employees] = await Promise.all([
    prisma.weekCycle.findMany({ where: { orgId }, orderBy: { weekStartDate: 'desc' } }),
    prisma.shiftSlot.findMany({ where: { shift: { orgId } } }),
    prisma.employee.findMany({ where: { orgId }, select: { id: true, hourlyRate: true } }),
  ]);
  const rate = new Map(employees.map((e) => [e.id, e.hourlyRate]));
  const requiredPerWeek = demand.reduce((s, d) => s + d.count, 0);

  const assignments = await prisma.assignment.findMany({
    where: { cycleId: { in: cycles.map((c) => c.id) }, status: { in: ['proposed', 'published'] } },
    include: { shift: true },
  });

  return cycles.map((c) => {
    const rows = assignments.filter((a) => a.cycleId === c.id);
    const filledBySlot = new Map<string, number>();
    let hours = 0;
    let laborCost = 0;
    for (const a of rows) {
      filledBySlot.set(a.slotId, (filledBySlot.get(a.slotId) ?? 0) + 1);
      const h = shiftDuration(a.startTime, a.shift.endTime) / 60;
      hours += h;
      laborCost += h * (rate.get(a.employeeId) ?? 0);
    }
    let missing = 0;
    for (const d of demand) missing += Math.max(0, d.count - (filledBySlot.get(d.id) ?? 0));
    return {
      id: c.id,
      weekStartDate: c.weekStartDate,
      status: c.status,
      shifts: rows.length,
      hours: Math.round(hours * 10) / 10,
      laborCost: Math.round(laborCost),
      coverageRate: requiredPerWeek ? Math.round(((requiredPerWeek - missing) / requiredPerWeek) * 100) : 0,
      gaps: missing,
    };
  });
}

export async function cycleDetail(orgId: string, cycleId: string) {
  const cycle = await prisma.weekCycle.findUnique({ where: { id: cycleId } });
  if (!cycle || cycle.orgId !== orgId) return null;
  const [assignments, gaps, fairness] = await Promise.all([
    prisma.assignment.findMany({
      where: { cycleId, status: { in: ['proposed', 'published'] } },
      include: { employee: true, shift: true },
    }),
    currentGaps(orgId, cycleId),
    prisma.fairnessLog.findMany({ where: { cycleId } }),
  ]);
  return {
    cycle: { id: cycle.id, weekStartDate: cycle.weekStartDate, status: cycle.status },
    assignments: assignments.map((a) => ({
      id: a.id,
      employeeId: a.employeeId,
      employeeName: a.employee.name,
      dayIndex: a.shift.dayIndex,
      shiftId: a.shiftId,
      slotId: a.slotId,
      roleId: a.roleId,
      startTime: a.startTime,
      status: a.status,
    })),
    gaps,
    fairness,
  };
}
