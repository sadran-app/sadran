import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { registerAuth, authRoutes } from './auth';
import { configRoutes } from './routes/config';
import { employeeRoutes } from './routes/employees';
import { scheduleRoutes } from './routes/schedule';
import { swapRoutes } from './routes/swaps';
import { reportRoutes } from './routes/reports';
import { cycleRoutes } from './routes/cycles';
import { adminRoutes } from './routes/admin';
import { forecastRoutes } from './routes/forecast';
import { chatRoutes, webhookRoutes } from './routes/chat';
import { dashboardRoutes } from './routes/dashboard';
import { templateRoutes } from './routes/templates';
import { requestRoutes } from './routes/requests';
import { startScheduler } from './services/scheduler';

const isProd = process.env.NODE_ENV === 'production';

// Fail fast in production if a security secret was left at the insecure default.
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  console.error('FATAL: set a strong JWT_SECRET (≥16 chars) in production.');
  process.exit(1);
}
if (isProd && (!process.env.CRED_ENC_KEY || process.env.CRED_ENC_KEY.length < 16)) {
  console.error('FATAL: set a strong CRED_ENC_KEY (≥16 chars) in production.');
  process.exit(1);
}

const app = Fastify({ logger: true, bodyLimit: 512 * 1024 });

// Security headers (clickjacking, MIME-sniffing, referrer, etc.). CSP/COEP are
// disabled so the bundled SPA + inline styles keep working.
await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });

// Restrict CORS to configured origins in production (reflect any in dev).
const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
await app.register(cors, { origin: isProd && allowedOrigins.length ? allowedOrigins : true });

// Global rate limit — blunt brute-force / abuse protection.
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

app.get('/api/health', async () => ({ ok: true }));

// Central error handler: log the full error server-side, but return a SAFE message
// to the client (never leak stack traces / internals), in the app's { error } shape.
app.setErrorHandler((err, req, reply) => {
  const e = err as { statusCode?: number; message?: string };
  const status = e.statusCode ?? 500;
  if (status >= 500) req.log.error(err as Error);
  reply.code(status).send({ error: status < 500 && e.message ? e.message : 'שגיאת שרת — נסה/י שוב מאוחר יותר' });
});

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
await app.register(forecastRoutes);
await app.register(chatRoutes);
await app.register(webhookRoutes);
await app.register(dashboardRoutes);
await app.register(templateRoutes);
await app.register(requestRoutes);

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
  .then(() => {
    app.log.info(`Sadran on http://localhost:${port} (${isProd ? 'production' : 'development'})`);
    startScheduler();
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
