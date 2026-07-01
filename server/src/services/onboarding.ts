// Onboarding: each business (or each branch of a chain) gets its OWN
// organization + manager login. Creates a ready-to-use org seeded with sensible
// defaults so the manager can start defining shifts immediately.

import { prisma } from '../db';

const DEFAULT_LABOR_RULES = { minRestHours: 8, maxWeeklyHours: 45, maxDailyHours: 12, minorCurfewHour: 22, closingHour: 21 };
const DEFAULT_ROLES = ['מלצר', 'טבח', 'ברמן', 'אחראי משמרת'];

function thisSunday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

export async function createOrganization(businessName: string, managerName: string, email: string, passwordHash: string) {
  const org = await prisma.organization.create({
    data: { name: businessName, laborRules: JSON.stringify(DEFAULT_LABOR_RULES) },
  });

  await prisma.role.createMany({ data: DEFAULT_ROLES.map((name) => ({ orgId: org.id, name })) });

  // a light default shift skeleton (morning + evening each day, no requirements
  // yet) so the schedule grid has structure the manager can fill in
  for (let day = 0; day < 7; day++) {
    await prisma.shift.create({ data: { orgId: org.id, dayIndex: day, label: 'בוקר', startTime: '08:00', endTime: '16:00', order: 0, colorTier: 0 } });
    await prisma.shift.create({ data: { orgId: org.id, dayIndex: day, label: 'ערב', startTime: '16:00', endTime: '23:00', order: 1, colorTier: 1 } });
  }

  await prisma.weekCycle.create({ data: { orgId: org.id, weekStartDate: thisSunday(), status: 'collecting' } });

  const manager = await prisma.manager.create({ data: { orgId: org.id, name: managerName, email, passwordHash } });
  return { org, manager };
}
