import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getOrgById } from '../db';

const HHMM = z.string().regex(/^\d{2}:\d{2}$/, 'שעה בפורמט HH:MM');

export async function configRoutes(app: FastifyInstance) {
  // Full config bundle for the Settings screen.
  app.get('/api/config', async (req) => {
    const org = await getOrgById(req.orgId);
    const [roles, shifts] = await Promise.all([
      prisma.role.findMany({ where: { orgId: org.id } }),
      prisma.shift.findMany({
        where: { orgId: org.id },
        orderBy: [{ dayIndex: 'asc' }, { order: 'asc' }],
        include: { slots: true },
      }),
    ]);
    return {
      org: { id: org.id, name: org.name, timezone: org.timezone },
      laborRules: JSON.parse(org.laborRules),
      automation: { autoMessage: org.autoMessage, autoSendDay: org.autoSendDay, autoSendTime: org.autoSendTime },
      roles,
      shifts,
    };
  });

  // ---- roles (professions) ----
  const roleSchema = z.object({ name: z.string().min(1).max(40) });

  app.post('/api/config/roles', async (req, reply) => {
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return reply.code(201).send(await prisma.role.create({ data: { orgId: req.orgId, name: parsed.data.name } }));
  });

  app.put('/api/config/roles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role || role.orgId !== req.orgId) return reply.code(404).send({ error: 'תפקיד לא נמצא' });
    const parsed = roleSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return prisma.role.update({ where: { id }, data: { name: parsed.data.name } });
  });

  app.delete('/api/config/roles/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const role = await prisma.role.findUnique({ where: { id } });
    if (!role || role.orgId !== req.orgId) return reply.code(404).send({ error: 'תפקיד לא נמצא' });
    const [emps, slots] = await Promise.all([
      prisma.employeeRole.count({ where: { roleId: id } }),
      prisma.shiftSlot.count({ where: { roleId: id } }),
    ]);
    if (emps > 0 || slots > 0) {
      return reply.code(409).send({ error: `אי אפשר למחוק — התפקיד בשימוש (${emps} עובדים, ${slots} דרישות בסידור)` });
    }
    await prisma.role.delete({ where: { id } });
    return { ok: true };
  });

  // ---- automation (auto availability request) ----
  const automationSchema = z.object({
    autoMessage: z.string().min(1).max(500),
    autoSendDay: z.number().int().min(0).max(6),
    autoSendTime: HHMM,
  });

  app.put('/api/config/automation', async (req, reply) => {
    const parsed = automationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await prisma.organization.update({ where: { id: req.orgId }, data: parsed.data });
    return parsed.data;
  });

  const laborRulesSchema = z.object({
    minRestHours: z.number().min(0).max(24),
    maxWeeklyHours: z.number().min(0).max(168),
    maxDailyHours: z.number().min(0).max(24),
    minorCurfewHour: z.number().min(0).max(24),
    closingHour: z.number().min(0).max(24),
  });

  app.put('/api/config/labor-rules', async (req, reply) => {
    const parsed = laborRulesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    await prisma.organization.update({ where: { id: req.orgId }, data: { laborRules: JSON.stringify(parsed.data) } });
    return parsed.data;
  });

  // ---- shifts (segments per weekday) ----
  const shiftSchema = z.object({
    dayIndex: z.number().int().min(0).max(6),
    label: z.string().min(1),
    startTime: HHMM,
    endTime: HHMM,
    colorTier: z.number().int().min(0).max(3).optional(),
  });

  app.post('/api/config/shifts', async (req, reply) => {
    const parsed = shiftSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const count = await prisma.shift.count({ where: { orgId: req.orgId, dayIndex: parsed.data.dayIndex } });
    const shift = await prisma.shift.create({
      data: {
        orgId: req.orgId,
        dayIndex: parsed.data.dayIndex,
        label: parsed.data.label,
        startTime: parsed.data.startTime,
        endTime: parsed.data.endTime,
        order: count,
        colorTier: parsed.data.colorTier ?? count % 4,
      },
      include: { slots: true },
    });
    return reply.code(201).send(shift);
  });

  app.put('/api/config/shifts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await prisma.shift.findUnique({ where: { id } });
    if (!owned || owned.orgId !== req.orgId) return reply.code(404).send({ error: 'משמרת לא נמצאה' });
    const parsed = shiftSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return prisma.shift.update({ where: { id }, data: parsed.data, include: { slots: true } });
  });

  app.delete('/api/config/shifts/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await prisma.shift.findUnique({ where: { id } });
    if (!owned || owned.orgId !== req.orgId) return reply.code(404).send({ error: 'משמרת לא נמצאה' });
    await prisma.shift.delete({ where: { id } });
    return { ok: true };
  });

  // ---- shift slots (role requirements inside a shift) ----
  const slotSchema = z.object({ roleId: z.string(), startTime: HHMM, count: z.number().int().min(0).max(50) });

  async function ownShift(orgId: string, shiftId: string) {
    const s = await prisma.shift.findUnique({ where: { id: shiftId } });
    return s && s.orgId === orgId ? s : null;
  }

  app.post('/api/config/shifts/:id/slots', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownShift(req.orgId, id))) return reply.code(404).send({ error: 'משמרת לא נמצאה' });
    const parsed = slotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return reply.code(201).send(await prisma.shiftSlot.create({ data: { shiftId: id, ...parsed.data } }));
  });

  app.put('/api/config/slots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const slot = await prisma.shiftSlot.findUnique({ where: { id }, include: { shift: true } });
    if (!slot || slot.shift.orgId !== req.orgId) return reply.code(404).send({ error: 'דרישה לא נמצאה' });
    const parsed = slotSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    return prisma.shiftSlot.update({ where: { id }, data: parsed.data });
  });

  app.delete('/api/config/slots/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const slot = await prisma.shiftSlot.findUnique({ where: { id }, include: { shift: true } });
    if (!slot || slot.shift.orgId !== req.orgId) return reply.code(404).send({ error: 'דרישה לא נמצאה' });
    await prisma.shiftSlot.delete({ where: { id } });
    return { ok: true };
  });
}
