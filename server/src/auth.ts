// Authentication + multi-tenant scoping. Login is by USERNAME + password.
// Every /api request (except health and login) must carry a valid Bearer token.
// The token pins the request to one manager and one organization, so a manager
// only ever touches their own data. Suspended/expired businesses are blocked.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Organization } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from './db';
import { encryptSecret } from './crypto';
import { channel } from './channel';
import { passwordChangedMessage } from './services/credentials';

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
  imp?: boolean; // admin "enter as business" — bypasses suspend/expiry block
}
export function signToken(managerId: string, orgId: string, imp = false): string {
  return jwt.sign({ orgId, imp } satisfies Omit<TokenPayload, 'sub'>, JWT_SECRET, {
    subject: managerId,
    expiresIn: TOKEN_TTL,
  });
}
function verifyToken(token: string): TokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
  return { sub: String(decoded.sub), orgId: String(decoded.orgId), imp: decoded.imp === true };
}

/** Effective access state of a business, factoring in manual suspension + auto-expiry. */
export function effectiveStatus(org: Pick<Organization, 'status' | 'subscriptionEnd'>): 'active' | 'suspended' | 'expired' {
  if (org.status === 'suspended') return 'suspended';
  if (org.subscriptionEnd && org.subscriptionEnd.getTime() < Date.now()) return 'expired';
  return org.status === 'expired' ? 'expired' : 'active';
}

/** Hebrew reason a business login is blocked, or null if it may proceed. */
export function accessBlockReason(org: Pick<Organization, 'status' | 'subscriptionEnd'>): string | null {
  const s = effectiveStatus(org);
  if (s === 'suspended') return 'החשבון הושעה — פנה למנהל המערכת';
  if (s === 'expired') return 'המנוי פג תוקף — פנה לחידוש';
  return null;
}

const PUBLIC = new Set(['/api/health', '/api/auth/login', '/api/auth/change-password']);

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('orgId', '');
  app.decorateRequest('managerId', '');
  app.decorateRequest('isAdmin', false);

  app.addHook('onRequest', async (req, reply) => {
    const url = (req.raw.url ?? '').split('?')[0] ?? '';
    if (req.method === 'OPTIONS') return; // CORS preflight
    if (!url.startsWith('/api/')) return; // e.g. /webhook, /availability, static
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
    // Fetch the org in the SAME query (include) so the per-request auth hook
    // makes ONE round-trip instead of two on every authenticated call.
    const manager = await prisma.manager.findUnique({ where: { id: payload.sub }, include: { org: true } });
    if (!manager) return reply.code(401).send({ error: 'החשבון לא נמצא — התחבר מחדש' });

    // Business accounts are blocked live if suspended/expired — unless this is
    // an admin "enter as business" session (imp), or the platform admin.
    if (!manager.isAdmin && manager.orgId && !payload.imp) {
      const reason = manager.org ? accessBlockReason(manager.org) : 'העסק לא נמצא';
      if (reason) return reply.code(403).send({ error: reason, blocked: true });
    }

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
  const loginSchema = z.object({
    username: z.string().min(1).optional(),
    email: z.string().optional(), // legacy fallback
    password: z.string().min(1),
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'שם משתמש או סיסמה חסרים' });
    const id = (parsed.data.username ?? parsed.data.email ?? '').trim();
    if (!id) return reply.code(400).send({ error: 'שם משתמש חסר' });

    const manager = await prisma.manager.findFirst({
      where: { OR: [{ username: id }, { email: id }] },
    });
    if (!manager || !(await verifyPassword(parsed.data.password, manager.passwordHash))) {
      return reply.code(401).send({ error: 'שם משתמש או סיסמה שגויים' });
    }

    const org = manager.orgId ? await prisma.organization.findUnique({ where: { id: manager.orgId } }) : null;
    if (!manager.isAdmin && org) {
      const reason = accessBlockReason(org);
      if (reason) return reply.code(403).send({ error: reason, blocked: true });
    }

    await prisma.manager.update({ where: { id: manager.id }, data: { lastLoginAt: new Date() } });
    const token = signToken(manager.id, manager.orgId ?? '');
    return {
      token,
      manager: { id: manager.id, name: manager.name, username: manager.username ?? '', email: manager.email ?? '' },
      org: org ? { id: org.id, name: org.name } : null,
      isAdmin: manager.isAdmin,
    };
  });

  app.get('/api/auth/me', async (req) => {
    const manager = await prisma.manager.findUnique({ where: { id: req.managerId } });
    const org = req.orgId ? await prisma.organization.findUnique({ where: { id: req.orgId } }) : null;
    return {
      manager: manager ? { id: manager.id, name: manager.name, username: manager.username ?? '', email: manager.email ?? '' } : null,
      org: org ? { id: org.id, name: org.name } : null,
      isAdmin: manager?.isAdmin ?? false,
    };
  });

  // Self-service password change FROM THE LOGIN SCREEN (public). Verifies the current
  // password, updates it, and texts the manager the new credentials in WhatsApp.
  const changeSchema = z.object({
    username: z.string().min(1),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6, 'סיסמה חדשה של לפחות 6 תווים').max(100),
  });
  app.post('/api/auth/change-password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'פרטים לא תקינים' });
    const { username, currentPassword, newPassword } = parsed.data;
    const id = username.trim();
    const manager = await prisma.manager.findFirst({ where: { OR: [{ username: id }, { email: id }] } });
    if (!manager || !(await verifyPassword(currentPassword, manager.passwordHash))) {
      return reply.code(401).send({ error: 'שם משתמש או סיסמה נוכחית שגויים' });
    }
    await prisma.manager.update({
      where: { id: manager.id },
      data: { passwordHash: await hashPassword(newPassword), passwordEnc: encryptSecret(newPassword) },
    });
    if (manager.phone) {
      await channel
        .notify({ id: manager.id, name: manager.name, phone: manager.phone }, passwordChangedMessage(manager.name, manager.username ?? '', newPassword))
        .catch(() => {});
    }
    return { ok: true };
  });
}
