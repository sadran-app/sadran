import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, getCurrentCycle } from '../db';
import { buildOrgReport, buildTrends } from '../services/reports';
import { buildInsights } from '../services/insights';
import { askCopilot, COPILOT_SUGGESTIONS } from '../services/copilot';

export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports', async (req) => buildOrgReport(req.orgId));
  app.get('/api/reports/trends', async (req) => buildTrends(req.orgId)); // 4.1 + 4.2
  app.get('/api/insights', async (req) => buildInsights(req.orgId));

  // 4.2 — weekly labour-cost budget target for the org
  app.put('/api/config/labor-budget', async (req, reply) => {
    const parsed = z.object({ weeklyLaborBudget: z.number().min(0).max(10_000_000) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'תקציב לא תקין' });
    await prisma.organization.update({ where: { id: req.orgId }, data: { weeklyLaborBudget: parsed.data.weeklyLaborBudget } });
    return { ok: true, weeklyLaborBudget: parsed.data.weeklyLaborBudget };
  });

  // 4.2 — actual revenue for the current week (for labour-% analysis)
  app.put('/api/cycle/revenue', async (req, reply) => {
    const parsed = z.object({ revenue: z.number().min(0).max(1_000_000_000).nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'הכנסה לא תקינה' });
    const cycle = await getCurrentCycle(req.orgId);
    await prisma.weekCycle.update({ where: { id: cycle.id }, data: { revenue: parsed.data.revenue } });
    return { ok: true, revenue: parsed.data.revenue };
  });

  app.get('/api/copilot/suggestions', async () => ({ suggestions: COPILOT_SUGGESTIONS }));
  app.post('/api/copilot', async (req, reply) => {
    const q = (req.body as { question?: string })?.question;
    if (!q || typeof q !== 'string' || !q.trim()) return reply.code(400).send({ error: 'שאלה ריקה' });
    return askCopilot(req.orgId, q.slice(0, 500));
  });
}
