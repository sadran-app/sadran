import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

// 3.1 time-off (vacation / reserve / sick) + 3.2 standing availability rules.
// Both support an approval flow: manager-created rows are approved immediately;
// employee-originated (WhatsApp) rows arrive as 'pending' for the manager to approve.
export async function requestRoutes(app: FastifyInstance) {
  const ownEmployee = async (orgId: string, employeeId: string) => {
    const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { orgId: true } });
    return !!e && e.orgId === orgId;
  };

  // ---------- time-off ----------
  app.get('/api/time-off', async (req) => {
    const rows = await prisma.timeOffRequest.findMany({
      where: { orgId: req.orgId },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      include: { employee: { select: { name: true } } },
    });
    return rows.map((t) => ({ id: t.id, employeeId: t.employeeId, employeeName: t.employee.name, type: t.type, startDate: t.startDate, endDate: t.endDate, status: t.status, source: t.source, note: t.note }));
  });

  const timeOffSchema = z.object({
    employeeId: z.string(),
    type: z.enum(['vacation', 'reserve', 'sick', 'other']).default('vacation'),
    startDate: z.string(), // 'YYYY-MM-DD'
    endDate: z.string(),
    note: z.string().max(300).optional(),
  });
  app.post('/api/time-off', async (req, reply) => {
    const parsed = timeOffSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    if (!(await ownEmployee(req.orgId, d.employeeId))) return reply.code(404).send({ error: 'עובד לא נמצא' });
    const start = new Date(d.startDate);
    const end = new Date(d.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return reply.code(400).send({ error: 'טווח תאריכים לא תקין' });
    const t = await prisma.timeOffRequest.create({
      data: { orgId: req.orgId, employeeId: d.employeeId, type: d.type, startDate: start, endDate: end, note: d.note ?? null, status: 'approved', source: 'manager' },
    });
    return reply.code(201).send(t);
  });

  app.put('/api/time-off/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.timeOffRequest.findUnique({ where: { id } });
    if (!t || t.orgId !== req.orgId) return reply.code(404).send({ error: 'בקשה לא נמצאה' });
    const parsed = z.object({ status: z.enum(['pending', 'approved', 'rejected']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'סטטוס לא תקין' });
    await prisma.timeOffRequest.update({ where: { id }, data: { status: parsed.data.status } });
    return { ok: true, status: parsed.data.status };
  });

  app.delete('/api/time-off/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.timeOffRequest.findUnique({ where: { id } });
    if (!t || t.orgId !== req.orgId) return reply.code(404).send({ error: 'בקשה לא נמצאה' });
    await prisma.timeOffRequest.delete({ where: { id } });
    return { ok: true };
  });

  // ---------- standing availability rules ----------
  app.get('/api/standing-rules', async (req) => {
    const rows = await prisma.standingRule.findMany({
      where: { orgId: req.orgId },
      orderBy: [{ status: 'asc' }, { dayIndex: 'asc' }],
      include: { employee: { select: { name: true } } },
    });
    return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employee.name, dayIndex: r.dayIndex, mode: r.mode, fromTime: r.fromTime, toTime: r.toTime, status: r.status, source: r.source, note: r.note }));
  });

  const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
  const standingSchema = z.object({
    employeeId: z.string(),
    dayIndex: z.number().int().min(0).max(6),
    mode: z.enum(['off', 'hours']).default('off'),
    fromTime: HHMM.optional(),
    toTime: HHMM.optional(),
    note: z.string().max(300).optional(),
  });
  app.post('/api/standing-rules', async (req, reply) => {
    const parsed = standingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    if (!(await ownEmployee(req.orgId, d.employeeId))) return reply.code(404).send({ error: 'עובד לא נמצא' });
    if (d.mode === 'hours' && (!d.fromTime || !d.toTime)) return reply.code(400).send({ error: 'יש להזין שעות התחלה וסיום' });
    const r = await prisma.standingRule.create({
      data: { orgId: req.orgId, employeeId: d.employeeId, dayIndex: d.dayIndex, mode: d.mode, fromTime: d.mode === 'hours' ? d.fromTime : null, toTime: d.mode === 'hours' ? d.toTime : null, note: d.note ?? null, status: 'approved', source: 'manager' },
    });
    return reply.code(201).send(r);
  });

  app.put('/api/standing-rules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await prisma.standingRule.findUnique({ where: { id } });
    if (!r || r.orgId !== req.orgId) return reply.code(404).send({ error: 'כלל לא נמצא' });
    const parsed = z.object({ status: z.enum(['pending', 'approved']) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'סטטוס לא תקין' });
    await prisma.standingRule.update({ where: { id }, data: { status: parsed.data.status } });
    return { ok: true, status: parsed.data.status };
  });

  app.delete('/api/standing-rules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await prisma.standingRule.findUnique({ where: { id } });
    if (!r || r.orgId !== req.orgId) return reply.code(404).send({ error: 'כלל לא נמצא' });
    await prisma.standingRule.delete({ where: { id } });
    return { ok: true };
  });
}
