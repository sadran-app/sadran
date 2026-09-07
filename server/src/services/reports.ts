// Aggregated analytics for the manager's Reports screen. Everything is computed
// live from assignments/swaps across ALL of the org's cycles.

import { shiftDuration, endHour } from '@engine';
import { prisma, parseLaborRules } from '../db';
import { WEEKEND_DAYS } from './schedule';
import { slotDeficit } from './gaps';

export interface EmployeeReport {
  id: string;
  name: string;
  active: boolean;
  isMinor: boolean;
  age: number | null;
  optInStatus: string;
  roleNames: string[];
  phone: string;
  hourlyRate: number;
  shifts: number;
  hours: number;
  laborCost: number;
  weekendShifts: number;
  closingShifts: number;
  undesirableLoad: number; // lifetime weekend+closing count
  undesirablePerWeek: number; // 4.4 — tenure-normalised (per week worked) — the fair comparison
  weeksWorked: number; // distinct published weeks the employee worked
  swapOuts: number;
  swapIns: number;
  avgShiftsPerWeek: number;
  belowMin: boolean;
  reliability: number; // 4.4 — 0–100: availability-response rate minus swap-out penalty
  responseRate: number; // 4.4 — fraction of their cycles they submitted availability for
  rank: number; // 1 = most shifts contributed; 0 = no published shifts yet
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
    weeklyLaborBudget: number; // 4.2
    avgWeeklyLaborCost: number; // 4.2 — published labour cost / weeks
  };
  employees: EmployeeReport[];
}

