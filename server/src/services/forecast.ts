// Demand forecasting — "המלצת איוש חכמה".
//
// The manager sets how many staff each shift needs (ShiftSlot.count). Guessing that
// number is hard. This learns it from the org's OWN published history: for every
// demand slot it takes a recency-weighted average of how many people were actually
// staffed there over recent published weeks, and surfaces signals (frequent swap-outs
// → maybe overstaffed; frequent forced fills → hard to staff).
//
// LOAD-AWARE: each week's staffing is normalised by the busyness level the manager
// marked for that shift (ShiftLoad), then scaled by the EXPECTED load of the upcoming
// week. So "usually 3 waiters, but this Friday is 'busy' → 4". With no load marked
// everything is "normal" (factor 1) and it degrades to a plain historical average.

import { prisma, getCurrentCycle } from '../db';

const RECENT_WEEKS = 8;   // how many published weeks to learn from
const HALF_LIFE = 3;      // weeks — a week this old counts half as much

// Staffing multiplier per busyness level, relative to "normal".
export const LOAD_FACTOR: Record<number, number> = { 1: 0.65, 2: 1, 3: 1.4, 4: 1.8 };
const factor = (lvl: number | undefined) => LOAD_FACTOR[lvl ?? 2] ?? 1;

export interface SlotForecast {
  slotId: string;
  shiftId: string;
  dayIndex: number;
  shiftLabel: string;
  startTime: string;
  roleId: string;
  roleName: string;
  current: number;       // demand set today
  recommended: number;   // suggested from history, scaled by expected load
  avgFilled: number;     // weighted average actually staffed (raw, for display)
  expectedLevel: number; // busyness the recommendation was scaled to (1–4)
  weeksOfData: number;   // weeks the shift was active (basis for the recommendation)
  swaps: number;         // swap-outs on this slot across history
  forced: number;        // forced fills on this slot across history
  signals: string[];     // Hebrew notes for the manager
}

export interface ShiftLoadEntry {
  shiftId: string;
  dayIndex: number;
  label: string;
  startTime: string;
  endTime: string;
  level: number;
}

export interface ForecastResult {
  publishedWeeks: number;
  loads: ShiftLoadEntry[]; // expected busyness per shift for the upcoming cycle
  slots: SlotForecast[];
}

