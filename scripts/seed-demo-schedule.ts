// Dev-only: populate the "מסעדת הנמל" demo org with employees + shift requirements
// that intentionally exceed staff capacity, so "צור סידור" visibly force-fills.
import { prisma } from '../server/src/db';

async function main() {
  const mgr = await prisma.manager.findFirst({ where: { username: 'hanamal' } });
  if (!mgr?.orgId) throw new Error('demo org "hanamal" not found — run seed-dev first');
  const orgId = mgr.orgId;

  if (await prisma.employee.count({ where: { orgId } })) {
    console.log('demo already has employees — skipping');
    return;
  }

  const roles = await prisma.role.findMany({ where: { orgId } });
  const waiter = roles.find((r) => r.name === 'מלצר') ?? roles[0]!;

  // 3 staff (one minor) — deliberately fewer than demand
  const staff = [
    { name: 'יוסי כהן', phone: '0500000001', isMinor: false },
    { name: 'דנה לוי', phone: '0500000002', isMinor: false },
    { name: 'רון בר (קטין)', phone: '0500000003', isMinor: true },
  ];
  for (const s of staff) {
    await prisma.employee.create({
      data: { orgId, name: s.name, phone: s.phone, isMinor: s.isMinor, maxShifts: 3, minShifts: 1, hourlyRate: 40, optInStatus: 'opted_in', roles: { create: [{ roleId: waiter.id }] } },
    });
  }

  // add requirements to Sun/Mon/Tue: morning + evening each need 2 waiters → 12 seats
  const shifts = await prisma.shift.findMany({ where: { orgId, dayIndex: { in: [0, 1, 2] } } });
  for (const sh of shifts) {
    await prisma.shiftSlot.create({ data: { shiftId: sh.id, roleId: waiter.id, startTime: sh.startTime, count: 2 } });
  }

  // one "cant" so a forced assignment also demonstrates overriding availability
  const cycle = await prisma.weekCycle.findFirst({ where: { orgId }, orderBy: { weekStartDate: 'desc' } });
  const dana = await prisma.employee.findFirst({ where: { orgId, name: 'דנה לוי' } });
  const sunEve = shifts.find((s) => s.dayIndex === 0 && s.label === 'ערב');
  if (cycle && dana && sunEve) {
    await prisma.availability.create({ data: { cycleId: cycle.id, employeeId: dana.id, shiftId: sunEve.id, state: 'cant' } });
  }

  console.log('✓ demo schedule seeded: 3 staff, 12 required seats (Sun–Tue), 1 "cant" → force-fill guaranteed');
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