// 4.1/4.2 — one data point per published week for the trend charts.
export interface TrendPoint {
  cycleId: string;
  weekStartDate: string;
  coveragePct: number;
  laborCost: number;
  hours: number;
  shifts: number;
  forced: number;
  gaps: number;
  fairnessSpread: number; // max−min undesirable load across employees who worked
  revenue: number | null;
  laborPctOfRevenue: number | null;
  budget: number;
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
    prisma.shiftSlot.findMany({ where: { shift: { orgId } }, include: { shift: true } }),
  ]);
  const rules = parseLaborRules(org.laborRules);
  const cycleIds = cycles.map((c) => c.id);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));

  const [assignments, swaps, availability, dayAvail, standing] = await Promise.all([
    // Reports reflect ACTUAL, published schedules only — never unpublished drafts
    // (which can still change), so the numbers a manager sees are always trustworthy.
    prisma.assignment.findMany({
      where: { cycleId: { in: cycleIds }, status: 'published' },
      include: { shift: true },
    }),
    prisma.swapRequest.findMany({ where: { cycleId: { in: cycleIds } } }),
    prisma.availability.findMany({ where: { cycleId: { in: cycleIds } }, select: { cycleId: true, employeeId: true } }),
    prisma.dayAvailability.findMany({ where: { cycleId: { in: cycleIds } }, select: { cycleId: true, employeeId: true } }),
    prisma.standingRule.findMany({ where: { orgId, status: 'approved' }, select: { employeeId: true } }),
  ]);

  // 4.4 reliability — did the employee respond (availability) in cycles they existed for?
  const respondedCycles = new Map<string, Set<string>>();
  for (const r of [...availability, ...dayAvail]) {
    let s = respondedCycles.get(r.employeeId);
    if (!s) respondedCycles.set(r.employeeId, (s = new Set()));
    s.add(r.cycleId);
  }
  // an approved standing pattern IS a permanent "response" — the manager knows their
  // availability every week without a weekly submission, so it must not hurt reliability.
  const hasStandingPattern = new Set(standing.map((s) => s.employeeId));
  const cycleStart = new Map(cycles.map((c) => [c.id, c.weekStartDate]));

  type Acc = { shifts: number; hours: number; laborCost: number; weekendShifts: number; closingShifts: number; undesirableLoad: number; swapOuts: number; swapIns: number };
  const acc = new Map<string, Acc>();
  const ensure = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) { a = { shifts: 0, hours: 0, laborCost: 0, weekendShifts: 0, closingShifts: 0, undesirableLoad: 0, swapOuts: 0, swapIns: 0 }; acc.set(id, a); }
    return a;
  };
  const rateOf = new Map(employees.map((e) => [e.id, e.hourlyRate]));
  const weeksByEmp = new Map<string, Set<string>>(); // distinct cycles worked (for tenure-normalised fairness)

  for (const a of assignments) {
    const acnt = ensure(a.employeeId);
    const endT = a.endTime ?? a.shift.endTime;
    const hrs = shiftDuration(a.startTime, endT) / 60;
    acnt.shifts += 1;
    acnt.hours += hrs;
    acnt.laborCost += hrs * (rateOf.get(a.employeeId) ?? 0);
    const weekend = WEEKEND_DAYS.includes(a.shift.dayIndex);
    const closing = endHour(a.startTime, endT) >= rules.closingHour;
    if (weekend) acnt.weekendShifts += 1;
    if (closing) acnt.closingShifts += 1;
    acnt.undesirableLoad += (weekend ? 1 : 0) + (closing ? 1 : 0);
    let ws = weeksByEmp.get(a.employeeId);
    if (!ws) weeksByEmp.set(a.employeeId, (ws = new Set()));
    ws.add(a.cycleId);
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
    // reliability: response rate over the cycles that existed since the employee joined,
    // minus a small penalty for each shift they dropped (swap-out). An approved standing
    // pattern counts as a full response (their availability is known every week).
    const eligibleCycles = cycles.filter((c) => (cycleStart.get(c.id) ?? new Date(0)) >= e.createdAt).length || cycles.length || 1;
    const responded = respondedCycles.get(e.id)?.size ?? 0;
    const responseRate = hasStandingPattern.has(e.id) ? 1 : Math.min(1, responded / eligibleCycles);
    const reliability = Math.max(0, Math.min(100, Math.round(responseRate * 100) - a.swapOuts * 5));
    // tenure-normalised fairness: undesirable load per week actually worked, so a 3-year
    // veteran and a new hire are comparable (raw lifetime load conflates tenure with unfairness).
    const weeksWorked = weeksByEmp.get(e.id)?.size ?? 0;
    const undesirablePerWeek = weeksWorked > 0 ? Math.round((a.undesirableLoad / weeksWorked) * 100) / 100 : 0;
    return {
      id: e.id,
      name: e.name,
      active: e.active,
      isMinor: e.isMinor,
      age: ageFromBirth(e.birthDate),
      optInStatus: e.optInStatus,
      roleNames: e.roles.map((r) => roleName.get(r.roleId) ?? '—'),
      phone: e.phone,
      hourlyRate: e.hourlyRate,
      shifts: a.shifts,
      hours: Math.round(a.hours * 10) / 10,
      laborCost: Math.round(a.laborCost),
      weekendShifts: a.weekendShifts,
      closingShifts: a.closingShifts,
      undesirableLoad: a.undesirableLoad,
      undesirablePerWeek,
      weeksWorked,
      swapOuts: a.swapOuts,
      swapIns: a.swapIns,
      avgShiftsPerWeek: Math.round((a.shifts / weeks) * 10) / 10,
      belowMin: a.shifts / weeks < e.minShifts,
      reliability,
      responseRate: Math.round(responseRate * 100) / 100,
      rank: 0,
    };
  });

  // rank employees by contribution (shifts, then hours); only those who actually worked
  const ranked = employeeReports.slice().sort((x, y) => y.shifts - x.shifts || y.hours - x.hours);
  let place = 0;
  for (const er of ranked) er.rank = er.shifts > 0 ? ++place : 0;

  const requiredPerWeek = demand.reduce((s, d) => s + d.count, 0);
  const totalRequired = requiredPerWeek * Math.max(1, dataWeeks);
  const totalShifts = assignments.length;
  const totalHours = Math.round(employeeReports.reduce((s, e) => s + e.hours, 0) * 10) / 10;
  const totalLaborCost = employeeReports.reduce((s, e) => s + e.laborCost, 0);

  // open gaps in the most recent cycle that has a schedule
  const current = cycles.find((c) => dataCycleIds.has(c.id));
  let openGaps = 0;
  if (current) {
    const bySlot = new Map<string, { startTime: string; endTime: string }[]>();
    for (const a of assignments) if (a.cycleId === current.id) {
      const list = bySlot.get(a.slotId) ?? [];
      list.push({ startTime: a.startTime, endTime: a.endTime ?? a.shift.endTime });
      bySlot.set(a.slotId, list);
    }
    for (const d of demand) openGaps += slotDeficit(d.startTime, d.shift.endTime, d.count, bySlot.get(d.id) ?? []);
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
      weeklyLaborBudget: org.weeklyLaborBudget,
      avgWeeklyLaborCost: Math.round(totalLaborCost / weeks),
    },
    employees: ranked,
  };
}

