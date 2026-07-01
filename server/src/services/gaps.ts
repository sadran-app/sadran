// Current coverage gaps = each demand requirement minus its current assignments.
// Computed live so it stays correct after manual edits, not just after generate.

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

export async function currentGaps(orgId: string, cycleId: string): Promise<CoverageGap[]> {
  const [demand, assignments] = await Promise.all([
    prisma.shiftSlot.findMany({ where: { shift: { orgId } }, include: { shift: true } }),
    prisma.assignment.findMany({ where: { cycleId, status: { in: ['proposed', 'published'] } } }),
  ]);

  const filled = new Map<string, number>();
  for (const a of assignments) filled.set(a.slotId, (filled.get(a.slotId) ?? 0) + 1);

  const gaps: CoverageGap[] = [];
  for (const d of demand) {
    const have = filled.get(d.id) ?? 0;
    if (have < d.count) {
      gaps.push({
        dayIndex: d.shift.dayIndex,
        shiftId: d.shiftId,
        slotId: d.id,
        roleId: d.roleId,
        startTime: d.startTime,
        required: d.count,
        filled: have,
        missing: d.count - have,
      });
    }
  }
  return gaps;
}
