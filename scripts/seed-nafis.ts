// Populate the "nafis" business (manager username 'shahar') with 55 unconfigured
// waiters + the exact shift skeleton requested. No availability, no schedule.
import { prisma } from '../server/src/db';

async function main() {
  const mgr = await prisma.manager.findFirst({ where: { username: 'shahar' } });
  if (!mgr?.orgId) throw new Error('לא נמצא עסק למשתמש shahar');
  const orgId = mgr.orgId;

  // waiter role
  const roles = await prisma.role.findMany({ where: { orgId } });
  const waiter = roles.find((r) => r.name === 'מלצר') ?? (await prisma.role.create({ data: { orgId, name: 'מלצר' } }));

  // --- 55 distinct names ---
  const first = ['אבי', 'נועה', 'יוסי', 'מאיה', 'דוד', 'שירה', 'רון', 'טל', 'עומר', 'ליאור', 'גיל', 'דנה', 'איתי', 'נטע', 'עידו', 'רותם', 'אלון', 'הדר', 'ניר', 'שני', 'עמית', 'יעל', 'אורי', 'מור', 'בר', 'גל', 'תום', 'עדן', 'נדב', 'רוני', 'יובל', 'אלה', 'דור', 'ספיר', 'אסף'];
  const last = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אזולאי', 'דהן', 'אברהם', 'פרידמן', 'חדד', 'גבאי'];
  const names: string[] = [];
  let fi = 0, li = 0;
  while (names.length < 55) { names.push(`${first[fi % first.length]} ${last[li % last.length]}`); fi++; if (fi % first.length === 0) li++; }

  const existing = await prisma.employee.count({ where: { orgId } });
  if (existing === 0) {
    for (const name of names) {
      await prisma.employee.create({
        data: { orgId, name, phone: '', isMinor: false, minShifts: 0, maxShifts: 6, hourlyRate: 0, optInStatus: 'pending', roles: { create: [{ roleId: waiter.id }] } },
      });
    }
    console.log(`✓ created ${names.length} waiters (unconfigured)`);
  } else {
    console.log(`skip employees — org already has ${existing}`);
  }

  // --- ensure morning + evening shifts per day ---
  async function ensureShift(dayIndex: number, label: string, startTime: string, endTime: string, order: number, colorTier: number) {
    const found = await prisma.shift.findFirst({ where: { orgId, dayIndex, label } });
    if (found) return found;
    return prisma.shift.create({ data: { orgId, dayIndex, label, startTime, endTime, order, colorTier } });
  }

  // per-day plan: [count, startTime]
  const M = {
    sun: [[2, '08:00'], [1, '10:00'], [1, '11:00'], [2, '11:40'], [3, '12:40']],
    mon: [[2, '08:00'], [1, '10:00'], [1, '11:00'], [2, '11:40'], [2, '12:40']],
    fri: [[3, '08:00'], [2, '09:00'], [1, '10:00'], [1, '11:00'], [6, '11:40']],
  } as const;
  const E = {
    sun: [[2, '16:00'], [7, '16:45'], [4, '18:00']],
    mon: [[2, '16:00'], [7, '16:45'], [3, '18:00']],
    fri: [[3, '16:00'], [6, '16:45'], [4, '18:00']],
    sat: [[4, '16:00'], [9, '16:45']],
  } as const;

  const days: { day: number; morning: readonly (readonly [number, string])[]; evening: readonly (readonly [number, string])[] }[] = [
    { day: 0, morning: M.sun, evening: E.sun }, // ראשון
    { day: 1, morning: M.mon, evening: E.mon }, // שני
    { day: 2, morning: M.sun, evening: E.mon }, // שלישי = בוקר ראשון + ערב שני
    { day: 3, morning: M.sun, evening: E.mon }, // רביעי = שלישי
    { day: 4, morning: M.sun, evening: E.sun }, // חמישי = ראשון
    { day: 5, morning: M.fri, evening: E.fri }, // שישי
    { day: 6, morning: M.fri, evening: E.sat }, // שבת: בוקר כמו שישי, ערב מיוחד
  ];

  // clear existing slots, then rebuild
  await prisma.shiftSlot.deleteMany({ where: { shift: { orgId } } });

  for (const d of days) {
    const morning = await ensureShift(d.day, 'בוקר', '08:00', '16:00', 0, 0);
    const evening = await ensureShift(d.day, 'ערב', '16:00', '23:00', 1, 1);
    for (const [count, startTime] of d.morning) await prisma.shiftSlot.create({ data: { shiftId: morning.id, roleId: waiter.id, startTime, count } });
    for (const [count, startTime] of d.evening) await prisma.shiftSlot.create({ data: { shiftId: evening.id, roleId: waiter.id, startTime, count } });
  }
  console.log('✓ shift skeleton built for all 7 days');

  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