// 4.1 + 4.2 — per-published-week trend series for the charts.
export async function buildTrends(orgId: string): Promise<TrendPoint[]> {
  const [org, cycles, demand] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.weekCycle.findMany({ where: { orgId }, orderBy: { weekStartDate: 'asc' } }),
    prisma.shiftSlot.findMany({ where: { shift: { orgId } }, include: { shift: true } }),
  ]);
  const rules = parseLaborRules(org.laborRules);
  const requiredPerWeek = demand.reduce((s, d) => s + d.count, 0);
  const cycleIds = cycles.map((c) => c.id);
  const [assignments, employees] = await Promise.all([
    prisma.assignment.findMany({ where: { cycleId: { in: cycleIds }, status: 'published' }, include: { shift: true } }),
    prisma.employee.findMany({ where: { orgId }, select: { id: true, hourlyRate: true } }),
  ]);
  const rateOf = new Map(employees.map((e) => [e.id, e.hourlyRate]));

  const byCycle = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = byCycle.get(a.cycleId) ?? [];
    list.push(a);
    byCycle.set(a.cycleId, list);
  }

  const points: TrendPoint[] = [];
  for (const c of cycles) {
    const list = byCycle.get(c.id);
    if (!list || list.length === 0) continue; // only weeks that actually had a published schedule
    let cost = 0;
    let hours = 0;
    let forced = 0;
    const undByEmp = new Map<string, number>();
    for (const a of list) {
      const endT = a.endTime ?? a.shift.endTime;
      const hrs = shiftDuration(a.startTime, endT) / 60;
      hours += hrs;
      cost += hrs * (rateOf.get(a.employeeId) ?? 0);
      if (a.forced) forced += 1;
      const und = (WEEKEND_DAYS.includes(a.shift.dayIndex) ? 1 : 0) + (endHour(a.startTime, endT) >= rules.closingHour ? 1 : 0);
      if (und > 0) undByEmp.set(a.employeeId, (undByEmp.get(a.employeeId) ?? 0) + und);
    }
    const loads = [...undByEmp.values()];
    const spread = loads.length ? Math.max(...loads) - Math.min(...loads) : 0;
    const gaps = Math.max(0, requiredPerWeek - list.length);
    const revenue = c.revenue ?? null;
    points.push({
      cycleId: c.id,
      weekStartDate: c.weekStartDate.toISOString(),
      coveragePct: requiredPerWeek ? Math.round((Math.min(list.length, requiredPerWeek) / requiredPerWeek) * 100) : 100,
      laborCost: Math.round(cost),
      hours: Math.round(hours * 10) / 10,
      shifts: list.length,
      forced,
      gaps,
      fairnessSpread: spread,
      revenue,
      laborPctOfRevenue: revenue && revenue > 0 ? Math.round((cost / revenue) * 1000) / 10 : null,
      budget: org.weeklyLaborBudget,
    });
  }
  return points;
}
