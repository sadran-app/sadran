// Command-center dashboard — one aggregated snapshot of "what needs the manager's
// attention this week", built in a SINGLE batched round-trip. Backs the home screen
// (rec 1.1 + 1.2): coverage, forced assignments to approve, availability response,
// open swap requests, and the current draft's labour cost.

import { shiftDuration } from '@engine';
import { prisma, getCurrentCycle } from '../db';
import { currentGaps } from './gaps';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
// A swap is "open" (needs the manager's attention) while it's waiting for a
// claimant ('open') or waiting for the manager to approve a claim ('claimed').
const OPEN_SWAP = ['open', 'claimed'];

export async function buildDashboard(orgId: string) {
  const cycle = await getCurrentCycle(orgId);

  const [employees, assignments, availability, dayAvail, swaps, gaps, demand] = await Promise.all([
    prisma.employee.findMany({ where: { orgId, active: true }, select: { id: true, name: true, hourlyRate: true } }),
    prisma.assignment.findMany({
      where: { cycleId: cycle.id, status: { in: ['proposed', 'published'] } },
      include: { employee: { select: { name: true, hourlyRate: true } }, shift: true, role: true },
    }),
    prisma.availability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
    prisma.dayAvailability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
    prisma.swapRequest.findMany({
      where: { cycleId: cycle.id, status: { in: OPEN_SWAP } },
      orderBy: { createdAt: 'desc' },
      include: { assignment: { include: { shift: true, role: true, employee: { select: { name: true } } } } },
    }),
    currentGaps(orgId, cycle.id),
    prisma.shiftSlot.findMany({ where: { shift: { orgId } }, select: { count: true } }),
  ]);

  // coverage — denominator is TOTAL demand (currentGaps returns only deficit slots)
  const required = demand.reduce((s, d) => s + d.count, 0);
  const missing = gaps.reduce((s, g) => s + g.missing, 0);
  const covered = Math.max(0, required - missing);
  const coveragePct = required > 0 ? Math.round((covered / required) * 100) : 100;

  // forced assignments awaiting approval
  const forced = assignments
    .filter((a) => a.forced)
    .map((a) => ({
      id: a.id,
      employeeName: a.employee.name,
      dayIndex: a.shift.dayIndex,
      dayName: DAY_NAMES[a.shift.dayIndex],
      shiftLabel: a.shift.label,
      startTime: a.startTime,
      roleName: a.role.name,
      reason: a.forceReason ?? '',
    }));

  // availability response (WhatsApp reply OR manual config)
  const responded = new Set([...availability, ...dayAvail].map((r) => r.employeeId));
  const pending = employees.filter((e) => !responded.has(e.id)).map((e) => e.name);
  const respondedCount = employees.filter((e) => responded.has(e.id)).length;

  // current-draft labour cost (live — reflects manual edits, not only after generate)
  let laborCost = 0;
  let laborHours = 0;
  for (const a of assignments) {
    const hrs = shiftDuration(a.startTime, a.endTime ?? a.shift.endTime) / 60;
    laborHours += hrs;
    laborCost += hrs * (a.employee.hourlyRate ?? 0);
  }

  const openSwaps = swaps.map((s) => ({
    id: s.id,
    status: s.status,
    dayName: DAY_NAMES[s.assignment.shift.dayIndex],
    shiftLabel: s.assignment.shift.label,
    startTime: s.assignment.startTime,
    roleName: s.assignment.role.name,
    holderName: s.assignment.employee.name,
  }));

  return {
    cycle: { id: cycle.id, weekStartDate: cycle.weekStartDate, status: cycle.status },
    coverage: { required, filled: covered, missing, coveragePct },
    forced,
    availability: { total: employees.length, responded: respondedCount, pending },
    swaps: openSwaps,
    labor: { cost: Math.round(laborCost), hours: Math.round(laborHours * 10) / 10 },
    counts: {
      assignments: assignments.length,
      forced: forced.length,
      pendingAvailability: pending.length,
      openSwaps: openSwaps.length,
      gaps: missing,
    },
  };
}
