// WhatsApp usage accounting — WITHOUT touching the send path. Every outbound message
// is already recorded in OutboxMessage and every reply in InboundMessage; from those we
// derive, per business, how many messages were FREE (sent inside the employee's 24h
// service window) vs BILLABLE (sent outside it → needs a paid template). This is the
// backbone of the budget monitoring: free = unlimited, billable = counted vs the budget.

import { prisma } from '../db';

const WINDOW_MS = 24 * 60 * 60 * 1000;

export interface WaUsage {
  total: number;
  free: number;     // sent inside a 24h window (service message — free)
  billable: number; // sent outside a window (needs a paid template)
}
export interface WaUsageDetail extends WaUsage {
  byKind: { kind: string; free: number; billable: number }[];
}

/** Start-of-current-month → now. */
export function monthRange(now = new Date()): { from: Date; to: Date } {
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
}

// Was the employee inside a 24h service window at time `t`? (any inbound in (t-24h, t])
function inWindow(sortedInbound: number[], t: number): boolean {
  for (let i = sortedInbound.length - 1; i >= 0; i--) {
    const v = sortedInbound[i]!;
    if (v > t) continue;
    return t - v <= WINDOW_MS; // most recent inbound at/before t
  }
  return false;
}

async function loadData(from: Date, to: Date) {
  // inbound from 24h BEFORE the range too — a message early in the range may sit inside
  // a window opened just before it.
  const [employees, outbound, inbound] = await Promise.all([
    prisma.employee.findMany({ select: { id: true, orgId: true } }),
    prisma.outboxMessage.findMany({ where: { createdAt: { gte: from, lte: to } }, select: { employeeId: true, kind: true, createdAt: true } }),
    prisma.inboundMessage.findMany({ where: { createdAt: { gte: new Date(from.getTime() - WINDOW_MS), lte: to } }, select: { employeeId: true, createdAt: true } }),
  ]);
  const orgOf = new Map(employees.map((e) => [e.id, e.orgId]));
  const inboundByEmp = new Map<string, number[]>();
  for (const m of inbound) {
    const arr = inboundByEmp.get(m.employeeId) ?? [];
    arr.push(m.createdAt.getTime());
    inboundByEmp.set(m.employeeId, arr);
  }
  for (const arr of inboundByEmp.values()) arr.sort((a, b) => a - b);
  return { orgOf, outbound, inboundByEmp };
}

/** Billable/free usage per org for a time range (only employee-directed messages count). */
export async function usageByOrg(from: Date, to: Date): Promise<Map<string, WaUsage>> {
  const { orgOf, outbound, inboundByEmp } = await loadData(from, to);
  const out = new Map<string, WaUsage>();
  for (const m of outbound) {
    const orgId = orgOf.get(m.employeeId);
    if (!orgId) continue; // e.g. a manager onboarding message — not employee messaging
    const u = out.get(orgId) ?? { total: 0, free: 0, billable: 0 };
    u.total += 1;
    if (inWindow(inboundByEmp.get(m.employeeId) ?? [], m.createdAt.getTime())) u.free += 1;
    else u.billable += 1;
    out.set(orgId, u);
  }
  return out;
}

/** Same, for ONE org, with a per-message-type breakdown (for the business dialog). */
export async function usageDetail(orgId: string, from: Date, to: Date): Promise<WaUsageDetail> {
  const employees = await prisma.employee.findMany({ where: { orgId }, select: { id: true } });
  const empIds = employees.map((e) => e.id);
  if (empIds.length === 0) return { total: 0, free: 0, billable: 0, byKind: [] };
  const [outbound, inbound] = await Promise.all([
    prisma.outboxMessage.findMany({ where: { employeeId: { in: empIds }, createdAt: { gte: from, lte: to } }, select: { kind: true, employeeId: true, createdAt: true } }),
    prisma.inboundMessage.findMany({ where: { employeeId: { in: empIds }, createdAt: { gte: new Date(from.getTime() - WINDOW_MS), lte: to } }, select: { employeeId: true, createdAt: true } }),
  ]);
  const inboundByEmp = new Map<string, number[]>();
  for (const m of inbound) { const a = inboundByEmp.get(m.employeeId) ?? []; a.push(m.createdAt.getTime()); inboundByEmp.set(m.employeeId, a); }
  for (const a of inboundByEmp.values()) a.sort((x, y) => x - y);

  const kinds = new Map<string, { free: number; billable: number }>();
  let free = 0, billable = 0;
  for (const m of outbound) {
    const k = kinds.get(m.kind) ?? { free: 0, billable: 0 };
    if (inWindow(inboundByEmp.get(m.employeeId) ?? [], m.createdAt.getTime())) { k.free += 1; free += 1; }
    else { k.billable += 1; billable += 1; }
    kinds.set(m.kind, k);
  }
  return {
    total: free + billable, free, billable,
    byKind: [...kinds.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.billable - a.billable),
  };
}
