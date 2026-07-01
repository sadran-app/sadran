import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export interface LaborRules {
  minRestHours: number;
  maxWeeklyHours: number;
  maxDailyHours: number;
  minorCurfewHour: number;
  closingHour: number; // shifts ending at/after this hour count as "closing"
}

export function parseLaborRules(json: string): LaborRules {
  const r = JSON.parse(json) as Partial<LaborRules>;
  return {
    minRestHours: r.minRestHours ?? 8,
    maxWeeklyHours: r.maxWeeklyHours ?? 45,
    maxDailyHours: r.maxDailyHours ?? 12,
    minorCurfewHour: r.minorCurfewHour ?? 22,
    closingHour: r.closingHour ?? 21,
  };
}

/** The organization the current request is scoped to (multi-tenant). */
export async function getOrgById(orgId: string) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new Error('Organization not found.');
  return org;
}

/** The current working cycle: most recent by weekStartDate. */
export async function getCurrentCycle(orgId: string) {
  const cycle = await prisma.weekCycle.findFirst({
    where: { orgId },
    orderBy: { weekStartDate: 'desc' },
  });
  if (!cycle) throw new Error('No week cycle seeded.');
  return cycle;
}

/** Tenant guards: confirm a record belongs to the requesting org before mutating. */
export async function assignmentInOrg(orgId: string, assignmentId: string) {
  const a = await prisma.assignment.findUnique({ where: { id: assignmentId }, include: { cycle: true } });
  return a && a.cycle.orgId === orgId ? a : null;
}
export async function swapInOrg(orgId: string, swapId: string) {
  const s = await prisma.swapRequest.findUnique({ where: { id: swapId }, include: { cycle: true } });
  return s && s.cycle.orgId === orgId ? s : null;
}
