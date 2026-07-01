import type { FastifyInstance } from 'fastify';
import { buildOrgReport } from '../services/reports';

export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports', async (req) => buildOrgReport(req.orgId));
}
