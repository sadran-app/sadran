import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db';

// 2.2b — demand templates: save the current staffing-requirement layout under a name
// ("סידור קיץ") and re-apply it in one click. A template stores requirements by their
// human identity (weekday + shift label/time + role name) so it re-binds to the org's
// shifts/roles even if their ids changed.
interface TemplateItem {
  dayIndex: number;
  shiftLabel: string;
  shiftStart: string;
  roleName: string;
  slotStart: string;
  count: number;
}

export async function templateRoutes(app: FastifyInstance) {
  app.get('/api/demand-templates', async (req) => {
    const rows = await prisma.demandTemplate.findMany({ where: { orgId: req.orgId }, orderBy: { createdAt: 'desc' } });
    return rows.map((t) => ({ id: t.id, name: t.name, createdAt: t.createdAt, items: (JSON.parse(t.data) as TemplateItem[]).length }));
  });

  const createSchema = z.object({ name: z.string().min(1).max(60) });
  app.post('/api/demand-templates', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'שם לא תקין' });
    const slots = await prisma.shiftSlot.findMany({ where: { shift: { orgId: req.orgId } }, include: { shift: true, role: true } });
    const items: TemplateItem[] = slots.map((s) => ({
      dayIndex: s.shift.dayIndex, shiftLabel: s.shift.label, shiftStart: s.shift.startTime,
      roleName: s.role.name, slotStart: s.startTime, count: s.count,
    }));
    const t = await prisma.demandTemplate.create({ data: { orgId: req.orgId, name: parsed.data.name, data: JSON.stringify(items) } });
    return reply.code(201).send({ id: t.id, name: t.name, createdAt: t.createdAt, items: items.length });
  });

  // Replace the current demand layout with the template's.
  app.post('/api/demand-templates/:id/apply', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.demandTemplate.findUnique({ where: { id } });
    if (!t || t.orgId !== req.orgId) return reply.code(404).send({ error: 'תבנית לא נמצאה' });
    const items = JSON.parse(t.data) as TemplateItem[];

    const [shifts, roles] = await Promise.all([
      prisma.shift.findMany({ where: { orgId: req.orgId } }),
      prisma.role.findMany({ where: { orgId: req.orgId } }),
    ]);
    const shiftKey = (dayIndex: number, label: string, start: string) => `${dayIndex}|${label}|${start}`;
    const shiftBy = new Map(shifts.map((s) => [shiftKey(s.dayIndex, s.label, s.startTime), s.id]));
    const roleBy = new Map(roles.map((r) => [r.name, r.id]));

    let applied = 0;
    let unmatched = 0;
    const toCreate: { shiftId: string; roleId: string; startTime: string; count: number }[] = [];
    for (const it of items) {
      const shiftId = shiftBy.get(shiftKey(it.dayIndex, it.shiftLabel, it.shiftStart));
      const roleId = roleBy.get(it.roleName);
      if (!shiftId || !roleId) { unmatched++; continue; }
      toCreate.push({ shiftId, roleId, startTime: it.slotStart, count: it.count });
      applied++;
    }

    await prisma.$transaction([
      prisma.shiftSlot.deleteMany({ where: { shift: { orgId: req.orgId } } }),
      ...(toCreate.length ? [prisma.shiftSlot.createMany({ data: toCreate })] : []),
    ]);
    return { applied, unmatched };
  });

  app.delete('/api/demand-templates/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const t = await prisma.demandTemplate.findUnique({ where: { id } });
    if (!t || t.orgId !== req.orgId) return reply.code(404).send({ error: 'תבנית לא נמצאה' });
    await prisma.demandTemplate.delete({ where: { id } });
    return { ok: true };
  });
}
