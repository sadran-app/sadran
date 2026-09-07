import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getCurrentCycle } from '../db';
import { buildForecast } from '../services/forecast';

export async function forecastRoutes(app: FastifyInstance) {
  // Smart staffing recommendations learned from the org's published history.
  app.get('/api/forecast', async (req) => buildForecast(req.orgId));

  // Mark the expected busyness of shifts for the CURRENT (upcoming) cycle — this
  // scales the recommendations. Tenant-guarded: every shift must belong to this org.
  const loadSchema = z.object({
    items: z.array(z.object({ shiftId: z.string(), level: z.number().int().min(1).max(4) })).min(1),
  });
  app.put('/api/forecast/load', async (req, reply) => {
    const parsed = loadSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'בקשה לא תקינה' });
    const cycle = await getCurrentCycle(req.orgId);
    const ids = parsed.data.items.map((i) => i.shiftId);
    const owned = await prisma.shift.findMany({ where: { id: { in: ids }, orgId: req.orgId }, select: { id: true } });
    const ownedSet = new Set(owned.map((s) => s.id));
    const valid = parsed.data.items.filter((i) => ownedSet.has(i.shiftId));
    if (valid.length === 0) return reply.code(404).send({ error: 'לא נמצאו משמרות מתאימות' });
    await prisma.$transaction(valid.map((i) =>
      prisma.shiftLoad.upsert({
        where: { cycleId_shiftId: { cycleId: cycle.id, shiftId: i.shiftId } },
        create: { cycleId: cycle.id, shiftId: i.shiftId, level: i.level },
        update: { level: i.level },
      }),
    ));
    return { ok: true, updated: valid.length };
  });

  // Apply chosen recommendations to the demand (ShiftSlot.count). Tenant-guarded:
  // every slot must belong to this org, so a manager can't touch another business.
  const applySchema = z.object({
    items: z.array(z.object({ slotId: z.string(), count: z.number().int().min(1).max(50) })).min(1),
  });
  app.post('/api/forecast/apply', async (req, reply) => {
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'בקשה לא תקינה' });
    const ids = parsed.data.items.map((i) => i.slotId);
    const owned = await prisma.shiftSlot.findMany({ where: { id: { in: ids }, shift: { orgId: req.orgId } }, select: { id: true } });
    const ownedSet = new Set(owned.map((s) => s.id));
    const valid = parsed.data.items.filter((i) => ownedSet.has(i.slotId));
    if (valid.length === 0) return reply.code(404).send({ error: 'לא נמצאו דרישות מתאימות' });
    await prisma.$transaction(valid.map((i) => prisma.shiftSlot.update({ where: { id: i.slotId }, data: { count: i.count } })));
    return { ok: true, updated: valid.length };
  });
}
