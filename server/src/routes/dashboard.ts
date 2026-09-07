import type { FastifyInstance } from 'fastify';
import { buildDashboard } from '../services/dashboard';

export async function dashboardRoutes(app: FastifyInstance) {
  // Home command-center snapshot for the current cycle.
  app.get('/api/dashboard', async (req) => buildDashboard(req.orgId));
}
