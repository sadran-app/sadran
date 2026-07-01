import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getCurrentCycle } from '../db';
import { channel } from '../channel';

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
        roleIds: e.roles.map((r) => r.roleId),
        availability: availability
          .filter((a) => a.employeeId === e.id)
          .map((a) => ({ shiftId: a.shiftId, state: a.state })),
      })),
    };
  });

  const createSchema = z.object({
    name: z.string().min(1),
    phone: z.string().min(5),
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
    const birth = d.birthDate ? new Date(d.birthDate) : null;

    const emp = await prisma.employee.create({
      data: {
        orgId: req.orgId,
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

    // auto-enroll in the channel: welcome + availability request
    const cycle = await getCurrentCycle(req.orgId).catch(() => null);
    await channel.notify(
      { id: emp.id, name: emp.name, phone: emp.phone },
      `ברוך הבא ל${(await prisma.organization.findUnique({ where: { id: req.orgId } }))?.name ?? 'המסעדה'}! נהיה בקשר כאן בוואטסאפ לגבי הסידור.`,
    );
    if (cycle) await channel.sendAvailabilityRequest({ id: emp.id, name: emp.name, phone: emp.phone }, cycle.id);

    return reply.code(201).send({ id: emp.id, name: emp.name });
  });

  const updateSchema = z.object({
    name: z.string().min(1).optional(),
    phone: z.string().min(5).optional(),
    email: z.string().email().optional().or(z.literal('')),
    birthDate: z.string().optional(),
    hourlyRate: z.number().min(0).max(1000).optional(),
    minShifts: z.number().int().min(0).max(21).optional(),
    maxShifts: z.number().int().min(0).max(21).optional(),
    active: z.boolean().optional(),
    roleIds: z.array(z.string()).optional(),
  });

  app.put('/api/employees/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownEmployee(req.orgId, id))) return reply.code(404).send({ error: 'עובד לא נמצא' });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const d = parsed.data;
    const birth = d.birthDate !== undefined ? (d.birthDate ? new Date(d.birthDate) : null) : undefined;

    await prisma.employee.update({
      where: { id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.phone !== undefined ? { phone: d.phone } : {}),
        ...(d.email !== undefined ? { email: d.email || null } : {}),
        ...(birth !== undefined ? { birthDate: birth, isMinor: isMinorFromBirth(birth) } : {}),
        ...(d.hourlyRate !== undefined ? { hourlyRate: d.hourlyRate } : {}),
        ...(d.minShifts !== undefined ? { minShifts: d.minShifts } : {}),
        ...(d.maxShifts !== undefined ? { maxShifts: d.maxShifts } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.roleIds ? { roles: { deleteMany: {}, create: d.roleIds.map((roleId) => ({ roleId })) } } : {}),
      },
    });
    return { ok: true };
  });

  // Deactivate (soft) — keeps history for reports.
  app.delete('/api/employees/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownEmployee(req.orgId, id))) return reply.code(404).send({ error: 'עובד לא נמצא' });
    await prisma.employee.update({ where: { id }, data: { active: false } });
    return { ok: true };
  });

  const availabilitySchema = z.object({
    items: z.array(z.object({ shiftId: z.string(), state: z.enum(['ok', 'prefer', 'cant']) })),
  });

  app.put('/api/employees/:id/availability', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await ownEmployee(req.orgId, id))) return reply.code(404).send({ error: 'עובד לא נמצא' });
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const cycle = await getCurrentCycle(req.orgId);

    for (const item of parsed.data.items) {
      if (item.state === 'ok') {
        await prisma.availability.deleteMany({ where: { cycleId: cycle.id, employeeId: id, shiftId: item.shiftId } });
      } else {
        await prisma.availability.upsert({
          where: { cycleId_employeeId_shiftId: { cycleId: cycle.id, employeeId: id, shiftId: item.shiftId } },
          create: { cycleId: cycle.id, employeeId: id, shiftId: item.shiftId, state: item.state },
          update: { state: item.state },
        });
      }
    }
    return { ok: true };
  });
}
