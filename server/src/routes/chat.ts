import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { listConversations, getThread, sendChatMessage, recordInbound } from '../services/chat';
import { applyAvailabilityFromText } from '../services/availabilityIntake';
import { handleWaCommand } from '../services/waCommands';

export async function chatRoutes(app: FastifyInstance) {
  // Conversation list (one per employee) with last message + unread count.
  app.get('/api/chat/conversations', async (req) => listConversations(req.orgId));

  // Full thread for one employee (marks inbound as read).
  app.get('/api/chat/:employeeId', async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string };
    const thread = await getThread(req.orgId, employeeId);
    if (thread === null) return reply.code(404).send({ error: 'עובד לא נמצא' });
    return thread;
  });

  // Send a message to an employee (goes through the channel → WhatsApp when connected).
  const sendSchema = z.object({ body: z.string().min(1).max(4000) });
  app.post('/api/chat/:employeeId', async (req, reply) => {
    const { employeeId } = req.params as { employeeId: string };
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'הודעה ריקה' });
    const ok = await sendChatMessage(req.orgId, employeeId, parsed.data.body);
    if (!ok) return reply.code(404).send({ error: 'עובד לא נמצא' });
    return { ok: true };
  });
}

// WhatsApp inbound webhook — OUTSIDE /api so the auth hook skips it. Dormant until
// Meta's registration is complete and the callback URL points here; then every
// employee reply flows straight into the in-app chat.
export async function webhookRoutes(app: FastifyInstance) {
  const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN ?? 'sadran-verify';
  const APP_SECRET = process.env.WHATSAPP_APP_SECRET;

  // Keep the raw request bytes (only in this plugin scope) so we can verify Meta's
  // X-Hub-Signature-256 HMAC over the EXACT payload — JSON.stringify wouldn't match.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    (_req as unknown as { rawBody?: Buffer }).rawBody = body as Buffer;
    const s = body.toString('utf8').trim();
    try { done(null, s ? JSON.parse(s) : {}); } catch (e) { done(e as Error); }
  });

  // Reject any payload whose signature doesn't match our app secret. If no secret is
  // configured (dev / not yet connected), the webhook stays dormant and accepts nothing
  // that pretends to be signed — but unsigned dev calls still pass for local testing.
  const verifySignature = (req: { headers: Record<string, unknown>; rawBody?: Buffer }): boolean => {
    if (!APP_SECRET) return true; // not connected to Meta yet
    const sig = req.headers['x-hub-signature-256'];
    if (typeof sig !== 'string') return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody ?? Buffer.alloc(0)).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };

  app.get('/webhook', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === VERIFY) {
      return reply.code(200).type('text/plain').send(q['hub.challenge'] ?? '');
    }
    return reply.code(403).send('forbidden');
  });

  app.post('/webhook', async (req, reply) => {
    if (!verifySignature(req as unknown as { headers: Record<string, unknown>; rawBody?: Buffer })) {
      return reply.code(401).send({ error: 'invalid signature' });
    }
    reply.code(200).send({ received: true }); // ack immediately
    try {
      const body = req.body as {
        entry?: { changes?: { value?: { messages?: Array<Record<string, any>> } }[] }[];
      };
      const value = body?.entry?.[0]?.changes?.[0]?.value;
      for (const m of value?.messages ?? []) {
        const from = String(m.from ?? '');
        let text = '';
        let kind = String(m.type ?? 'text');
        if (m.type === 'text') text = m.text?.body ?? '';
        else if (m.type === 'interactive') {
          const i = m.interactive ?? {};
          text = i.button_reply?.title ?? i.list_reply?.title ?? i.nfm_reply?.response_json ?? '';
          kind = 'interactive';
        } else text = `[${m.type}]`;
        if (from) {
          const rec = await recordInbound(from, text, kind, m.id);
          if (rec && m.type === 'text') {
            // 3.4 — first try a self-service command (my shifts / time-off / swap); if it
            // matched, reply to the employee. Otherwise parse the text as availability.
            const reply = await handleWaCommand(rec.employeeId, text).catch(() => null);
            if (reply) {
              const emp = await prisma.employee.findUnique({ where: { id: rec.employeeId }, select: { orgId: true } });
              if (emp) await sendChatMessage(emp.orgId, rec.employeeId, reply).catch(() => {});
            } else {
              await applyAvailabilityFromText(rec.employeeId, text).catch(() => {});
            }
          }
        }
      }
    } catch (e) {
      req.log.error(e as Error);
    }
  });
}
