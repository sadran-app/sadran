// Current coverage gaps = each demand requirement minus its current assignments.
// Computed live so it stays correct after manual edits, not just after generate.
//
// Coverage is INTERVAL-AWARE: a seat can be split between employees across time
// (e.g. 16:00–20:00 + 20:00–24:00). So "how many are missing" is the PEAK deficit —
// the largest number of bodies short at any instant of the shift — not a head count.
// With only full-length assignments this reduces to the old count-based formula.

import { toMinutes } from '@engine';
import { prisma } from '../db';

export interface CoverageGap {
  dayIndex: number;
  shiftId: string;
  slotId: string;
  roleId: string;
  startTime: string;
  required: number;
  filled: number;
  missing: number;
}

/** Minutes-of-week for a shift interval; overnight (end <= start) rolls to next day. */
function span(start: string, end: string): [number, number] {
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return [s, e];
}

/**
 * Peak shortfall for one seat over [start, end] given `count` needed and the
 * intervals actually covered. 0 = fully covered N-deep everywhere.
 */
export function slotDeficit(
  start: string,
  end: string,
  count: number,
  intervals: { startTime: string; endTime: string }[],
): number {
  const [S, E] = span(start, end);
  if (E <= S) return 0;
  const segs = intervals
    .map((iv) => {
      const [a, b] = span(iv.startTime, iv.endTime);
      return [Math.max(a, S), Math.min(b, E)] as [number, number];
    })
    .filter(([a, b]) => b > a);

  const pts = new Set<number>([S, E]);
  for (const [a, b] of segs) { pts.add(a); pts.add(b); }
  const sorted = [...pts].filter((p) => p >= S && p <= E).sort((x, y) => x - y);

  let maxDef = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const mid = (sorted[i]! + sorted[i + 1]!) / 2;
    let depth = 0;
    for (const [a, b] of segs) if (a <= mid && mid < b) depth++;
    maxDef = Math.max(maxDef, count - depth);
  }
  return Math.max(0, maxDef);
}

export async function currentGaps(orgId: string, cycleId: string): Promise<CoverageGap[]> {
  const [demand, assignments] = await Promise.all([
    prisma.shiftSlot.findMany({ where: { shift: { orgId } }, include: { shift: true } }),
    prisma.assignment.findMany({
      where: { cycleId, status: { in: ['proposed', 'published'] } },
      select: { slotId: true, startTime: true, endTime: true },
    }),
  ]);

  const bySlot = new Map<string, { startTime: string; endTime: string }[]>();
  for (const a of assignments) {
    const list = bySlot.get(a.slotId) ?? [];
    list.push({ startTime: a.startTime, endTime: a.endTime ?? '' }); // endTime filled below per-slot
    bySlot.set(a.slotId, list);
  }

  const gaps: CoverageGap[] = [];
  for (const d of demand) {
    const rows = (bySlot.get(d.id) ?? []).map((r) => ({ startTime: r.startTime, endTime: r.endTime || d.shift.endTime }));
    const missing = slotDeficit(d.startTime, d.shift.endTime, d.count, rows);
    if (missing > 0) {
      gaps.push({
        dayIndex: d.shift.dayIndex,
        shiftId: d.shiftId,
        slotId: d.id,
        roleId: d.roleId,
        startTime: d.startTime,
        required: d.count,
        filled: d.count - missing,
        missing,
      });
    }
  }
  return gaps;
}
