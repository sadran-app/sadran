import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getOrgById } from '../db';
import { hashPassword, requireAdmin } from '../auth';
import { createOrganization } from '../services/onboarding';

export async function adminRoutes(app: FastifyInstance) {
  // List every business (org) with its manager login + size. Admin only.
  app.get('/api/admin/businesses', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const orgs = await prisma.organization.findMany({ orderBy: { name: 'asc' } });
    const rows = await Promise.all(
      orgs.map(async (o) => {
        const [manager, employees] = await Promise.all([
          prisma.manager.findFirst({ where: { orgId: o.id }, orderBy: { createdAt: 'asc' } }),
          prisma.employee.count({ where: { orgId: o.id } }),
        ]);
        return { id: o.id, name: o.name, managerEmail: manager?.email ?? '—', managerName: manager?.name ?? '—', employees };
      }),
    );
    return rows;
  });

  // Open a new business: creates its org + the manager login it will use. Admin only.
  const createSchema = z.object({
    businessName: z.string().min(1).max(80),
    managerName: z.string().min(1).max(80),
    email: z.string().email(),
    password: z.string().min(6, 'סיסמה של לפחות 6 תווים'),
  });

  app.post('/api/admin/businesses', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'פרטים לא תקינים' });
    const { businessName, managerName, email, password } = parsed.data;

    const existing = await prisma.manager.findUnique({ where: { email } });
    if (existing) return reply.code(409).send({ error: 'האימייל הזה כבר רשום במערכת' });

    const { org, manager } = await createOrganization(businessName, managerName, email, await hashPassword(password));
    return reply.code(201).send({ id: org.id, name: org.name, managerEmail: manager.email });
  });

  // Delete a business (org + all its data). Admin only.
  app.delete('/api/admin/businesses/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    await getOrgById(id); // throws if missing
    await prisma.organization.delete({ where: { id } }); // cascades managers/employees/shifts/cycles
    return { ok: true };
  });
}
