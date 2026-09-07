// Onboarding: each business (or each branch of a chain) gets its OWN
// organization + manager login (username/password). Creates a ready-to-use org
// seeded with sensible defaults so the manager can start defining shifts.

import { prisma } from '../db';

const DEFAULT_LABOR_RULES = { minRestHours: 8, maxWeeklyHours: 45, maxDailyHours: 12, minorCurfewHour: 22, closingHour: 21 };
// Seed roles/shifts appropriate to the business type. All are fully editable by the manager;
// these are just sensible starting points so the scheduler isn't empty on day one.
const ROLES_BY_TYPE: Record<string, string[]> = {
  restaurant: ['מלצר', 'טבח', 'ברמן', 'אחראי משמרת'],
  eventHall: ['מלצר', 'טבח', 'ברמן', 'אחראי משמרת'],
  store: ['מוכרן', 'קופאי', 'אחראי משמרת', 'סדרן'],
};
const SHIFTS_BY_TYPE: Record<string, { morning: [string, string]; evening: [string, string] }> = {
  restaurant: { morning: ['08:00', '16:00'], evening: ['16:00', '23:00'] },
  eventHall: { morning: ['08:00', '16:00'], evening: ['16:00', '23:00'] },
  store: { morning: ['09:00', '15:00'], evening: ['15:00', '22:00'] }, // typical retail day
};

function thisSunday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return d;
}

export interface CreateBusinessInput {
  businessName: string;
  managerName: string;
  username: string;
  passwordHash: string;
  passwordEnc: string;
  planName?: string | null;
  employeeQuota?: number;
  whatsappEnabled?: boolean;
  waMonthlyBudget?: number;
  monthlyPrice?: number;
  subscriptionMonths?: number; // 0/undefined => open-ended
  waPhoneNumberId?: string | null;
  waPhoneDisplay?: string | null;
  waSenderName?: string | null;
  waProfilePicUrl?: string | null;
  parentId?: string | null;
  isChain?: boolean;
  businessType?: string; // 'restaurant' | 'eventHall' | 'store'
  seedDefaults?: boolean; // false for a chain HQ container (no scheduling of its own)
  managerPhone?: string | null; // manager's WhatsApp number (onboarding + alerts)
}

export async function createOrganization(input: CreateBusinessInput) {
  const start = new Date();
  const end = input.subscriptionMonths && input.subscriptionMonths > 0 ? addMonths(start, input.subscriptionMonths) : null;

  const org = await prisma.organization.create({
    data: {
      name: input.businessName,
      laborRules: JSON.stringify(DEFAULT_LABOR_RULES),
      planName: input.planName ?? null,
      employeeQuota: input.employeeQuota ?? 20,
      whatsappEnabled: input.whatsappEnabled ?? true,
      waMonthlyBudget: input.waMonthlyBudget ?? 1000,
      monthlyPrice: input.monthlyPrice ?? 0,
      subscriptionStart: start,
      subscriptionEnd: end,
      parentId: input.parentId ?? null,
      isChain: input.isChain ?? false,
      businessType: input.businessType ?? 'restaurant',
      waPhoneNumberId: input.waPhoneNumberId ?? null,
      waPhoneDisplay: input.waPhoneDisplay ?? null,
      waSenderName: input.waSenderName ?? null,
      waProfilePicUrl: input.waProfilePicUrl ?? null,
    },
  });

  if (input.seedDefaults !== false) {
    const bt = input.businessType ?? 'restaurant';
    const roles = ROLES_BY_TYPE[bt] ?? ROLES_BY_TYPE.restaurant!;
    const { morning, evening } = SHIFTS_BY_TYPE[bt] ?? SHIFTS_BY_TYPE.restaurant!;
    await prisma.role.createMany({ data: roles.map((name) => ({ orgId: org.id, name })) });
    await prisma.shift.createMany({
      data: Array.from({ length: 7 }, (_, day) => [
        { orgId: org.id, dayIndex: day, label: 'בוקר', startTime: morning[0], endTime: morning[1], order: 0, colorTier: 0 },
        { orgId: org.id, dayIndex: day, label: 'ערב', startTime: evening[0], endTime: evening[1], order: 1, colorTier: 1 },
      ]).flat(),
    });
    await prisma.weekCycle.create({ data: { orgId: org.id, weekStartDate: thisSunday(), status: 'collecting' } });
  }

  const manager = await prisma.manager.create({
    data: {
      orgId: org.id,
      name: input.managerName,
      username: input.username,
      passwordHash: input.passwordHash,
      passwordEnc: input.passwordEnc,
      phone: input.managerPhone ?? null,
    },
  });
  return { org, manager };
}
