// Aggregated analytics for the manager's Reports screen. Everything is computed
// live from assignments/swaps across ALL of the org's cycles.

import { shiftDuration, endHour } from '@engine';
import { prisma, parseLaborRules } from '../db';
import { WEEKEND_DAYS } from './schedule';

export interface EmployeeReport {
  id: string;
  name: string;
  active: boolean;
  isMinor: boolean;
  age: number | null;
  optInStatus: string;
  roleNames: string[];
  shifts: number;
  hours: number;
  laborCost: number;
  weekendShifts: number;
  closingShifts: number;
  undesirableLoad: number;
  swapOuts: number;
  swapIns: number;
  avgShiftsPerWeek: number;
  belowMin: boolean;
}

export interface OrgReport {
  summary: {
    activeEmployees: number;
    minors: number;
    weeks: number;
    totalShifts: number;
    totalHours: number;
    totalLaborCost: number;
    coverageRate: number;
    openGaps: number;
    pendingSwaps: number;
    totalSwaps: number;
    avgHoursPerEmployee: number;
  };
  employees: EmployeeReport[];
}

function ageFromBirth(birth?: Date | null): number | null {
  if (!birth) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export async function buildOrgReport(orgId: string): Promise<OrgReport> {
  const [org, employees, cycles, roles, demand] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.employee.findMany({ where: { orgId }, include: { roles: true } }),
    prisma.weekCycle.findMany({ where: { orgId }, orderBy: { weekStartDate: 'desc' } }),
    prisma.role.findMany({ where: { orgId } }),
    prisma.shiftSlot.findMany({ where: { shift: { orgId } } }),
  ]);
  const rules = parseLaborRules(org.laborRules);
  const cycleIds = cycles.map((c) => c.id);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  const [assignments, swaps] = await Promise.all([
    prisma.assignment.findMany({
      where: { cycleId: { in: cycleIds }, status: { in: ['published', 'proposed'] } },
      include: { shift: true },
    }),
    prisma.swapRequest.findMany({ where: { cycleId: { in: cycleIds } } }),
  ]);

  type Acc = { shifts: number; hours: number; laborCost: number; weekendShifts: number; closingShifts: number; undesirableLoad: number; swapOuts: number; swapIns: number };
  const acc = new Map<string, Acc>();
  const ensure = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) { a = { shifts: 0, hours: 0, laborCost: 0, weekendShifts: 0, closingShifts: 0, undesirableLoad: 0, swapOuts: 0, swapIns: 0 }; acc.set(id, a); }
    return a;
  };
  const rateOf = new Map(employees.map((e) => [e.id, e.hourlyRate]));

  for (const a of assignments) {
    const acnt = ensure(a.employeeId);
    const hrs = shiftDuration(a.startTime, a.shift.endTime) / 60;
    acnt.shifts += 1;
    acnt.hours += hrs;
    acnt.laborCost += hrs * (rateOf.get(a.employeeId) ?? 0);
    const weekend = WEEKEND_DAYS.includes(a.shift.dayIndex);
    const closing = endHour(a.startTime, a.shift.endTime) >= rules.closingHour;
    if (weekend) acnt.weekendShifts += 1;
    if (closing) acnt.closingShifts += 1;
    acnt.undesirableLoad += (weekend ? 1 : 0) + (closing ? 1 : 0);
  }
  for (const s of swaps) {
    if (s.status === 'approved') {
      if (s.previousHolderId) ensure(s.previousHolderId).swapOuts += 1;
      if (s.claimedById) ensure(s.claimedById).swapIns += 1;
    }
  }

  const dataCycleIds = new Set(assignments.map((a) => a.cycleId));
  const dataWeeks = dataCycleIds.size;
  const weeks = Math.max(1, dataWeeks);

  const employeeReports: EmployeeReport[] = employees.map((e) => {
    const a = ensure(e.id);
    return {
      id: e.id,
      name: e.name,
      active: e.active,
      isMinor: e.isMinor,
      age: ageFromBirth(e.birthDate),
      optInStatus: e.optInStatus,
      roleNames: e.roles.map((r) => roleName.get(r.roleId) ?? '—'),
      shifts: a.shifts,
      hours: Math.round(a.hours * 10) / 10,
      laborCost: Math.round(a.laborCost),
      weekendShifts: a.weekendShifts,
      closingShifts: a.closingShifts,
      undesirableLoad: a.undesirableLoad,
      swapOuts: a.swapOuts,
      swapIns: a.swapIns,
      avgShiftsPerWeek: Math.round((a.shifts / weeks) * 10) / 10,
      belowMin: a.shifts / weeks < e.minShifts,
    };
  });

  const requiredPerWeek = demand.reduce((s, d) => s + d.count, 0);
  const totalRequired = requiredPerWeek * Math.max(1, dataWeeks);
  const totalShifts = assignments.length;
  const totalHours = Math.round(employeeReports.reduce((s, e) => s + e.hours, 0) * 10) / 10;
  const totalLaborCost = employeeReports.reduce((s, e) => s + e.laborCost, 0);

  // open gaps in the most recent cycle that has a schedule
  const current = cycles.find((c) => dataCycleIds.has(c.id));
  let openGaps = 0;
  if (current) {
    const filled = new Map<string, number>();
    for (const a of assignments) if (a.cycleId === current.id) filled.set(a.slotId, (filled.get(a.slotId) ?? 0) + 1);
    for (const d of demand) {
      const have = filled.get(d.id) ?? 0;
      if (have < d.count) openGaps += d.count - have;
    }
  }

  const activeEmps = employees.filter((e) => e.active);
  return {
    summary: {
      activeEmployees: activeEmps.length,
      minors: activeEmps.filter((e) => e.isMinor).length,
      weeks: dataWeeks,
      totalShifts,
      totalHours,
      totalLaborCost,
      coverageRate: totalRequired ? Math.round((totalShifts / totalRequired) * 100) : 0,
      openGaps,
      pendingSwaps: swaps.filter((s) => s.status === 'open' || s.status === 'claimed').length,
      totalSwaps: swaps.length,
      avgHoursPerEmployee: activeEmps.length ? Math.round((totalHours / activeEmps.length) * 10) / 10 : 0,
    },
    employees: employeeReports.sort((a, b) => b.shifts - a.shifts),
  };
}
