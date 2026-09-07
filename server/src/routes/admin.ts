import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getOrgById } from '../db';
import { hashPassword, verifyPassword, requireAdmin, effectiveStatus, signToken } from '../auth';
import { encryptSecret, decryptSecret } from '../crypto';
import { createOrganization, addMonths } from '../services/onboarding';
import { generatePassword, generateUsername, welcomeMessage } from '../services/credentials';
import { channel } from '../channel';
import { usageByOrg, usageDetail, monthRange, type WaUsage } from '../services/waUsage';

// Shape one org into an admin monitoring row (metrics + subscription + login).
async function businessRow(o: Awaited<ReturnType<typeof prisma.organization.findFirst>>, usage?: WaUsage) {
  if (!o) return null;
  const [manager, employees] = await Promise.all([
    prisma.manager.findFirst({ where: { orgId: o.id }, orderBy: { createdAt: 'asc' } }),
    prisma.employee.count({ where: { orgId: o.id, active: true } }),
  ]);
  const daysLeft = o.subscriptionEnd ? Math.ceil((o.subscriptionEnd.getTime() - Date.now()) / 86_400_000) : null;
  return {
    id: o.id,
    name: o.name,
    isChain: o.isChain,
    businessType: o.businessType,
    parentId: o.parentId,
    managerId: manager?.id ?? null,
    managerName: manager?.name ?? '—',
    username: manager?.username ?? '—',
    lastLoginAt: manager?.lastLoginAt ?? null,
    planName: o.planName,
    employeeQuota: o.employeeQuota,
    employees,
    whatsappEnabled: o.whatsappEnabled,
    whatsappMessageCount: o.whatsappMessageCount,
    waMonthlyBudget: o.waMonthlyBudget,
    waBillableThisMonth: usage?.billable ?? 0,
    waFreeThisMonth: usage?.free ?? 0,
    monthlyPrice: o.monthlyPrice,
    status: effectiveStatus(o),
    subscriptionStart: o.subscriptionStart,
    subscriptionEnd: o.subscriptionEnd,
    daysLeft,
    waPhoneNumberId: o.waPhoneNumberId,
    waPhoneDisplay: o.waPhoneDisplay,
    waSenderName: o.waSenderName,
    waProfilePicUrl: o.waProfilePicUrl,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  // ---- list every business/branch with metrics ----
  app.get('/api/admin/businesses', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { from, to } = monthRange();
    const [orgs, usage] = await Promise.all([
      prisma.organization.findMany({ orderBy: { createdAt: 'asc' } }),
      usageByOrg(from, to),
    ]);
    return (await Promise.all(orgs.map((o) => businessRow(o, usage.get(o.id))))).filter(Boolean);
  });

  // Detailed WhatsApp usage this month for one business (free vs billable, by type).
  app.get('/api/admin/businesses/:id/wa-usage', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const org = await getOrgById(id);
    const { from, to } = monthRange();
    const detail = await usageDetail(id, from, to);
    return { ...detail, budget: org.waMonthlyBudget, monthStart: from };
  });

  // ---- create a single business OR a chain with branches ----
  const senderSchema = {
    waPhoneNumberId: z.string().max(60).optional(),
    waPhoneDisplay: z.string().max(40).optional(),
    waSenderName: z.string().max(60).optional(),
    waProfilePicUrl: z.string().max(500).optional(),
  };
  const branchSchema = z.object({
    name: z.string().min(1).max(80),
    managerName: z.string().min(1).max(80).optional(),
    managerPhone: z.string().max(30).optional(),
    employeeQuota: z.number().int().min(0).max(100000).optional(),
  });
  const createSchema = z.object({
    type: z.enum(['single', 'chain']).default('single'),
    businessType: z.enum(['restaurant', 'eventHall', 'store']).default('restaurant'),
    businessName: z.string().min(1).max(80),
    managerName: z.string().min(1).max(80),
    managerPhone: z.string().max(30).optional(),
    planName: z.string().max(40).optional(),
    employeeQuota: z.number().int().min(0).max(100000).optional(),
    whatsappEnabled: z.boolean().optional(),
    waMonthlyBudget: z.number().int().min(0).max(1_000_000).optional(),
    monthlyPrice: z.number().min(0).optional(),
    subscriptionMonths: z.number().int().min(0).max(120).optional(),
    ...senderSchema,
    branches: z.array(branchSchema).optional(),
  });

  app.post('/api/admin/businesses', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'פרטים לא תקינים' });
    const d = parsed.data;

    const senderCfg = {
      waPhoneNumberId: d.waPhoneNumberId ?? null,
      waPhoneDisplay: d.waPhoneDisplay ?? null,
      waSenderName: d.waSenderName ?? null,
      waProfilePicUrl: d.waProfilePicUrl ?? null,
    };

    // Create one org with an AUTO-GENERATED username (= manager name, deduped) and
    // password. Sends the manager an onboarding WhatsApp with the (bold) credentials.
    const provision = async (cfg: {
      businessName: string; managerName: string; managerPhone?: string;
      employeeQuota?: number; monthlyPrice?: number; parentId?: string; isChain?: boolean; seedDefaults?: boolean;
    }) => {
      const username = await generateUsername(cfg.managerName);
      const password = generatePassword();
      const { org, manager } = await createOrganization({
        businessName: cfg.businessName,
        managerName: cfg.managerName,
        username,
        passwordHash: await hashPassword(password),
        passwordEnc: encryptSecret(password),
        managerPhone: cfg.managerPhone ?? null,
        planName: d.planName,
        employeeQuota: cfg.employeeQuota ?? d.employeeQuota ?? 20,
        whatsappEnabled: d.whatsappEnabled ?? true,
        waMonthlyBudget: d.waMonthlyBudget,
        businessType: d.businessType,
        monthlyPrice: cfg.monthlyPrice ?? 0,
        subscriptionMonths: d.subscriptionMonths,
        ...senderCfg,
        parentId: cfg.parentId ?? null,
        isChain: cfg.isChain ?? false,
        seedDefaults: cfg.seedDefaults,
      });
      if (cfg.managerPhone) {
        await channel
          .notify({ id: manager.id, name: manager.name, phone: cfg.managerPhone }, welcomeMessage(cfg.managerName, cfg.businessName, username, password))
          .catch(() => {}); // never fail creation because a message couldn't be sent
      }
      return { id: org.id, name: org.name, username, password };
    };

    if (d.type === 'chain' && d.branches && d.branches.length) {
      const hq = await provision({ businessName: d.businessName, managerName: d.managerName, managerPhone: d.managerPhone, employeeQuota: d.employeeQuota, monthlyPrice: d.monthlyPrice, isChain: true, seedDefaults: false });
      const branches = [];
      for (const b of d.branches) {
        branches.push(await provision({ businessName: b.name, managerName: b.managerName ?? d.managerName, managerPhone: b.managerPhone, employeeQuota: b.employeeQuota ?? d.employeeQuota, monthlyPrice: 0, parentId: hq.id }));
      }
      return reply.code(201).send({ ...hq, branches });
    }

    const single = await provision({ businessName: d.businessName, managerName: d.managerName, managerPhone: d.managerPhone, employeeQuota: d.employeeQuota, monthlyPrice: d.monthlyPrice });
    return reply.code(201).send(single);
  });

  // ---- reveal a business's credentials (gated by the admin's own password) ----
  app.post('/api/admin/businesses/:id/reveal', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { password } = (req.body ?? {}) as { password?: string };
    const admin = await prisma.manager.findUnique({ where: { id: req.managerId } });
    if (!admin || !password || !(await verifyPassword(password, admin.passwordHash))) {
      return reply.code(401).send({ error: 'סיסמת מנהל-על שגויה' });
    }
    const { id } = req.params as { id: string };
    const manager = await prisma.manager.findFirst({ where: { orgId: id }, orderBy: { createdAt: 'asc' } });
    if (!manager) return reply.code(404).send({ error: 'לא נמצא חשבון לעסק' });
    return { username: manager.username ?? '', password: decryptSecret(manager.passwordEnc) ?? '(לא זמין)' };
  });

  // ---- update a business: suspend/reactivate, extend subscription, plan, quota, whatsapp, sender ----
  const patchSchema = z.object({
    status: z.enum(['active', 'suspended']).optional(),
    planName: z.string().max(40).nullable().optional(),
    employeeQuota: z.number().int().min(0).max(100000).optional(),
    whatsappEnabled: z.boolean().optional(),
    waMonthlyBudget: z.number().int().min(0).max(1_000_000).optional(),
    monthlyPrice: z.number().min(0).optional(),
    extendMonths: z.number().int().min(1).max(120).optional(), // add months from the later of now / current end
    ...senderSchema,
  });
  app.patch('/api/admin/businesses/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const org = await getOrgById(id);
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'פרטים לא תקינים' });
    const d = parsed.data;
    const data: Record<string, unknown> = {};
    if (d.status) data.status = d.status;
    if (d.planName !== undefined) data.planName = d.planName;
    if (d.employeeQuota !== undefined) data.employeeQuota = d.employeeQuota;
    if (d.whatsappEnabled !== undefined) data.whatsappEnabled = d.whatsappEnabled;
    if (d.waMonthlyBudget !== undefined) data.waMonthlyBudget = d.waMonthlyBudget;
    if (d.monthlyPrice !== undefined) data.monthlyPrice = d.monthlyPrice;
    if (d.extendMonths) {
      const base = org.subscriptionEnd && org.subscriptionEnd.getTime() > Date.now() ? org.subscriptionEnd : new Date();
      data.subscriptionEnd = addMonths(base, d.extendMonths);
      data.status = 'active';
    }
    if (d.waPhoneNumberId !== undefined) data.waPhoneNumberId = d.waPhoneNumberId;
    if (d.waPhoneDisplay !== undefined) data.waPhoneDisplay = d.waPhoneDisplay;
    if (d.waSenderName !== undefined) data.waSenderName = d.waSenderName;
    if (d.waProfilePicUrl !== undefined) data.waProfilePicUrl = d.waProfilePicUrl;
    await prisma.organization.update({ where: { id }, data });
    const { from, to } = monthRange();
    const u = await usageDetail(id, from, to);
    return businessRow(await prisma.organization.findUnique({ where: { id } }), { total: u.total, free: u.free, billable: u.billable });
  });

  // ---- reset a business's password (and optionally username) ----
  app.post('/api/admin/businesses/:id/reset-password', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const body = z.object({ password: z.string().min(6), username: z.string().min(3).max(40).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'סיסמה של לפחות 6 תווים' });
    const manager = await prisma.manager.findFirst({ where: { orgId: id }, orderBy: { createdAt: 'asc' } });
    if (!manager) return reply.code(404).send({ error: 'לא נמצא חשבון לעסק' });
    if (body.data.username && body.data.username !== manager.username) {
      const clash = await prisma.manager.findFirst({ where: { username: body.data.username, id: { not: manager.id } } });
      if (clash) return reply.code(409).send({ error: 'שם המשתמש כבר תפוס' });
    }
    await prisma.manager.update({
      where: { id: manager.id },
      data: {
        username: body.data.username ?? manager.username,
        passwordHash: await hashPassword(body.data.password),
        passwordEnc: encryptSecret(body.data.password),
      },
    });
    return { ok: true };
  });

  // ---- "enter as business": issue a token scoped to that org (support/impersonation) ----
  app.post('/api/admin/businesses/:id/impersonate', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    const org = await getOrgById(id);
    const manager = await prisma.manager.findFirst({ where: { orgId: id }, orderBy: { createdAt: 'asc' } });
    if (!manager) return reply.code(404).send({ error: 'לא נמצא חשבון לעסק' });
    return { token: signToken(manager.id, org.id, true), org: { id: org.id, name: org.name } };
  });

  // ---- delete a business (and, if a chain HQ, its branches) ----
  // The DB relations to org-scoped rows don't all cascade, so we tear the tree down
  // explicitly, in dependency order, inside one transaction. Deleting the cycles/shifts
  // cascades their assignments/slots/availability; then employees, roles, and the orgs.
  app.delete('/api/admin/businesses/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { id } = req.params as { id: string };
    await getOrgById(id);

    const branches = await prisma.organization.findMany({ where: { parentId: id }, select: { id: true } });
    const orgIds = [id, ...branches.map((b) => b.id)];
    const [cycles, employees] = await Promise.all([
      prisma.weekCycle.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } }),
      prisma.employee.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } }),
    ]);
    const cycleIds = cycles.map((c) => c.id);
    const empIds = employees.map((e) => e.id);

    await prisma.$transaction([
      // rows with no FK relation (won't block, but must not orphan)
      prisma.dayAvailability.deleteMany({ where: { cycleId: { in: cycleIds } } }),
      prisma.shiftLoad.deleteMany({ where: { cycleId: { in: cycleIds } } }),
      prisma.outboxMessage.deleteMany({ where: { employeeId: { in: empIds } } }),
      prisma.inboundMessage.deleteMany({ where: { employeeId: { in: empIds } } }),
      // cycles cascade → availability, assignments, swaps, fairness logs
      prisma.weekCycle.deleteMany({ where: { orgId: { in: orgIds } } }),
      // shifts cascade → shift slots (+ any remaining availability/assignments)
      prisma.shift.deleteMany({ where: { orgId: { in: orgIds } } }),
      // employees cascade → employee-roles, availability
      prisma.employee.deleteMany({ where: { orgId: { in: orgIds } } }),
      prisma.role.deleteMany({ where: { orgId: { in: orgIds } } }),
      // orgs cascade → managers (and the branch orgs are already in orgIds)
      prisma.organization.deleteMany({ where: { id: { in: orgIds } } }),
    ]);
    return { ok: true };
  });
}
