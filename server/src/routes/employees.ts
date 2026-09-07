import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getCurrentCycle } from '../db';
import { channel } from '../channel';
import { buildOrgReport } from '../services/reports';

function ageFromBirth(birth?: Date | null): number | null {
  if (!birth) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}
const isMinorFromBirth = (birth?: Date | null) => {
  const a = ageFromBirth(birth);
  return a !== null && a < 18;
};

async function ownEmployee(orgId: string, id: string) {
  const emp = await prisma.employee.findUnique({ where: { id } });
  if (!emp || emp.orgId !== orgId) return null;
  return emp;
}

const quotaFullMessage = (quota: number) =>
  `לא ניתן להוסיף עוד עובדים — הגעת למכסת החבילה (${quota} עובדים). להגדלת החבילה, פנו אלינו.`;

export async function employeeRoutes(app: FastifyInstance) {
  // Employees + their availability for the current cycle (Availability screen).
  app.get('/api/employees', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    const employees = await prisma.employee.findMany({
      where: { orgId: req.orgId },
      include: { roles: true },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    const availability = await prisma.availability.findMany({ where: { cycleId: cycle.id } });
    const dayAvail = await prisma.dayAvailability.findMany({ where: { cycleId: cycle.id } });

    // contribution rank (by PUBLISHED shifts) — for the employee-panel colour coding
    const published = await prisma.assignment.groupBy({
      by: ['employeeId'],
      where: { cycle: { orgId: req.orgId }, status: 'published' },
      _count: { _all: true },
    });
    const rankMap = new Map<string, number>();
    published
      .slice()
      .sort((a, b) => b._count._all - a._count._all)
      .forEach((p, i) => rankMap.set(p.employeeId, i + 1));

    return {
      cycleId: cycle.id,
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        phone: e.phone,
        email: e.email,
        minShifts: e.minShifts,
        maxShifts: e.maxShifts,
        isMinor: e.isMinor,
        birthDate: e.birthDate,
        age: ageFromBirth(e.birthDate),
        hourlyRate: e.hourlyRate,
        active: e.active,
        optInStatus: e.optInStatus,
        fairnessCredit: e.fairnessCredit,
        rank: rankMap.get(e.id) ?? 0,
        employmentNotes: e.employmentNotes,
        roleIds: e.roles.map((r) => r.roleId),
        roleLevels: Object.fromEntries(e.roles.map((r) => [r.roleId, r.level])),
        maxConsecutiveDays: e.maxConsecutiveDays,
        dayAvailability: dayAvail
          .filter((a) => a.employeeId === e.id)
          .map((a) => ({ dayIndex: a.dayIndex, mode: a.mode, fromTime: a.fromTime, toTime: a.toTime })),
        // true once we have ANY availability info for this cycle — a WhatsApp reply
        // (per-shift) or a manual config (day rows). false = "no info yet".
        hasAvailability:
          availability.some((a) => a.employeeId === e.id) || dayAvail.some((a) => a.employeeId === e.id),
      })),
    };
  });

  // all roleIds must belong to this org — blocks FK-violation 500s on a stale/garbage
  // id and cross-tenant role references (attaching another business's role).
  const rolesInOrg = async (orgId: string, roleIds: string[]) => {
    if (!roleIds.length) return true;
    const ids = [...new Set(roleIds)];
    const found = await prisma.role.count({ where: { id: { in: ids }, orgId } });
    return found === ids.length;
  };
  // a provided birthDate string must be a real date — otherwise Prisma throws on the
  // Invalid Date and the request 500s. Returns undefined when absent, null on invalid.
  const parseBirth = (s?: string): Date | null | undefined => {
    if (s === undefined) return undefined;
    if (s === '') return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  };

  const createSchema = z.object({
    name: z.string().trim().min(1).max(80),
    phone: z.string().min(5).max(30),
    email: z.string().email().optional().or(z.literal('')),
    birthDate: z.string().optional(), // 'YYYY-MM-DD'
    hourlyRate: z.number().min(0).max(1000).optional(),
    minShifts: z.number().int().min(0).max(21).optional(),
    maxShifts: z.number().int().min(0).max(21).optional(),
    roleIds: z.array(z.string()).default([]),
  });

  // Add a new employee → auto-enroll into the WhatsApp messaging system
  // (an opt-in / availability request is queued the moment they're created).
  app.post('/api/employees', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    const birth = parseBirth(d.birthDate);
    if (birth === null && d.birthDate) return reply.code(400).send({ error: 'תאריך לידה לא תקין' });
    if (!(await rolesInOrg(req.orgId, d.roleIds))) return reply.code(400).send({ error: 'תפקיד לא נמצא' });

    const org = await prisma.organization.findUnique({ where: { id: req.orgId } });
    // hard cap: never exceed the plan's employee quota set when the business was opened.
    // The count+create runs inside a per-org advisory-locked transaction so concurrent
    // creates serialize — otherwise a check-then-insert race lets N requests each read
    // activeCount<quota and all insert, blowing past the seat limit.
    const orgId = req.orgId;
    const emp = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId})::bigint)`;
      const activeCount = await tx.employee.count({ where: { orgId, active: true } });
      if (org && activeCount >= org.employeeQuota) return null;
      return tx.employee.create({
        data: {
          orgId,
          name: d.name,
          phone: d.phone,
          email: d.email || null,
          birthDate: birth,
          isMinor: isMinorFromBirth(birth),
          hourlyRate: d.hourlyRate ?? 0,
          minShifts: d.minShifts ?? 0,
          maxShifts: d.maxShifts ?? 6,
          optInStatus: 'pending',
          roles: { create: d.roleIds.map((roleId) => ({ roleId })) },
        },
      });
      // The critical section is tiny, but a burst of concurrent creates queues on the
      // advisory lock; raise maxWait so tail requests wait for a pooled connection
      // instead of erroring (P2024) — they still serialize correctly under the cap.
    }, { maxWait: 20000, timeout: 20000 });
    if (!emp) {
      return reply.code(403).send({ error: quotaFullMessage(org!.employeeQuota) });
    }

    // auto-enroll in the channel — but ONLY if this business's plan allows WhatsApp
    if (org?.whatsappEnabled) {
      const cycle = await getCurrentCycle(req.orgId).catch(() => null);
      let sent = 0;
      // configurable welcome message (managed in Settings)
      if (org.welcomeEnabled) {
        await channel.notify({ id: emp.id, name: emp.name, phone: emp.phone }, org.welcomeMessage.replace(/\{שם\}/g, emp.name));
        sent += 1;
      }
      if (cycle) {
        await channel.sendAvailabilityRequest({ id: emp.id, name: emp.name, phone: emp.phone }, cycle.id);
        sent += 1;
      }
      if (sent) await prisma.organization.update({ where: { id: req.orgId }, data: { whatsappMessageCount: { increment: sent } } });
    }

    return reply.code(201).send({ id: emp.id, name: emp.name });
  });

  const updateSchema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    phone: z.string().min(5).max(30).optional(),
    email: z.string().email().optional().or(z.literal('')),
    birthDate: z.string().optional(),
    hourlyRate: z.number().min(0).max(1000).optional(),
    minShifts: z.number().int().min(0).max(21).optional(),
    maxShifts: z.number().int().min(0).max(21).optional(),
    active: z.boolean().optional(),
    roleIds: z.array(z.string()).optional(),
    roleLevels: z.record(z.number().int().min(1).max(5)).optional(), // roleId -> seniority (3.3)
    maxConsecutiveDays: z.number().int().min(1).max(7).nullable().optional(), // 3.3
    employmentNotes: z.string().max(2000).optional(),
  });

  app.put('/api/employees/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await ownEmployee(req.orgId, id);
    if (!existing) return reply.code(404).send({ error: 'עובד לא נמצא' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;

    const birth = parseBirth(d.birthDate);
    if (birth === null && d.birthDate) return reply.code(400).send({ error: 'תאריך לידה לא תקין' });
    if (d.roleIds && !(await rolesInOrg(req.orgId, d.roleIds))) return reply.code(400).send({ error: 'תפקיד לא נמצא' });
    const updateData = {
      ...(d.name !== undefined ? { name: d.name } : {}),
      ...(d.phone !== undefined ? { phone: d.phone } : {}),
      ...(d.email !== undefined ? { email: d.email || null } : {}),
      ...(birth !== undefined ? { birthDate: birth, isMinor: isMinorFromBirth(birth) } : {}),
      ...(d.hourlyRate !== undefined ? { hourlyRate: d.hourlyRate } : {}),
      ...(d.minShifts !== undefined ? { minShifts: d.minShifts } : {}),
      ...(d.maxShifts !== undefined ? { maxShifts: d.maxShifts } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(d.maxConsecutiveDays !== undefined ? { maxConsecutiveDays: d.maxConsecutiveDays } : {}),
      ...(d.employmentNotes !== undefined ? { employmentNotes: d.employmentNotes || null } : {}),
      ...(d.roleIds ? { roles: { deleteMany: {}, create: d.roleIds.map((roleId) => ({ roleId, level: d.roleLevels?.[roleId] ?? 1 })) } } : {}),
    };

    // reactivating a deactivated employee consumes a seat → enforce the quota atomically
    // (same per-org advisory lock as create, so a reactivate can't race past the cap).
    if (d.active === true && !existing.active) {
      const orgId = req.orgId;
      const ok = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orgId})::bigint)`;
        const org = await tx.organization.findUnique({ where: { id: orgId }, select: { employeeQuota: true } });
        const activeCount = await tx.employee.count({ where: { orgId, active: true } });
        if (org && activeCount >= org.employeeQuota) return false;
        await tx.employee.update({ where: { id }, data: updateData });
        return true;
      }, { maxWait: 20000, timeout: 20000 });
      if (!ok) {
        const org = await prisma.organization.findUnique({ where: { id: req.orgId }, select: { employeeQuota: true } });
        return reply.code(403).send({ error: quotaFullMessage(org?.employeeQuota ?? 0) });
      }
      return { ok: true };
    }

    await prisma.employee.update({ where: { id }, data: updateData });
    return { ok: true };
  });

  // Deactivate (soft) — keeps history for reports.
  app.delete('/api/employees/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownEmployee(req.orgId, id))) return reply.code(404).send({ error: 'עובד לא נמצא' });
    await prisma.employee.update({ where: { id }, data: { active: false } });
    return { ok: true };
  });

  // Personal contribution summary (hours/days/rank) sent to the employee via WhatsApp.
  app.post('/api/employees/:id/send-summary', async (req, reply) => {
    const { id } = req.params as { id: string };
    const emp = await ownEmployee(req.orgId, id);
    if (!emp) return reply.code(404).send({ error: 'עובד לא נמצא' });
    const org = await prisma.organization.findUnique({ where: { id: req.orgId } });
    if (!org?.whatsappEnabled) return reply.code(409).send({ error: 'שליחת וואטסאפ אינה מופעלת לעסק זה' });

    const report = await buildOrgReport(req.orgId);
    const r = report.employees.find((e) => e.id === id);
    if (!r) return reply.code(404).send({ error: 'אין נתונים לעובד' });

    const lines = [
      `היי ${emp.name}! הנה הסיכום שלך 📊`,
      `• משמרות שביצעת: ${r.shifts}`,
      `• שעות עבודה: ${r.hours}`,
      `• משמרות סוף שבוע: ${r.weekendShifts} · סגירות: ${r.closingShifts}`,
      r.rank > 0 ? `• הדירוג שלך במסעדה: #${r.rank} 🏆` : '',
      'תודה על העבודה המצוינת! 🙌',
    ].filter(Boolean);
    await channel.notify({ id: emp.id, name: emp.name, phone: emp.phone }, lines.join('\n'));
    await prisma.organization.update({ where: { id: req.orgId }, data: { whatsappMessageCount: { increment: 1 } } });
    return { ok: true, summary: { shifts: r.shifts, hours: r.hours, weekendShifts: r.weekendShifts, closingShifts: r.closingShifts, rank: r.rank } };
  });

  // Free-hours availability: exact hours per day → stored as source of truth, and
  // derived into per-shift Availability so the current engine keeps working.
  const dayAvailSchema = z.object({
    days: z.array(z.object({
      dayIndex: z.number().int().min(0).max(6),
      mode: z.enum(['all', 'off', 'hours', 'unset']),
      fromTime: z.string().nullish(), // string | null | undefined — the client sends null for non-hours days
      toTime: z.string().nullish(),
    })),
  });
  app.put('/api/employees/:id/day-availability', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownEmployee(req.orgId, id))) return reply.code(404).send({ error: 'עובד לא נמצא' });
    const parsed = dayAvailSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const cycle = await getCurrentCycle(req.orgId);
    const shifts = await prisma.shift.findMany({ where: { orgId: req.orgId }, select: { id: true, dayIndex: true, startTime: true, endTime: true } });

    // Store every EXPLICITLY-set day (all/off/hours) so "configured" is detectable;
    // 'unset' days get no row → they stay "no info received yet".
    const records = parsed.data.days
      .filter((d) => d.mode !== 'unset')
      .map((d) => ({ cycleId: cycle.id, employeeId: id, dayIndex: d.dayIndex, mode: d.mode, fromTime: d.fromTime ?? null, toTime: d.toTime ?? null }));
    const perShift: { cycleId: string; employeeId: string; shiftId: string; state: string }[] = [];
    for (const d of parsed.data.days) {
      if (d.mode === 'unset') continue; // no info for this day → derive nothing
      for (const s of shifts.filter((x) => x.dayIndex === d.dayIndex)) {
        let state = 'ok';
        if (d.mode === 'off') state = 'cant';
        else if (d.mode === 'hours' && d.fromTime && d.toTime) state = d.fromTime < s.endTime && s.startTime < d.toTime ? 'ok' : 'cant';
        if (state !== 'ok') perShift.push({ cycleId: cycle.id, employeeId: id, shiftId: s.id, state });
      }
    }
    await prisma.$transaction([
      prisma.dayAvailability.deleteMany({ where: { cycleId: cycle.id, employeeId: id } }),
      prisma.availability.deleteMany({ where: { cycleId: cycle.id, employeeId: id } }),
      ...(records.length ? [prisma.dayAvailability.createMany({ data: records })] : []),
      ...(perShift.length ? [prisma.availability.createMany({ data: perShift })] : []),
    ]);
    return { ok: true };
  });
}
