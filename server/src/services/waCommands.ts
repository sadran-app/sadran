// 3.4 — WhatsApp-native self-service. An employee reply is first checked for a
// command; if it matches one we act + return a reply, otherwise null so the normal
// availability parser runs. No app, no login — everything over WhatsApp.

import { prisma, getCurrentCycle } from '../db';

const DAY = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const RE_SHIFTS = /המשמרות שלי|משמרות שלי|הסידור שלי|מתי אני עובד|מה הסידור/;
const RE_TIMEOFF = /חופש|חופשה|מילואים|חולה|מחלה|אבל/;
const RE_SWAP = /החלפה|להחליף|תחליף|מחליף/;

/** Returns a reply string if the text is a recognised self-service command, else null. */
export async function handleWaCommand(employeeId: string, text: string): Promise<string | null> {
  const t = text.trim();
  if (RE_SHIFTS.test(t)) return myShiftsReply(employeeId);
  if (RE_TIMEOFF.test(t)) return timeOffReply(employeeId, t);
  if (RE_SWAP.test(t)) return 'קיבלנו שברצונך להחליף משמרת 🙏 אפשר לפרט איזו — והמנהל יטפל בבקשה.';
  return null;
}

async function myShiftsReply(employeeId: string): Promise<string | null> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { orgId: true, name: true } });
  if (!emp) return null;
  const cycle = await getCurrentCycle(emp.orgId).catch(() => null);
  if (!cycle) return 'אין כרגע סידור פעיל.';
  if (cycle.status !== 'published') return 'הסידור לשבוע עדיין לא פורסם. ברגע שיפורסם תקבל/י אותו כאן אוטומטית 🙌';
  const asg = await prisma.assignment.findMany({
    where: { cycleId: cycle.id, employeeId, status: 'published' },
    include: { shift: true },
    orderBy: [{ shift: { dayIndex: 'asc' } }, { startTime: 'asc' }],
  });
  if (!asg.length) return 'אין לך משמרות בסידור שפורסם לשבוע זה.';
  const lines = asg.map((a) => `• יום ${DAY[a.shift.dayIndex]} — ${a.shift.label} ${a.startTime}–${a.endTime ?? a.shift.endTime}`);
  return `המשמרות שלך לשבוע:\n${lines.join('\n')}`;
}

async function timeOffReply(employeeId: string, text: string): Promise<string | null> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { orgId: true } });
  if (!emp) return null;
  const type = /מילואים/.test(text) ? 'reserve' : /חולה|מחלה/.test(text) ? 'sick' : 'vacation';
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  // dates are a placeholder — the manager sets the exact range on approval.
  await prisma.timeOffRequest.create({
    data: { orgId: emp.orgId, employeeId, type, startDate: today, endDate: today, status: 'pending', source: 'whatsapp', note: text.slice(0, 300) },
  });
  const label = type === 'reserve' ? 'מילואים' : type === 'sick' ? 'מחלה' : 'חופשה';
  return `קיבלנו את בקשת ה${label} שלך 🙏 היא ממתינה לאישור המנהל, שיעדכן את התאריכים המדויקים.`;
}
