import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getCurrentCycle, assignmentInOrg } from '../db';
import { generateAndStore, slotFromDemand } from '../services/schedule';
import { checkSlot, candidatesForSlot } from '../services/eligibility';
import { currentGaps } from '../services/gaps';
import { publishCycle } from '../services/publish';

export async function scheduleRoutes(app: FastifyInstance) {
  // The grid: cycle + assignments + live gaps + fairness.
  app.get('/api/cycle', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    const [assignments, gaps, fairness] = await Promise.all([
      prisma.assignment.findMany({
        where: { cycleId: cycle.id, status: { in: ['proposed', 'published'] } },
        include: { employee: true, shift: true },
      }),
      currentGaps(req.orgId, cycle.id),
      prisma.fairnessLog.findMany({ where: { cycleId: cycle.id } }),
    ]);

    return {
      cycle: { id: cycle.id, weekStartDate: cycle.weekStartDate, status: cycle.status },
      assignments: assignments.map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        employeeName: a.employee.name,
        dayIndex: a.shift.dayIndex,
        shiftId: a.shiftId,
        slotId: a.slotId,
        roleId: a.roleId,
        startTime: a.startTime,
        status: a.status,
      })),
      gaps,
      fairness,
    };
  });

  app.post('/api/cycle/generate', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    const result = await generateAndStore(req.orgId, cycle.id);
    return { warnings: result.warnings, gapCount: result.gaps.length, assigned: result.assignments.length };
  });

  app.post('/api/cycle/publish', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    return publishCycle(cycle.id);
  });

  const addSchema = z.object({ employeeId: z.string(), slotId: z.string(), force: z.boolean().optional() });

  // Manual add: fill one seat of a demand requirement. Validated unless force=true.
  app.post('/api/assignments', async (req, reply) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { employeeId, slotId, force } = parsed.data;
    const cycle = await getCurrentCycle(req.orgId);

    const slot = await slotFromDemand(slotId);
    if (!slot) return reply.code(404).send({ error: 'דרישה לא נמצאה' });

    const { ok, reasons } = await checkSlot(req.orgId, cycle.id, employeeId, slot);
    if (!ok && !force) {
      return reply.code(409).send({ error: 'אי אפשר לשבץ את העובד למשמרת זו', reasons });
    }

    try {
      const created = await prisma.assignment.create({
        data: { cycleId: cycle.id, employeeId, shiftId: slot.shiftId, slotId: slot.slotId, roleId: slot.roleId, startTime: slot.startTime, status: 'proposed' },
      });
      // Forced despite violations → return the reasons so the manager is warned.
      return { ...created, warning: !ok ? reasons : undefined };
    } catch {
      return reply.code(409).send({ error: 'העובד כבר משובץ למשבצת זו' });
    }
  });

  // Candidates for a slot: who can be assigned, and why the rest can't.
  app.get('/api/slots/:slotId/candidates', async (req, reply) => {
    const { slotId } = req.params as { slotId: string };
    const cycle = await getCurrentCycle(req.orgId);
    const slot = await slotFromDemand(slotId);
    if (!slot) return reply.code(404).send({ error: 'דרישה לא נמצאה' });
    // ownership: the slot's shift must belong to this org
    const shift = await prisma.shift.findUnique({ where: { id: slot.shiftId } });
    if (!shift || shift.orgId !== req.orgId) return reply.code(404).send({ error: 'דרישה לא נמצאה' });
    return candidatesForSlot(req.orgId, cycle.id, slot);
  });

  app.delete('/api/assignments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assignmentInOrg(req.orgId, id))) return reply.code(404).send({ error: 'שיבוץ לא נמצא' });
    await prisma.swapRequest.deleteMany({ where: { assignmentId: id } });
    await prisma.assignment.delete({ where: { id } });
    return { ok: true };
  });
}
