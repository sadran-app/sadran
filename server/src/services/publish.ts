// Publish the proposed schedule: lock it, then push each employee their shifts
// through the channel (MockChannel writes to the Outbox + console).

import { prisma } from '../db';
import { channel } from '../channel';

export async function publishCycle(cycleId: string) {
  await prisma.$transaction([
    prisma.assignment.updateMany({ where: { cycleId, status: 'proposed' }, data: { status: 'published' } }),
    prisma.weekCycle.update({ where: { id: cycleId }, data: { status: 'published' } }),
  ]);

  const assignments = await prisma.assignment.findMany({
    where: { cycleId, status: 'published' },
    include: { employee: true, shift: true, role: true },
  });

  const byEmployee = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = byEmployee.get(a.employeeId) ?? [];
    list.push(a);
    byEmployee.set(a.employeeId, list);
  }

  let sent = 0;
  for (const [, list] of byEmployee) {
    const emp = list[0]!.employee;
    await channel.sendSchedule(
      { id: emp.id, name: emp.name, phone: emp.phone },
      list.map((a) => ({
        dayIndex: a.shift.dayIndex,
        blockLabel: a.shift.label,
        waveTime: a.startTime,
        roleName: a.role.name,
      })),
    );
    sent++;
  }

  return { published: assignments.length, notified: sent };
}
