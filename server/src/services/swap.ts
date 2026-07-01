// Swap engine — end-to-end shift replacement, reusing the SAME hard-constraint
// eligibility as the scheduler so a claimed shift can never break a labor rule.

import { isEligible, undesirableWeight, type AvailabilityState, type EngineEmployee, type Slot } from '@engine';
import { prisma, parseLaborRules, getOrgById } from '../db';
import { channel } from '../channel';
import { WEEKEND_DAYS } from './schedule';

type AssignmentWithRefs = Awaited<ReturnType<typeof loadAssignment>>;

function loadAssignment(assignmentId: string) {
  return prisma.assignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { shift: true, slot: true, role: true, employee: true },
  });
}

function slotOf(a: AssignmentWithRefs): Slot {
  return {
    dayIndex: a.shift.dayIndex,
    shiftId: a.shiftId,
    slotId: a.slotId,
    roleId: a.roleId,
    startTime: a.startTime,
    endTime: a.shift.endTime,
  };
}

/** Everyone (except the current holder) who could legally take this shift right now. */
export async function eligibleForAssignment(assignment: AssignmentWithRefs): Promise<EngineEmployee[]> {
  const orgId = assignment.employee.orgId;
  const org = await getOrgById(orgId);
  const rules = parseLaborRules(org.laborRules);

  const [employees, availability, cycleAssignmentsRaw] = await Promise.all([
    prisma.employee.findMany({ where: { orgId, active: true }, include: { roles: true } }),
    prisma.availability.findMany({ where: { cycleId: assignment.cycleId } }),
    prisma.assignment.findMany({ where: { cycleId: assignment.cycleId }, include: { shift: true } }),
  ]);
  const cycleAssignments = cycleAssignmentsRaw.map((a) => ({
    employeeId: a.employeeId,
    shiftId: a.shiftId,
    slotId: a.slotId,
    roleId: a.roleId,
    dayIndex: a.shift.dayIndex,
    startTime: a.startTime,
    endTime: a.shift.endTime,
  }));

  const availByEmp = new Map<string, Map<string, AvailabilityState>>();
  for (const a of availability) {
    let m = availByEmp.get(a.employeeId);
    if (!m) availByEmp.set(a.employeeId, (m = new Map()));
    m.set(a.shiftId, a.state as AvailabilityState);
  }

  const assignmentsByEmp = new Map<string, typeof cycleAssignments>();
  for (const a of cycleAssignments) {
    const list = assignmentsByEmp.get(a.employeeId) ?? [];
    list.push(a);
    assignmentsByEmp.set(a.employeeId, list);
  }

  const slot = slotOf(assignment);
  const ctx = { availByEmp, rules };

  return employees
    .filter((e) => e.id !== assignment.employeeId)
    .map((e) => ({
      id: e.id,
      name: e.name,
      roleIds: e.roles.map((r) => r.roleId),
      minShifts: e.minShifts,
      maxShifts: e.maxShifts,
      isMinor: e.isMinor,
      fairnessCredit: e.fairnessCredit,
    }))
    .filter((e) => isEligible(e, slot, assignmentsByEmp.get(e.id) ?? [], ctx));
}

/** "נפל ממשמרת": open the shift and broadcast it to every eligible employee. */
export async function vacateAndBroadcast(assignmentId: string) {
  const assignment = await loadAssignment(assignmentId);

  const swap = await prisma.swapRequest.create({
    data: { cycleId: assignment.cycleId, assignmentId, status: 'open', previousHolderId: assignment.employeeId },
  });

  const eligible = await eligibleForAssignment(assignment);
  const eligibleEmployees = await prisma.employee.findMany({ where: { id: { in: eligible.map((e) => e.id) } } });

  await channel.broadcastOpenShift(
    eligibleEmployees.map((e) => ({ id: e.id, name: e.name, phone: e.phone })),
    { dayIndex: assignment.shift.dayIndex, blockLabel: assignment.shift.label, waveTime: assignment.startTime, roleName: assignment.role.name },
  );

  return { swap, eligible };
}

export async function claimSwap(swapId: string, employeeId: string) {
  const swap = await prisma.swapRequest.findUniqueOrThrow({ where: { id: swapId } });
  if (swap.status !== 'open') throw new Error('בקשת ההחלפה כבר לא פתוחה');

  const assignment = await loadAssignment(swap.assignmentId);
  const eligible = await eligibleForAssignment(assignment);
  if (!eligible.some((e) => e.id === employeeId)) {
    throw new Error('העובד אינו זכאי למשמרת הזו (תפקיד/זמינות/מנוחה/מקס׳)');
  }

  return prisma.swapRequest.update({ where: { id: swapId }, data: { status: 'claimed', claimedById: employeeId } });
}

/** Manager approval: reassign the shift, update fairness, notify both employees. */
export async function approveSwap(swapId: string, approvedById?: string) {
  const swap = await prisma.swapRequest.findUniqueOrThrow({ where: { id: swapId } });
  if (swap.status !== 'claimed' || !swap.claimedById) throw new Error('אין למי לאשר — הבקשה לא נתפסה');

  const assignment = await loadAssignment(swap.assignmentId);
  const previousHolderId = assignment.employeeId;
  const claimantId = swap.claimedById;

  const org = await getOrgById(assignment.employee.orgId);
  const rules = parseLaborRules(org.laborRules);
  const weight = undesirableWeight(slotOf(assignment), WEEKEND_DAYS, rules);

  await prisma.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id: assignment.id }, data: { employeeId: claimantId } });
    await tx.swapRequest.update({ where: { id: swapId }, data: { status: 'approved', approvedById } });
    if (weight > 0) {
      await adjustFairness(tx, swap.cycleId, previousHolderId, -weight, -1);
      await adjustFairness(tx, swap.cycleId, claimantId, weight, 1);
    }
  });

  const [prev, next] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: previousHolderId } }),
    prisma.employee.findUniqueOrThrow({ where: { id: claimantId } }),
  ]);
  await channel.notify(
    { id: prev.id, name: prev.name, phone: prev.phone },
    `המשמרת שלך (יום ${assignment.shift.dayIndex}, ${assignment.shift.label} ${assignment.startTime}) הוחלפה ואושרה. אתה משוחרר ממנה.`,
  );
  await channel.notify(
    { id: next.id, name: next.name, phone: next.phone },
    `אושרה לך משמרת: יום ${assignment.shift.dayIndex}, ${assignment.shift.label} ${assignment.startTime} (${assignment.role.name}).`,
  );

  return { swapId, previousHolderId, claimantId };
}

export async function rejectSwap(swapId: string, approvedById?: string) {
  return prisma.swapRequest.update({ where: { id: swapId }, data: { status: 'rejected', approvedById } });
}

async function adjustFairness(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  cycleId: string,
  employeeId: string,
  loadDelta: number,
  countDelta: number,
) {
  const existing = await tx.fairnessLog.findFirst({ where: { cycleId, employeeId } });
  if (existing) {
    await tx.fairnessLog.update({
      where: { id: existing.id },
      data: { undesirableLoad: Math.max(0, existing.undesirableLoad + loadDelta), count: Math.max(0, existing.count + countDelta) },
    });
  } else {
    await tx.fairnessLog.create({ data: { cycleId, employeeId, undesirableLoad: Math.max(0, loadDelta), count: Math.max(0, countDelta) } });
  }
}
