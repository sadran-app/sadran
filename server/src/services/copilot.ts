// Manager copilot — 100% free, no external AI. Answers common questions by
// keyword-matching to a skill and pulling from data we already compute (reports,
// insights, availability). In-app only → zero WhatsApp / API cost.

import { prisma, getCurrentCycle } from '../db';
import { buildOrgReport } from './reports';
import { buildInsights } from './insights';
import { slotDeficit } from './gaps';
import { buildForecast } from './forecast';

export interface CopilotAnswer {
  answer: string;
  suggestions?: string[];
}

export const COPILOT_SUGGESTIONS = [
  'כמה עלה השכר?',
  'מי הכי הרבה משמרות?',
  'מי לא הגיש זמינות?',
  'כמה חוסרים בסידור?',
  'כמה עובדים כדאי לשבץ?',
  'תן לי תובנות',
];

export async function askCopilot(orgId: string, question: string): Promise<CopilotAnswer> {
  const q = question.trim();
  const has = (...words: string[]) => words.some((w) => q.includes(w));

  // ---- labor cost / salary ----
  if (has('עלות', 'שכר', 'כמה עלה', 'כמה עולה', 'תקציב')) {
    const r = await buildOrgReport(orgId);
    return { answer: `💰 עלות השכר (סידורים שפורסמו): ₪${r.summary.totalLaborCost.toLocaleString('he-IL')}\n${r.summary.totalHours} שעות · ${r.summary.totalShifts} משמרות · ממוצע ₪${r.summary.avgHoursPerEmployee} שעות לעובד.` };
  }

  // ---- staffing recommendation / demand forecast ----
  if (has('כמה עובדים', 'איוש', 'חיזוי', 'כמה צריך', 'כמה לשבץ', 'המלצת')) {
    const f = await buildForecast(orgId);
    if (f.publishedWeeks < 2) return { answer: '📊 אין עדיין מספיק סידורים שפורסמו כדי להמליץ על איוש — פרסם עוד כמה שבועות והמערכת תלמד את הדפוסים.' };
    const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const diffs = f.slots.filter((s) => s.recommended !== s.current);
    if (!diffs.length) return { answer: `📊 לפי ${f.publishedWeeks} השבועות האחרונים — האיוש שהגדרת תואם להיסטוריה, אין המלצות לשינוי.` };
    const lines = diffs.slice(0, 6).map((s) => `יום ${days[s.dayIndex]} · ${s.shiftLabel} · ${s.roleName}: ${s.current} → ${s.recommended}`);
    return { answer: `📊 המלצות איוש (לפי ${f.publishedWeeks} שבועות):\n${lines.join('\n')}${diffs.length > 6 ? `\nועוד ${diffs.length - 6}…` : ''}\nאפשר להחיל בלשונית "הגדרות".` };
  }

  // ---- top contributors / reliability / ranking ----
  if (has('הכי הרבה', 'הכי אמין', 'דירוג', 'מוביל', 'הכי טוב', 'תורם')) {
    const r = await buildOrgReport(orgId);
    const top = r.employees.filter((e) => e.rank > 0).slice(0, 3);
    if (!top.length) return { answer: 'עדיין אין נתוני משמרות שפורסמו כדי לדרג.' };
    return { answer: '🏆 המובילים בתרומה:\n' + top.map((e) => `#${e.rank} ${e.name} — ${e.shifts} משמרות, ${e.hours} שעות`).join('\n') };
  }

  // ---- who hasn't submitted availability ----
  if (has('לא הגיש', 'לא הגישו', 'זמינות', 'טרם', 'מי חסר')) {
    const cycle = await getCurrentCycle(orgId).catch(() => null);
    if (!cycle) return { answer: 'אין מחזור פעיל כרגע.' };
    const [emps, avail, dayAvail] = await Promise.all([
      prisma.employee.findMany({ where: { orgId, active: true }, select: { id: true, name: true } }),
      prisma.availability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
      prisma.dayAvailability.findMany({ where: { cycleId: cycle.id }, select: { employeeId: true } }),
    ]);
    const responded = new Set([...avail, ...dayAvail].map((a) => a.employeeId));
    const missing = emps.filter((e) => !responded.has(e.id));
    return {
      answer: missing.length
        ? `📋 ${missing.length} טרם הגישו זמינות: ${missing.map((e) => e.name).join(', ')}.\nאפשר לשלוח תזכורת מלשונית "מעקב".`
        : 'כל העובדים הגישו זמינות לשבוע הנוכחי 🎉',
    };
  }

  // ---- gaps / forced assignments ----
  if (has('חוסר', 'חסר', 'משבצות', 'כפוי', 'אדום')) {
    const cycle = await getCurrentCycle(orgId).catch(() => null);
    if (!cycle) return { answer: 'אין מחזור פעיל כרגע.' };
    const [asg, demand] = await Promise.all([
      prisma.assignment.findMany({ where: { cycleId: cycle.id, status: { in: ['proposed', 'published'] } }, select: { slotId: true, forced: true, startTime: true, endTime: true } }),
      prisma.shiftSlot.findMany({ where: { shift: { orgId } }, include: { shift: { select: { endTime: true } } } }),
    ]);
    const bySlot = new Map<string, { startTime: string; endTime: string }[]>();
    for (const a of asg) {
      const list = bySlot.get(a.slotId) ?? [];
      list.push({ startTime: a.startTime, endTime: a.endTime ?? '' });
      bySlot.set(a.slotId, list);
    }
    let gaps = 0;
    for (const d of demand) {
      const rows = (bySlot.get(d.id) ?? []).map((r) => ({ startTime: r.startTime, endTime: r.endTime || d.shift.endTime }));
      gaps += slotDeficit(d.startTime, d.shift.endTime, d.count, rows);
    }
    const forced = asg.filter((a) => a.forced).length;
    return { answer: `🗓️ בסידור הנוכחי: ${gaps} משבצות ללא איוש חוקי, ${forced} שיבוצים בכפייה (מסומן אדום — דורש אישור).` };
  }

  // ---- headcount ----
  if (has('כמה עובדים', 'מספר עובדים', 'כמות עובדים')) {
    const n = await prisma.employee.count({ where: { orgId, active: true } });
    return { answer: `👥 יש ${n} עובדים פעילים במערכת.` };
  }

  // ---- insights / weekends / tips ----
  if (has('תובנות', 'תובנה', 'מה חשוב', 'המלצ', 'טיפ', 'שבתות', 'לא עשה', 'בעיות')) {
    const ins = await buildInsights(orgId);
    return { answer: '🧠 תובנות:\n' + ins.slice(0, 4).map((i) => `• ${i.detail}${i.tip ? ` (💡 ${i.tip})` : ''}`).join('\n') };
  }

  // ---- fallback ----
  return { answer: 'לא בטוח שהבנתי את השאלה 🤔 נסה אחת מאלה:', suggestions: COPILOT_SUGGESTIONS };
}
