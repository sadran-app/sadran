import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { shiftDuration } from '@engine';
import { prisma, getCurrentCycle, assignmentInOrg, getOrgById } from '../db';
import { generateAndStore, slotFromDemand } from '../services/schedule';
import { checkSlot, candidatesForSlot } from '../services/eligibility';
import { currentGaps } from '../services/gaps';
import { publishCycle } from '../services/publish';

// dayNotes is a JSON map { dayIndex: text }; tolerate a corrupt value gracefully.
function safeParseNotes(json: string): Record<string, string> {
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

export async function scheduleRoutes(app: FastifyInstance) {
  // The grid: cycle + assignments + live gaps + fairness.
  app.get('/api/cycle', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    const [assignments, gaps, fairness, org] = await Promise.all([
      prisma.assignment.findMany({
        where: { cycleId: cycle.id, status: { in: ['proposed', 'published'] } },
        include: { employee: true, shift: true },
      }),
      currentGaps(req.orgId, cycle.id),
      prisma.fairnessLog.findMany({ where: { cycleId: cycle.id } }),
      getOrgById(req.orgId),
    ]);

    // 2.4b — live labour cost of the CURRENT draft (updates on every edit)
    let laborCost = 0;
    let laborHours = 0;
    for (const a of assignments) {
      const hrs = shiftDuration(a.startTime, a.endTime ?? a.shift.endTime) / 60;
      laborHours += hrs;
      laborCost += hrs * (a.employee.hourlyRate ?? 0);
    }

    return {
      cycle: { id: cycle.id, weekStartDate: cycle.weekStartDate, status: cycle.status, dayNotes: safeParseNotes(cycle.dayNotes) },
      cost: { labor: Math.round(laborCost), hours: Math.round(laborHours * 10) / 10, budget: org.weeklyLaborBudget },
      assignments: assignments.map((a) => ({
        id: a.id,
        employeeId: a.employeeId,
        employeeName: a.employee.name,
        dayIndex: a.shift.dayIndex,
        shiftId: a.shiftId,
        slotId: a.slotId,
        roleId: a.roleId,
        startTime: a.startTime,
        endTime: a.endTime ?? a.shift.endTime,
        status: a.status,
        forced: a.forced,
        forceReason: a.forceReason,
        locked: a.locked,
      })),
      gaps,
      fairness,
    };
  });

  const generateSchema = z.object({ optimize: z.boolean().optional() });
  app.post('/api/cycle/generate', async (req, reply) => {
    const parsed = generateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'פרמטרים לא תקינים' });
    const { optimize } = parsed.data;
    const cycle = await getCurrentCycle(req.orgId);
    const result = await generateAndStore(req.orgId, cycle.id, { optimize });
    return { warnings: result.warnings, gapCount: result.gaps.length, assigned: result.assignments.length, engine: result.engine };
  });

  // 2.2a — copy the previous week's schedule into the current draft as a starting
  // point. Only still-eligible pairings are copied; anyone now unavailable is skipped.
  app.post('/api/cycle/copy-previous', async (req, reply) => {
    const cycle = await getCurrentCycle(req.orgId);
    const prev = await prisma.weekCycle.findFirst({
      where: { orgId: req.orgId, id: { not: cycle.id } },
      orderBy: { weekStartDate: 'desc' },
    });
    if (!prev) return reply.code(404).send({ error: 'אין שבוע קודם להעתיק ממנו' });
    const prevAsg = await prisma.assignment.findMany({ where: { cycleId: prev.id }, include: { shift: true } });

    let copied = 0;
    let skipped = 0;
    for (const a of prevAsg) {
      const slot = { dayIndex: a.shift.dayIndex, shiftId: a.shiftId, slotId: a.slotId, roleId: a.roleId, startTime: a.startTime, endTime: a.endTime ?? a.shift.endTime };
      // relax availability/max-shifts (not collected yet for the new week); LAWS still block.
      const { ok } = await checkSlot(req.orgId, cycle.id, a.employeeId, slot, true);
      if (!ok) { skipped++; continue; } // would break a labour law, or role/employee gone
      try {
        await prisma.assignment.create({
          data: { cycleId: cycle.id, employeeId: a.employeeId, shiftId: a.shiftId, slotId: a.slotId, roleId: a.roleId, startTime: a.startTime, endTime: a.endTime, status: 'proposed' },
        });
        copied++;
      } catch { skipped++; } // already assigned in the current draft
    }
    if (copied > 0) await prisma.weekCycle.update({ where: { id: cycle.id }, data: { status: 'proposed' } });
    return { copied, skipped };
  });

  // 2.6 — per-weekday manager note (e.g. "ערב עמוס — אירוע").
  const noteSchema = z.object({ dayIndex: z.number().int().min(0).max(6), text: z.string().max(300) });
  app.put('/api/cycle/notes', async (req, reply) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'נתונים לא תקינים' });
    const cycle = await getCurrentCycle(req.orgId);
    const notes = safeParseNotes(cycle.dayNotes);
    const text = parsed.data.text.trim();
    if (text) notes[parsed.data.dayIndex] = text;
    else delete notes[parsed.data.dayIndex];
    await prisma.weekCycle.update({ where: { id: cycle.id }, data: { dayNotes: JSON.stringify(notes) } });
    return { ok: true, dayNotes: notes };
  });

  app.post('/api/cycle/publish', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    return publishCycle(cycle.id);
  });

  // Clear ALL assignments from the current schedule so it can be rebuilt from scratch.
  app.post('/api/cycle/reset', async (req) => {
    const cycle = await getCurrentCycle(req.orgId);
    await prisma.$transaction([
      prisma.swapRequest.deleteMany({ where: { cycleId: cycle.id } }),
      prisma.assignment.deleteMany({ where: { cycleId: cycle.id } }),
      prisma.fairnessLog.deleteMany({ where: { cycleId: cycle.id } }),
      prisma.weekCycle.update({ where: { id: cycle.id }, data: { status: 'collecting' } }),
    ]);
    return { ok: true };
  });

  // One schedule per week. The next week (this Sunday + 7) can only be opened once
  // the current one is PUBLISHED — keeping a single, clear active week at a time.
  app.post('/api/cycle/open-next', async (req, reply) => {
    const current = await getCurrentCycle(req.orgId);
    if (current.status !== 'published') {
      return reply.code(409).send({ error: 'יש לפרסם את הסידור הנוכחי לפני פתיחת השבוע הבא.' });
    }
    const next = new Date(current.weekStartDate);
    next.setUTCDate(next.getUTCDate() + 7);
    const weekEnd = new Date(next);
    weekEnd.setUTCDate(next.getUTCDate() + 7);
    const clash = await prisma.weekCycle.findFirst({ where: { orgId: req.orgId, weekStartDate: { gte: next, lt: weekEnd } } });
    if (clash) return reply.code(409).send({ error: 'כבר קיים סידור לשבוע הבא.' });
    const cycle = await prisma.weekCycle.create({ data: { orgId: req.orgId, weekStartDate: next, status: 'collecting' } });
    return { id: cycle.id, weekStartDate: cycle.weekStartDate, status: cycle.status };
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

    // tenant isolation: the slot's shift AND the employee must belong to this org,
    // so a manager can never touch another business's data by guessing an id.
    const [shift, emp] = await Promise.all([
      prisma.shift.findUnique({ where: { id: slot.shiftId }, select: { orgId: true } }),
      prisma.employee.findUnique({ where: { id: employeeId }, select: { orgId: true } }),
    ]);
    if (!shift || shift.orgId !== req.orgId) return reply.code(404).send({ error: 'דרישה לא נמצאה' });
    if (!emp || emp.orgId !== req.orgId) return reply.code(404).send({ error: 'עובד לא נמצא' });

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

  // 2.3 — pin / unpin a seat. A locked seat is kept fixed on regenerate.
  const lockSchema = z.object({ locked: z.boolean() });
  app.put('/api/assignments/:id/lock', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assignmentInOrg(req.orgId, id))) return reply.code(404).send({ error: 'שיבוץ לא נמצא' });
    const parsed = lockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'נתונים לא תקינים' });
    await prisma.assignment.update({ where: { id }, data: { locked: parsed.data.locked } });
    return { ok: true, locked: parsed.data.locked };
  });

  // 2.1 — move an assignment to another demand seat (drag & drop). Re-validated on
  // the target (excluding the seat being moved); ?force keeps an illegal move with a warning.
  const moveSchema = z.object({ toSlotId: z.string(), force: z.boolean().optional() });
  app.post('/api/assignments/:id/move', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await assignmentInOrg(req.orgId, id))) return reply.code(404).send({ error: 'שיבוץ לא נמצא' });
    const parsed = moveSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'נתונים לא תקינים' });
    const { toSlotId, force } = parsed.data;
    const cycle = await getCurrentCycle(req.orgId);

    const src = await prisma.assignment.findUnique({ where: { id } });
    if (!src) return reply.code(404).send({ error: 'שיבוץ לא נמצא' });
    if (src.slotId === toSlotId) return { ok: true, unchanged: true };

    const target = await slotFromDemand(toSlotId);
    if (!target) return reply.code(404).send({ error: 'דרישה לא נמצאה' });
    const tShift = await prisma.shift.findUnique({ where: { id: target.shiftId }, select: { orgId: true } });
    if (!tShift || tShift.orgId !== req.orgId) return reply.code(404).send({ error: 'דרישה לא נמצאה' });

    // remove the source first so eligibility on the target isn't self-blocked (rest/overlap
    // against the very seat we're moving). If the move is rejected, restore the source.
    const restore = { cycleId: src.cycleId, employeeId: src.employeeId, shiftId: src.shiftId, slotId: src.slotId, roleId: src.roleId, startTime: src.startTime, endTime: src.endTime, status: src.status, forced: src.forced, forceReason: src.forceReason, locked: src.locked };
    await prisma.swapRequest.deleteMany({ where: { assignmentId: id } });
    await prisma.assignment.delete({ where: { id } });

    const { ok, reasons } = await checkSlot(req.orgId, cycle.id, src.employeeId, target);
    if (!ok && !force) {
      await prisma.assignment.create({ data: restore }); // rollback
      return reply.code(409).send({ error: 'אי אפשר להעביר לשיבוץ הזה', reasons });
    }
    try {
      const created = await prisma.assignment.create({
        data: { cycleId: cycle.id, employeeId: src.employeeId, shiftId: target.shiftId, slotId: target.slotId, roleId: target.roleId, startTime: target.startTime, status: src.status, locked: src.locked },
      });
      return { ...created, warning: !ok ? reasons : undefined };
    } catch {
      await prisma.assignment.create({ data: restore }); // rollback on duplicate/other
      return reply.code(409).send({ error: 'העובד כבר משובץ במשבצת היעד' });
    }
  });
}
