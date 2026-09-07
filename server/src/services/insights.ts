// Smart insights for the manager — heuristic analysis over the org's PUBLISHED
// schedules. Surfaces fairness drift, under/over-use, reliability and coverage
// signals as plain-Hebrew observations + a concrete tip. Deterministic & explainable.

import { endHour } from '@engine';
import { prisma, parseLaborRules } from '../db';
import { WEEKEND_DAYS } from './schedule';

export interface Insight {
  id: string;
  severity: 'positive' | 'info' | 'warning';
  title: string;
  detail: string;
  tip?: string;
  employeeName?: string;
}

export async function buildInsights(orgId: string): Promise<Insight[]> {
  const [org, employees, cycles] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
    prisma.employee.findMany({ where: { orgId, active: true } }),
    prisma.weekCycle.findMany({ where: { orgId, status: 'published' }, orderBy: { weekStartDate: 'desc' } }),
  ]);
  const rules = parseLaborRules(org.laborRules);
  const out: Insight[] = [];
  if (cycles.length === 0) return out;

  const cycleIds = cycles.map((c) => c.id);
  const [assignments, swaps] = await Promise.all([
    prisma.assignment.findMany({ where: { cycleId: { in: cycleIds }, status: 'published' }, include: { shift: true } }),
    prisma.swapRequest.findMany({ where: { cycleId: { in: cycleIds }, status: 'approved' } }),
  ]);

  // per employee → per cycle: total + weekend + closing counts
  type PerCycle = { total: number; weekend: number; closing: number };
  const stat = new Map<string, Map<string, PerCycle>>();
  const ensure = (emp: string, cyc: string): PerCycle => {
    let m = stat.get(emp);
    if (!m) stat.set(emp, (m = new Map()));
    let p = m.get(cyc);
    if (!p) m.set(cyc, (p = { total: 0, weekend: 0, closing: 0 }));
    return p;
  };
  for (const a of assignments) {
    const p = ensure(a.employeeId, a.cycleId);
    p.total += 1;
    if (WEEKEND_DAYS.includes(a.shift.dayIndex)) p.weekend += 1;
    if (endHour(a.startTime, a.shift.endTime) >= rules.closingHour) p.closing += 1;
  }
  const swapOut = new Map<string, number>();
  for (const s of swaps) if (s.previousHolderId) swapOut.set(s.previousHolderId, (swapOut.get(s.previousHolderId) ?? 0) + 1);

  const weeks = cycles.length;
  const nameOf = new Map(employees.map((e) => [e.id, e.name]));

  for (const e of employees) {
    const per = stat.get(e.id) ?? new Map<string, PerCycle>();
    const totalShifts = [...per.values()].reduce((s, p) => s + p.total, 0);

    // never scheduled
    if (totalShifts === 0) {
      out.push({ id: `never-${e.id}`, severity: 'warning', employeeName: e.name, title: 'לא שובץ/ה כלל', detail: `${e.name} עדיין לא שובץ/ה לאף משמרת מאז ההצטרפות.`, tip: 'בדוק זמינות/תפקידים, או שבצו ידנית השבוע.' });
      continue;
    }

    // consecutive recent published weeks worked but with NO weekend shift
    let streak = 0;
    for (const c of cycles) {
      const p = per.get(c.id);
      if (!p || p.total === 0) break; // didn't work that week → stop the streak
      if (p.weekend > 0) break;
      streak += 1;
    }
    if (streak >= 3) {
      out.push({ id: `noweekend-${e.id}`, severity: 'info', employeeName: e.name, title: 'ללא סופ״ש זמן רב', detail: `${e.name} עבד/ה ${streak} שבועות רצופים בלי אף משמרת סוף שבוע.`, tip: 'לאיזון הוגן, שקול לשבצו לסופ״ש הקרוב.' });
    }

    // below configured minimum
    const avg = totalShifts / weeks;
    if (e.minShifts > 0 && avg < e.minShifts) {
      out.push({ id: `belowmin-${e.id}`, severity: 'warning', employeeName: e.name, title: 'מתחת למינימום', detail: `${e.name} מקבל/ת בממוצע ${Math.round(avg * 10) / 10} משמרות בשבוע, מתחת למינימום שהוגדר (${e.minShifts}).`, tip: 'הוסף שיבוצים או עדכן את הגדרת המינימום.' });
    }

    // frequent shift drop-offs
    const outs = swapOut.get(e.id) ?? 0;
    if (outs >= 3) {
      out.push({ id: `swaps-${e.id}`, severity: 'warning', employeeName: e.name, title: 'מפיל/ה הרבה משמרות', detail: `${e.name} הפיל/ה ${outs} משמרות להחלפה.`, tip: 'שיחה על עומס/התאמת ימים עשויה לעזור.' });
    }
  }

  // who carries the most undesirable (weekend + closing) load
  let topId: string | null = null;
  let topLoad = 0;
  for (const [emp, m] of stat) {
    const load = [...m.values()].reduce((s, p) => s + p.weekend + p.closing, 0);
    if (load > topLoad) { topLoad = load; topId = emp; }
  }
  if (topId && topLoad >= 4) {
    out.push({ id: `topload-${topId}`, severity: 'info', employeeName: nameOf.get(topId), title: 'נושא/ת עומס גבוה', detail: `${nameOf.get(topId)} צובר/ת הכי הרבה משמרות סופ״ש/סגירה (${topLoad}).`, tip: 'ודא שהעומס מתחלק בהוגנות לאורך זמן.' });
  }

  // current-week availability gap
  const current = await prisma.weekCycle.findFirst({ where: { orgId }, orderBy: { weekStartDate: 'desc' } });
  if (current) {
    const responders = new Set((await prisma.availability.findMany({ where: { cycleId: current.id }, select: { employeeId: true } })).map((a) => a.employeeId));
    const missing = employees.filter((e) => !responders.has(e.id)).length;
    if (missing > 0) out.push({ id: 'noavail', severity: 'warning', title: 'זמינות חסרה', detail: `${missing} עובדים טרם הגישו זמינות לשבוע הנוכחי.`, tip: 'שלח תזכורת מלשונית "מעקב".' });
  }

  if (out.length === 0) out.push({ id: 'allgood', severity: 'positive', title: 'הכול נראה טוב', detail: 'לא זוהו חריגות משמעותיות בניהול העובדים לאחרונה. עבודה טובה! 👏' });
  // warnings first
  const order = { warning: 0, info: 1, positive: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