export async function buildForecast(orgId: string): Promise<ForecastResult> {
  const [slots, roles, cycles, current] = await Promise.all([
    prisma.shiftSlot.findMany({ where: { shift: { orgId } }, include: { shift: true } }),
    prisma.role.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.weekCycle.findMany({
      where: { orgId, status: 'published' },
      orderBy: { weekStartDate: 'desc' },
      take: RECENT_WEEKS,
      select: { id: true },
    }),
    getCurrentCycle(orgId).catch(() => null),
  ]);
  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const cycleIds = cycles.map((c) => c.id);
  const weightOf = new Map(cycleIds.map((id, i) => [id, Math.pow(0.5, i / HALF_LIFE)])); // 0 = most recent

  // expected load for the upcoming cycle, and the historical load each week ran under
  const [expectedRows, histRows] = await Promise.all([
    current ? prisma.shiftLoad.findMany({ where: { cycleId: current.id } }) : Promise.resolve([]),
    cycleIds.length ? prisma.shiftLoad.findMany({ where: { cycleId: { in: cycleIds } } }) : Promise.resolve([]),
  ]);
  const expectedLevel = new Map(expectedRows.map((r) => [r.shiftId, r.level]));
  const histLevel = new Map(histRows.map((r) => [`${r.shiftId}|${r.cycleId}`, r.level]));

  // one load selector per shift that has demand (default = "normal")
  const seen = new Set<string>();
  const loads: ShiftLoadEntry[] = [];
  for (const s of slots) {
    if (seen.has(s.shiftId)) continue;
    seen.add(s.shiftId);
    loads.push({ shiftId: s.shiftId, dayIndex: s.shift.dayIndex, label: s.shift.label, startTime: s.shift.startTime, endTime: s.shift.endTime, level: expectedLevel.get(s.shiftId) ?? 2 });
  }
  loads.sort((a, b) => a.dayIndex - b.dayIndex || a.startTime.localeCompare(b.startTime));

  if (cycleIds.length === 0) {
    return { publishedWeeks: 0, loads, slots: sortSlots(slots.map((s) => baseline(s, roleName, expectedLevel.get(s.shiftId) ?? 2))) };
  }

  const [assignments, swaps] = await Promise.all([
    prisma.assignment.findMany({
      where: { cycleId: { in: cycleIds }, status: 'published' },
      select: { cycleId: true, shiftId: true, slotId: true, forced: true },
    }),
    prisma.swapRequest.findMany({
      where: { cycleId: { in: cycleIds } },
      select: { assignment: { select: { slotId: true } } },
    }),
  ]);

  const filled = new Map<string, number>();           // `${slotId}|${cycleId}` → count
  const shiftActive = new Map<string, Set<string>>(); // shiftId → cycleIds it ran in
  const forcedBySlot = new Map<string, number>();
  for (const a of assignments) {
    filled.set(`${a.slotId}|${a.cycleId}`, (filled.get(`${a.slotId}|${a.cycleId}`) ?? 0) + 1);
    let set = shiftActive.get(a.shiftId);
    if (!set) shiftActive.set(a.shiftId, (set = new Set()));
    set.add(a.cycleId);
    if (a.forced) forcedBySlot.set(a.slotId, (forcedBySlot.get(a.slotId) ?? 0) + 1);
  }
  const swapsBySlot = new Map<string, number>();
  for (const s of swaps) {
    const id = s.assignment?.slotId;
    if (id) swapsBySlot.set(id, (swapsBySlot.get(id) ?? 0) + 1);
  }

  const out = slots.map((slot) => {
    const activeCycles = cycleIds.filter((cid) => shiftActive.get(slot.shiftId)?.has(cid));
    const weeksOfData = activeCycles.length;
    let wSum = 0, rawSum = 0, normSum = 0;
    for (const cid of activeCycles) {
      const w = weightOf.get(cid)!;
      const f = filled.get(`${slot.id}|${cid}`) ?? 0;
      wSum += w;
      rawSum += w * f;
      normSum += w * (f / factor(histLevel.get(`${slot.shiftId}|${cid}`))); // staffing at "normal" load
    }
    const rawAvg = wSum > 0 ? rawSum / wSum : slot.count;
    const normBase = wSum > 0 ? normSum / wSum : slot.count;
    const exp = expectedLevel.get(slot.shiftId) ?? 2;
    const swapsN = swapsBySlot.get(slot.id) ?? 0;
    const forcedN = forcedBySlot.get(slot.id) ?? 0;

    // Not enough history → keep the current plan, don't guess.
    const recommended = weeksOfData >= 2 ? Math.max(1, Math.round(normBase * factor(exp))) : slot.count;

    const signals: string[] = [];
    if (weeksOfData >= 2 && swapsN >= weeksOfData) signals.push('נטישות תכופות במשמרת זו — ייתכן עודף איוש או משמרת לא פופולרית');
    if (weeksOfData >= 2 && forcedN >= weeksOfData) signals.push('קושי איוש — הרבה שיבוצי כפייה; ייתכן שחסרים עובדים זמינים');
    if (weeksOfData < 2) signals.push('אין מספיק היסטוריה מפורסמת להמלצה מבוססת');

    return {
      slotId: slot.id, shiftId: slot.shiftId, dayIndex: slot.shift.dayIndex, shiftLabel: slot.shift.label,
      startTime: slot.startTime, roleId: slot.roleId, roleName: roleName.get(slot.roleId) ?? '—',
      current: slot.count, recommended, avgFilled: Math.round(rawAvg * 10) / 10, expectedLevel: exp,
      weeksOfData, swaps: swapsN, forced: forcedN, signals,
    } satisfies SlotForecast;
  });

  return { publishedWeeks: cycleIds.length, loads, slots: sortSlots(out) };
}

type SlotRow = { id: string; shiftId: string; count: number; roleId: string; startTime: string; shift: { dayIndex: number; label: string } };
function baseline(s: SlotRow, roleName: Map<string, string>, expectedLevel: number): SlotForecast {
  return {
    slotId: s.id, shiftId: s.shiftId, dayIndex: s.shift.dayIndex, shiftLabel: s.shift.label,
    startTime: s.startTime, roleId: s.roleId, roleName: roleName.get(s.roleId) ?? '—',
    current: s.count, recommended: s.count, avgFilled: s.count, expectedLevel,
    weeksOfData: 0, swaps: 0, forced: 0,
    signals: ['אין מספיק היסטוריה מפורסמת להמלצה מבוססת'],
  };
}
function sortSlots(list: SlotForecast[]): SlotForecast[] {
  return list.sort((a, b) => a.dayIndex - b.dayIndex || a.startTime.localeCompare(b.startTime) || a.roleName.localeCompare(b.roleName));
}
