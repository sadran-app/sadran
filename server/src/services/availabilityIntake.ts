// Closes the loop: an employee's free-text WhatsApp reply → parsed → written
// straight into the current cycle's Availability, per shift. No manual entry.

import { prisma, getCurrentCycle } from '../db';

const DAYS: Record<string, number> = { ראשון: 0, שני: 1, שלישי: 2, רביעי: 3, חמישי: 4, שישי: 5, שבת: 6 };

export interface DayIntent {
  dayIndex: number;
  mode: 'all' | 'off' | 'range';
  from?: string; // 'HH:MM'
  to?: string;
}

const normTime = (t: string) => {
  t = t.replace('.', ':');
  if (!t.includes(':')) t += ':00';
  const [h, m] = t.split(':');
  return `${String(Number(h)).padStart(2, '0')}:${String(Number(m ?? '0')).padStart(2, '0')}`;
};

/** Parse a Hebrew availability reply into per-day intents. Robust to loose formats,
 *  including several day names on one line ("ראשון שני שלישי 16:00-22:00"). */
export function parseAvailabilityText(text: string): DayIntent[] {
  const out: DayIntent[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const days = Object.entries(DAYS).filter(([name]) => line.includes(name)).map(([, idx]) => idx);
    if (!days.length) continue;

    let mode: DayIntent['mode'] = 'all';
    let from: string | undefined;
    let to: string | undefined;
    if (line.includes('כל היום') || line.includes('כל השבוע')) mode = 'all';
    else if (/(^|\s)(לא|לא יכול|לא זמין|לא עובד)(\s|$|,|\.)/.test(line)) mode = 'off';
    else {
      const times = line.match(/\d{1,2}(?::\d{2})?/g);
      if (times && times.length >= 2) { mode = 'range'; from = normTime(times[0]!); to = normTime(times[1]!); }
    }
    for (const dayIndex of days) out.push(mode === 'range' ? { dayIndex, mode, from, to } : { dayIndex, mode });
  }
  return out;
}

/**
 * Apply a parsed availability reply for an employee onto the CURRENT cycle's shifts.
 * range → shifts overlapping the hours become 'prefer', the rest 'cant'; all → 'ok';
 * off → 'cant'. Unmentioned days are left untouched (default = available).
 */
export async function applyAvailabilityFromText(employeeId: string, text: string): Promise<{ applied: number } | null> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { orgId: true } });
  if (!emp) return null;
  const intents = parseAvailabilityText(text);
  if (!intents.length) return { applied: 0 };

  const cycle = await getCurrentCycle(emp.orgId).catch(() => null);
  if (!cycle) return null;
  const shifts = await prisma.shift.findMany({ where: { orgId: emp.orgId }, select: { id: true, dayIndex: true, startTime: true, endTime: true } });

  const ops: Promise<unknown>[] = [];
  for (const intent of intents) {
    // Record that the employee RESPONDED for this day (source of truth) — so even an
    // "I'm available" reply, which writes no per-shift 'cant', is counted as submitted.
    const daMode = intent.mode === 'range' ? 'hours' : intent.mode; // all | off | hours
    ops.push(
      prisma.dayAvailability.upsert({
        where: { cycleId_employeeId_dayIndex: { cycleId: cycle.id, employeeId, dayIndex: intent.dayIndex } },
        create: { cycleId: cycle.id, employeeId, dayIndex: intent.dayIndex, mode: daMode, fromTime: intent.from ?? null, toTime: intent.to ?? null },
        update: { mode: daMode, fromTime: intent.from ?? null, toTime: intent.to ?? null },
      }),
    );
    for (const s of shifts.filter((x) => x.dayIndex === intent.dayIndex)) {
      let state: 'ok' | 'prefer' | 'cant';
      if (intent.mode === 'off') state = 'cant';
      else if (intent.mode === 'all') state = 'ok';
      else state = intent.from! < s.endTime && s.startTime < intent.to! ? 'prefer' : 'cant'; // string HH:MM overlap

      if (state === 'ok') {
        ops.push(prisma.availability.deleteMany({ where: { cycleId: cycle.id, employeeId, shiftId: s.id } }));
      } else {
        ops.push(
          prisma.availability.upsert({
            where: { cycleId_employeeId_shiftId: { cycleId: cycle.id, employeeId, shiftId: s.id } },
            create: { cycleId: cycle.id, employeeId, shiftId: s.id, state },
            update: { state },
          }),
        );
      }
    }
  }
  await Promise.all(ops); // parallel — far faster than sequential round-trips
  return { applied: ops.length };
}
