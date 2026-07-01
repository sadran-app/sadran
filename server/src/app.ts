import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { registerAuth, authRoutes } from './auth';
import { configRoutes } from './routes/config';
import { employeeRoutes } from './routes/employees';
import { scheduleRoutes } from './routes/schedule';
import { swapRoutes } from './routes/swaps';
import { reportRoutes } from './routes/reports';
import { cycleRoutes } from './routes/cycles';
import { adminRoutes } from './routes/admin';

const isProd = process.env.NODE_ENV === 'production';

// Fail fast in production if the token secret was left at the insecure default.
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  console.error('FATAL: set a strong JWT_SECRET (≥16 chars) in production.');
  process.exit(1);
}

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/api/health', async () => ({ ok: true }));

// auth hook first, then login route, then the protected routes
registerAuth(app);
await app.register(authRoutes);
await app.register(configRoutes);
await app.register(employeeRoutes);
await app.register(scheduleRoutes);
await app.register(swapRoutes);
await app.register(reportRoutes);
await app.register(cycleRoutes);
await app.register(adminRoutes);

// In production, serve the built web app from the same origin (single service).
if (isProd) {
  const webDir = path.resolve('web/dist');
  await app.register(fastifyStatic, { root: webDir, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if ((req.raw.url ?? '').startsWith('/api')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html'); // SPA fallback
  });
}

const port = Number(process.env.PORT ?? 3001);
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`Sadran on http://localhost:${port} (${isProd ? 'production' : 'development'})`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
