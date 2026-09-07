// In-process weekly scheduler: sends the availability request automatically on
// each org's configured day + time, to everyone who hasn't replied yet. Fires at
// most once per week per org (guarded by lastAutoSentAt).

import { prisma, getCurrentCycle } from '../db';
import { channel } from '../channel';

/** Send the org's availability request to employees who haven't replied for the current cycle. */
export async function sendAvailabilityRequests(orgId: string): Promise<number> {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org?.whatsappEnabled) return 0;
  const cycle = await getCurrentCycle(orgId).catch(() => null);
  if (!cycle) return 0;
  const [employees, avail, dayAvail] = await Promise.all([
    prisma.employee.findMany({ where: { orgId, active: true } }),
    prisma.availability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
    prisma.dayAvailability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
  ]);
  // skip anyone we already have info for — WhatsApp reply OR manual config
  const responded = new Set([...avail, ...dayAvail].map((a) => a.employeeId));
  const targets = employees.filter((e) => !responded.has(e.id));
  for (const e of targets) {
    await channel.notify({ id: e.id, name: e.name, phone: e.phone }, org.autoMessage.replace(/\{שם\}/g, e.name));
  }
  if (targets.length) await prisma.organization.update({ where: { id: orgId }, data: { whatsappMessageCount: { increment: targets.length } } });
  return targets.length;
}

/** This week's send moment (local server time) for a given weekday (0=Sun) + HH:MM. */
function weekSendMoment(day: number, time: string, now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + (day - d.getDay()));
  const [h, m] = time.split(':').map(Number);
  d.setHours(h ?? 9, m ?? 0, 0, 0);
  return d;
}

export async function tickAutoAvailability(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    where: { whatsappEnabled: true, autoSendEnabled: true, status: 'active', isChain: false },
  });
  const now = new Date();
  for (const org of orgs) {
    const moment = weekSendMoment(org.autoSendDay, org.autoSendTime, now);
    if (now < moment) continue; // this week's time hasn't arrived yet
    if (org.lastAutoSentAt && org.lastAutoSentAt >= moment) continue; // already sent this week
    try {
      await sendAvailabilityRequests(org.id);
      await prisma.organization.update({ where: { id: org.id }, data: { lastAutoSentAt: now } });
    } catch {
      /* keep the loop alive for other orgs */
    }
  }
}

export function startScheduler(): void {
  // check every 5 minutes; the guards ensure a single weekly send per org
  setInterval(() => { tickAutoAvailability().catch(() => {}); }, 5 * 60 * 1000);
}
