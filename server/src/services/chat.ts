// In-app WhatsApp inbox: one conversation per employee. Outbound comes from the
// existing OutboxMessage (every channel send already records there); inbound is
// fed by the webhook into InboundMessage. This service merges them into a thread.

import { prisma } from '../db';
import { channel } from '../channel';

export interface ChatMessage {
  id: string;
  direction: 'in' | 'out';
  body: string;
  kind: string;
  failed?: boolean;
  mediaUrl?: string | null;
  createdAt: Date;
}

const last9 = (p: string) => (p || '').replace(/\D/g, '').slice(-9);
// outbound bodies get a "\n— <error>" suffix appended on delivery failure — hide it in the chat
const clean = (s: string) => s.split('\n— ')[0] ?? s;

export async function listConversations(orgId: string) {
  const employees = await prisma.employee.findMany({ where: { orgId }, select: { id: true, name: true, phone: true, active: true } });
  const ids = employees.map((e) => e.id);
  if (!ids.length) return [];
  const [outs, ins] = await Promise.all([
    prisma.outboxMessage.findMany({ where: { employeeId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
    prisma.inboundMessage.findMany({ where: { employeeId: { in: ids } }, orderBy: { createdAt: 'desc' } }),
  ]);
  const lastOut = new Map<string, (typeof outs)[number]>();
  for (const m of outs) if (!lastOut.has(m.employeeId)) lastOut.set(m.employeeId, m);
  const lastIn = new Map<string, (typeof ins)[number]>();
  const unread = new Map<string, number>();
  for (const m of ins) {
    if (!lastIn.has(m.employeeId)) lastIn.set(m.employeeId, m);
    if (!m.read) unread.set(m.employeeId, (unread.get(m.employeeId) ?? 0) + 1);
  }
  return employees
    .map((e) => {
      const o = lastOut.get(e.id);
      const i = lastIn.get(e.id);
      const last = !o && !i ? null : !o ? i : !i ? o : o.createdAt > i.createdAt ? o : i;
      return {
        employeeId: e.id,
        name: e.name,
        phone: e.phone,
        active: e.active,
        lastBody: last ? clean(last.body) : null,
        lastAt: last?.createdAt ?? null,
        lastDir: last ? (last === i ? 'in' : 'out') : null,
        unread: unread.get(e.id) ?? 0,
      };
    })
    .sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
}

export async function getThread(orgId: string, employeeId: string): Promise<ChatMessage[] | null> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { orgId: true } });
  if (!emp || emp.orgId !== orgId) return null;
  const [outs, ins] = await Promise.all([
    prisma.outboxMessage.findMany({ where: { employeeId } }),
    prisma.inboundMessage.findMany({ where: { employeeId } }),
  ]);
  if (ins.some((m) => !m.read)) await prisma.inboundMessage.updateMany({ where: { employeeId, read: false }, data: { read: true } });
  const msgs: ChatMessage[] = [
    ...outs.map((m) => ({ id: m.id, direction: 'out' as const, body: clean(m.body), kind: m.kind, failed: m.failed, createdAt: m.createdAt })),
    ...ins.map((m) => ({ id: m.id, direction: 'in' as const, body: m.body, kind: m.kind, mediaUrl: m.mediaUrl, createdAt: m.createdAt })),
  ];
  return msgs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

export async function sendChatMessage(orgId: string, employeeId: string, body: string): Promise<boolean> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp || emp.orgId !== orgId) return false;
  // channel.notify records an OutboxMessage → shows in the thread as an outbound bubble
  await channel.notify({ id: emp.id, name: emp.name, phone: emp.phone }, body);
  return true;
}

/** Webhook entry: map an inbound WhatsApp phone → employee and store the message. */
export async function recordInbound(phone: string, body: string, kind = 'text', waMessageId?: string, mediaUrl?: string) {
  const target = last9(phone);
  if (!target) return null;
  const employees = await prisma.employee.findMany({ select: { id: true, phone: true } });
  const emp = employees.find((e) => last9(e.phone) === target);
  if (!emp) return null; // unknown number — ignored (could be surfaced later)
  return prisma.inboundMessage.create({ data: { employeeId: emp.id, body, kind, waMessageId, mediaUrl } });
}
