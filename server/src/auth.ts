// Authentication + multi-tenant scoping. Every /api request (except health and
// login) must carry a valid Bearer token. The token pins the request to one
// manager and one organization, so a manager only ever touches their own data.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from './db';

const JWT_SECRET = process.env.JWT_SECRET ?? 'sadran-dev-secret-change-me';
const TOKEN_TTL = '30d';

declare module 'fastify' {
  interface FastifyRequest {
    orgId: string;
    managerId: string;
    isAdmin: boolean;
  }
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

interface TokenPayload {
  sub: string; // managerId
  orgId: string;
}
export function signToken(managerId: string, orgId: string): string {
  return jwt.sign({ orgId } satisfies Omit<TokenPayload, 'sub'>, JWT_SECRET, {
    subject: managerId,
    expiresIn: TOKEN_TTL,
  });
}
function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  return { sub: String(decoded.sub), orgId: String(decoded.orgId) };
}

/** The org the current request is scoped to. */
export function orgOf(req: FastifyRequest): string {
  return req.orgId;
}

const PUBLIC = new Set(['/api/health', '/api/auth/login']);

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('orgId', '');
  app.decorateRequest('managerId', '');
  app.decorateRequest('isAdmin', false);

  app.addHook('onRequest', async (req, reply) => {
    const url = (req.raw.url ?? '').split('?')[0] ?? '';
    if (req.method === 'OPTIONS') return; // CORS preflight
    if (!url.startsWith('/api/')) return;
    if (PUBLIC.has(url)) return;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return reply.code(401).send({ error: 'לא מחובר' });
    let payload: TokenPayload;
    try {
      payload = verifyToken(header.slice(7));
    } catch {
      return reply.code(401).send({ error: 'הרשאה לא תקפה — התחבר מחדש' });
    }
    // The manager must still exist — a stale token from a previous DB seed
    // points to deleted ids and must force a fresh login, not a 500.
    const manager = await prisma.manager.findUnique({ where: { id: payload.sub } });
    if (!manager) return reply.code(401).send({ error: 'החשבון לא נמצא — התחבר מחדש' });
    req.managerId = manager.id;
    req.orgId = manager.orgId ?? '';
    req.isAdmin = manager.isAdmin;
  });
}

/** Guard: 403 unless the caller is the platform admin. Returns true if OK to proceed. */
export async function requireAdmin(req: FastifyRequest, reply: import('fastify').FastifyReply): Promise<boolean> {
  if (!req.isAdmin) {
    reply.code(403).send({ error: 'הרשאת מנהל-על נדרשת' });
    return false;
  }
  return true;
}

export async function authRoutes(app: FastifyInstance) {
  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'אימייל או סיסמה חסרים' });
    const manager = await prisma.manager.findUnique({ where: { email: parsed.data.email } });
    if (!manager || !(await verifyPassword(parsed.data.password, manager.passwordHash))) {
      return reply.code(401).send({ error: 'אימייל או סיסמה שגויים' });
    }
    const token = signToken(manager.id, manager.orgId ?? '');
    const org = manager.orgId ? await prisma.organization.findUnique({ where: { id: manager.orgId } }) : null;
    return {
      token,
      manager: { id: manager.id, name: manager.name, email: manager.email },
      org: org ? { id: org.id, name: org.name } : null,
      isAdmin: manager.isAdmin,
    };
  });

  app.get('/api/auth/me', async (req) => {
    const manager = await prisma.manager.findUnique({ where: { id: req.managerId } });
    const org = req.orgId ? await prisma.organization.findUnique({ where: { id: req.orgId } }) : null;
    return {
      manager: manager ? { id: manager.id, name: manager.name, email: manager.email } : null,
      org: org ? { id: org.id, name: org.name } : null,
      isAdmin: manager?.isAdmin ?? false,
    };
  });
}
