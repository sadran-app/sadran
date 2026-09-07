import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getCurrentCycle, assignmentInOrg, swapInOrg } from '../db';
import {
  vacateAndBroadcast,
  claimSwap,
  approveSwap,
  rejectSwap,
  eligibleForAssignment,
} from '../services/swap';

export async function swapRoutes(app: FastifyInstance) {
  // Open swap requests for the manager review screen.
  app.get('/api/swaps', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    const swaps = await prisma.swapRequest.findMany({
      where: { cycleId: cycle.id },
      orderBy: { createdAt: 'desc' },
      include: {
        assignment: { include: { employee: true, shift: true, role: true } },
      },
    });

    const claimantIds = swaps.map((s) => s.claimedById).filter((x): x is string => !!x);
    const claimants = await prisma.employee.findMany({ where: { id: { in: claimantIds } } });
    const nameById = new Map(claimants.map((c) => [c.id, c.name]));

    return swaps.map((s) => ({
      id: s.id,
      status: s.status,
      createdAt: s.createdAt,
      claimedById: s.claimedById,
      claimedByName: s.claimedById ? nameById.get(s.claimedById) ?? null : null,
      assignment: {
        id: s.assignment.id,
        dayIndex: s.assignment.shift.dayIndex,
        blockLabel: s.assignment.shift.label,
        waveTime: s.assignment.startTime,
        roleName: s.assignment.role.name,
        holderName: s.assignment.employee.name,
      },
    }));
  });

  app.get('/api/assignments/:id/eligible', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assignmentInOrg(req.orgId, id))) return reply.code(404).send({ error: 'שיבוץ לא נמצא' });
    const assignment = await prisma.assignment.findUniqueOrThrow({
      where: { id },
      include: { shift: true, slot: true, role: true, employee: true },
    });
    const eligible = await eligibleForAssignment(assignment);
    return eligible.map((e) => ({ id: e.id, name: e.name }));
  });

  app.post('/api/assignments/:id/vacate', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assignmentInOrg(req.orgId, id))) return reply.code(404).send({ error: 'שיבוץ לא נמצא' });
    const { swap, eligible } = await vacateAndBroadcast(id);
    return { swapId: swap.id, notified: eligible.length };
  });

  const claimSchema = z.object({ employeeId: z.string() });
  app.post('/api/swaps/:id/claim', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await swapInOrg(req.orgId, id))) return reply.code(404).send({ error: 'בקשה לא נמצאה' });
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    // tenant isolation: the claiming employee must belong to this org
    const emp = await prisma.employee.findUnique({ where: { id: parsed.data.employeeId }, select: { orgId: true } });
    if (!emp || emp.orgId !== req.orgId) return reply.code(404).send({ error: 'עובד לא נמצא' });
    try {
      return await claimSwap(id, parsed.data.employeeId);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.post('/api/swaps/:id/approve', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await swapInOrg(req.orgId, id))) return reply.code(404).send({ error: 'בקשה לא נמצאה' });
    try {
      return await approveSwap(id);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.post('/api/swaps/:id/reject', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await swapInOrg(req.orgId, id))) return reply.code(404).send({ error: 'בקשה לא נמצאה' });
    return rejectSwap(id);
  });

  // Outbox — what MockChannel "sent", scoped to this org's employees.
  app.get('/api/outbox', async (req) => {
    const emps = await prisma.employee.findMany({ where: { orgId: req.orgId }, select: { id: true } });
    return prisma.outboxMessage.findMany({
      where: { employeeId: { in: emps.map((e) => e.id) } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
}
