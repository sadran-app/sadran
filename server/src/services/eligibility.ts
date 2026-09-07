// Human-readable eligibility: translates engine Violation codes into Hebrew
// explanations, and produces a per-employee candidate list for a slot so the
// manager sees exactly who can be assigned — and why the rest can't.

import { checkEligibility, type AvailabilityState, type Slot, type Violation } from '@engine';
import { prisma, parseLaborRules, getOrgById } from '../db';

const HEB_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function violationText(v: Violation): string {
  const where = v.conflictDayIndex !== undefined ? ` (יום ${HEB_DAYS[v.conflictDayIndex]} ${v.conflictStart ?? ''})` : '';
  switch (v.code) {
    case 'role': return 'אין לעובד את התפקיד הנדרש';
    case 'availability': return 'העובד סימן שאינו זמין למשמרת זו';
    case 'max_shifts': return 'העובד הגיע למקסימום המשמרות השבועי שלו';
    case 'same_shift': return 'העובד כבר משובץ למשמרת הזו';
    case 'overlap': return `העובד כבר משובץ למשמרת חופפת${where}`;
    case 'rest': return `אין מספיק שעות מנוחה סביב משמרת${where}`;
    case 'curfew': return 'קטין — המשמרת מסתיימת אחרי שעת העוצר';
    case 'max_daily_hours': return 'חריגה ממקסימום שעות העבודה ליום';
    case 'max_weekly_hours': return 'חריגה ממקסימום שעות העבודה לשבוע';
    case 'level': return 'דרושה רמת בכירות גבוהה יותר למשמרת זו';
    case 'max_consecutive': return 'חריגה ממקסימום ימי העבודה הרצופים של העובד';
    case 'time_off': return 'לעובד חופשה/מילואים מאושרים ביום זה';
    default: return 'לא ניתן לשבץ';
  }
}

/** Like violationText, but distinguishes "no availability received" from an explicit "cant". */
function reasonText(v: Violation, unknown: boolean): string {
  if (v.code === 'availability' && unknown) return 'טרם התקבלה זמינות מהעובד לשבוע';
  return violationText(v);
}

type CurrentAssignment = { employeeId: string; shiftId: string; slotId: string; roleId: string; dayIndex: number; startTime: string; endTime: string };

interface EligCtx {
  availByEmp: Map<string, Map<string, AvailabilityState>>;
  rules: ReturnType<typeof parseLaborRules>;
  assignmentsByEmp: Map<string, CurrentAssignment[]>;
  hasInfo: (empId: string) => boolean; // did we receive availability for this employee?
}

async function loadCtx(orgId: string, cycleId: string): Promise<EligCtx> {
  const org = await getOrgById(orgId);
  const [availability, dayAvail, assignmentsRaw] = await Promise.all([
    prisma.availability.findMany({ where: { cycleId } }),
    prisma.dayAvailability.findMany({ where: { cycleId } }),
    prisma.assignment.findMany({ where: { cycleId }, include: { shift: true } }),
  ]);
  const availByEmp = new Map<string, Map<string, AvailabilityState>>();
  for (const a of availability) {
    let m = availByEmp.get(a.employeeId);
    if (!m) availByEmp.set(a.employeeId, (m = new Map()));
    m.set(a.shiftId, a.state as AvailabilityState);
  }
  const withInfo = new Set<string>();
  for (const a of availability) withInfo.add(a.employeeId);
  for (const a of dayAvail) withInfo.add(a.employeeId);
  const assignmentsByEmp = new Map<string, CurrentAssignment[]>();
  for (const a of assignmentsRaw) {
    const list = assignmentsByEmp.get(a.employeeId) ?? [];
    list.push({ employeeId: a.employeeId, shiftId: a.shiftId, slotId: a.slotId, roleId: a.roleId, dayIndex: a.shift.dayIndex, startTime: a.startTime, endTime: a.shift.endTime });
    assignmentsByEmp.set(a.employeeId, list);
  }
  return { availByEmp, rules: parseLaborRules(org.laborRules), assignmentsByEmp, hasInfo: (id) => withInfo.has(id) };
}

/** Detailed check for one employee against one slot. */
// relaxPreferences: ignore availability + max-shift blocks (used by "copy previous week",
// where the new week's availability isn't collected yet) — labour LAWS still block.
const RELAXABLE = new Set(['availability', 'max_shifts']);
export async function checkSlot(orgId: string, cycleId: string, employeeId: string, slot: Slot, relaxPreferences = false) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, include: { roles: true } });
  if (!emp || emp.orgId !== orgId) return { ok: false, reasons: ['עובד לא נמצא'] };
  const ctx = await loadCtx(orgId, cycleId);
  const unknown = !ctx.hasInfo(emp.id);
  const engineEmp = { id: emp.id, name: emp.name, roleIds: emp.roles.map((r) => r.roleId), roleLevels: Object.fromEntries(emp.roles.map((r) => [r.roleId, r.level])), maxConsecutiveDays: emp.maxConsecutiveDays, minShifts: emp.minShifts, maxShifts: emp.maxShifts, isMinor: emp.isMinor, fairnessCredit: emp.fairnessCredit, availabilityUnknown: unknown };
  const res = checkEligibility(engineEmp, slot, ctx.assignmentsByEmp.get(emp.id) ?? [], { availByEmp: ctx.availByEmp, rules: ctx.rules });
  const blocking = relaxPreferences ? res.violations.filter((v) => !RELAXABLE.has(v.code)) : res.violations;
  return { ok: blocking.length === 0, reasons: blocking.map((v) => reasonText(v, unknown)) };
}

/** Every role-matching employee for a slot, each with ok + reasons. Eligible first. */
export async function candidatesForSlot(orgId: string, cycleId: string, slot: Slot) {
  const ctx = await loadCtx(orgId, cycleId);
  const employees = await prisma.employee.findMany({ where: { orgId, active: true }, include: { roles: true } });

  const rows = employees
    .filter((e) => e.roles.some((r) => r.roleId === slot.roleId))
    .map((e) => {
      const unknown = !ctx.hasInfo(e.id);
      const engineEmp = { id: e.id, name: e.name, roleIds: e.roles.map((r) => r.roleId), roleLevels: Object.fromEntries(e.roles.map((r) => [r.roleId, r.level])), maxConsecutiveDays: e.maxConsecutiveDays, minShifts: e.minShifts, maxShifts: e.maxShifts, isMinor: e.isMinor, fairnessCredit: e.fairnessCredit, availabilityUnknown: unknown };
      const res = checkEligibility(engineEmp, slot, ctx.assignmentsByEmp.get(e.id) ?? [], { availByEmp: ctx.availByEmp, rules: ctx.rules });
      return { id: e.id, name: e.name, isMinor: e.isMinor, ok: res.ok, reasons: res.violations.map((v) => reasonText(v, unknown)) };
    });

  rows.sort((a, b) => Number(b.ok) - Number(a.ok) || a.name.localeCompare(b.name));
  return rows;
}
