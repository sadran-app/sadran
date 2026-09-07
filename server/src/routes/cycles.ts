import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getCurrentCycle, getOrgById } from '../db';
import { listCyclesWithStats, cycleDetail } from '../services/cycles';
import { channel } from '../channel';

/** The Sunday (00:00 UTC) of the week that `date` falls in. */
function weekStartOf(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay: 0 = Sunday
  return d;
}

export async function cycleRoutes(app: FastifyInstance) {
  // History: every week with its stats.
  app.get('/api/cycles', async (req) => listCyclesWithStats(req.orgId));

  // Start a new week. The date is snapped to that week's SUNDAY, and only ONE
  // schedule may exist per Sunday→Saturday week (no duplicates, no sub-weeks).
  const newCycleSchema = z.object({ weekStartDate: z.string() });
  app.post('/api/cycles', async (req, reply) => {
    const parsed = newCycleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'תאריך לא תקין' });
    const picked = new Date(parsed.data.weekStartDate + 'T00:00:00Z');
    if (isNaN(picked.getTime())) return reply.code(400).send({ error: 'תאריך לא תקין' });

    const sunday = weekStartOf(picked);
    const weekEnd = new Date(sunday);
    weekEnd.setUTCDate(sunday.getUTCDate() + 7);

    const clash = await prisma.weekCycle.findFirst({
      where: { orgId: req.orgId, weekStartDate: { gte: sunday, lt: weekEnd } },
    });
    if (clash) {
      return reply.code(409).send({ error: `כבר קיים סידור לשבוע שמתחיל ב-${sunday.toISOString().slice(0, 10)}` });
    }

    const cycle = await prisma.weekCycle.create({ data: { orgId: req.orgId, weekStartDate: sunday, status: 'collecting' } });
    return reply.code(201).send({ id: cycle.id, weekStartDate: cycle.weekStartDate, status: cycle.status });
  });

  // View one week (history detail).
  app.get('/api/cycles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await cycleDetail(req.orgId, id);
    if (!detail) return reply.code(404).send({ error: 'שבוע לא נמצא' });
    return detail;
  });

  // Who has / hasn't submitted availability for the current week. "Submitted" = we have
  // ANY info for them this cycle — a WhatsApp reply (per-shift Availability) OR a manual
  // config (DayAvailability, incl. "available all day" which writes no per-shift rows).
  app.get('/api/cycle/availability-status', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    const [employees, availability, dayAvail] = await Promise.all([
      prisma.employee.findMany({ where: { orgId: req.orgId, active: true }, orderBy: { name: 'asc' } }),
      prisma.availability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
      prisma.dayAvailability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
    ]);
    const responded = new Set([...availability, ...dayAvail].map((a) => a.employeeId));
    return {
      cycleId: cycle.id,
      employees: employees.map((e) => ({ id: e.id, name: e.name, responded: responded.has(e.id) })),
    };
  });

  // Live control center: who submitted availability (with time) + who hasn't,
  // plus the issues panel (delivery failures, no phone, opted-out, pending opt-in).
  app.get('/api/cycle/monitor', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    const [employees, availability, dayAvail, org] = await Promise.all([
      prisma.employee.findMany({ where: { orgId: req.orgId, active: true }, orderBy: { name: 'asc' } }),
      prisma.availability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true, createdAt: true } }),
      prisma.dayAvailability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true, createdAt: true } }),
      getOrgById(req.orgId),
    ]);

    // submitted = has WhatsApp availability OR a manual config; "at" = latest of either.
    const lastByEmp = new Map<string, Date>();
    for (const a of [...availability, ...dayAvail]) {
      const cur = lastByEmp.get(a.employeeId);
      if (!cur || a.createdAt > cur) lastByEmp.set(a.employeeId, a.createdAt);
    }
    const submitted = employees.filter((e) => lastByEmp.has(e.id)).map((e) => ({ id: e.id, name: e.name, at: lastByEmp.get(e.id) }));
    const pending = employees.filter((e) => !lastByEmp.has(e.id)).map((e) => ({ id: e.id, name: e.name }));

    const nameById = new Map(employees.map((e) => [e.id, e.name]));
    const failedMsgs = employees.length
      ? await prisma.outboxMessage.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, failed: true }, orderBy: { createdAt: 'desc' }, take: 50 })
      : [];
    const deliveryFailures = failedMsgs.map((m) => ({ employeeId: m.employeeId, name: nameById.get(m.employeeId) ?? '—', kind: m.kind, at: m.createdAt, detail: m.body.slice(0, 160) }));
    const noPhone = employees.filter((e) => !e.phone || e.phone.trim().length < 5).map((e) => ({ id: e.id, name: e.name }));
    const optedOut = employees.filter((e) => e.optInStatus === 'opted_out').map((e) => ({ id: e.id, name: e.name }));
    const pendingOptIn = employees.filter((e) => e.optInStatus === 'pending').map((e) => ({ id: e.id, name: e.name }));

    return {
      cycleId: cycle.id,
      weekStartDate: cycle.weekStartDate,
      status: cycle.status,
      whatsappEnabled: org.whatsappEnabled,
      availability: { total: employees.length, submittedCount: submitted.length, submitted, pending },
      issues: { nonResponders: pending, deliveryFailures, noPhone, optedOut, pendingOptIn },
    };
  });

  // Send the availability request (org's template) to everyone who hasn't replied.
  app.post('/api/cycle/send-availability', async (req) => {
    const org = await getOrgById(req.orgId);
    const cycle = await getCurrentCycle(req.orgId);
    const [employees, availability, dayAvail] = await Promise.all([
      prisma.employee.findMany({ where: { orgId: req.orgId, active: true } }),
      prisma.availability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
      prisma.dayAvailability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
    ]);
    // don't nag anyone we already have info for — WhatsApp reply OR manual config
    const responded = new Set([...availability, ...dayAvail].map((a) => a.employeeId));
    const targets = employees.filter((e) => !responded.has(e.id));
    for (const e of targets) {
      const body = org.autoMessage.replace(/\{שם\}/g, e.name);
      await channel.notify({ id: e.id, name: e.name, phone: e.phone }, body);
    }
    return { sent: targets.length };
  });
}
