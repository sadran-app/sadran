// MockChannel — Wizard-of-Oz. Every "message" is printed to the console AND
// persisted to OutboxMessage so the manager UI can show what would be sent.
// Swap the whole class for WhatsAppCloudChannel later without touching callers.

import type { PrismaClient } from '@prisma/client';
import {
  type ChannelAdapter,
  type ChannelAssignment,
  type ChannelEmployee,
  type ChannelShift,
  dayName,
} from './ChannelAdapter';

export class MockChannel implements ChannelAdapter {
  constructor(private prisma: PrismaClient) {}

  private async emit(employeeId: string, kind: string, body: string): Promise<void> {
    console.log(`\n[MockChannel → ${employeeId}] (${kind})\n${body}\n`);
    await this.prisma.outboxMessage.create({ data: { employeeId, kind, body } });
  }

  async sendAvailabilityRequest(employee: ChannelEmployee, cycleId: string): Promise<void> {
    await this.emit(
      employee.id,
      'availability_request',
      `היי ${employee.name}, נא לשלוח זמינות למחזור ${cycleId}. ענה/י עם הימים והבלוקים שבהם את/ה יכול/ה.`,
    );
  }

  async sendSchedule(employee: ChannelEmployee, assignments: ChannelAssignment[]): Promise<void> {
    const lines = assignments.length
      ? assignments
          .slice()
          .sort((a, b) => a.dayIndex - b.dayIndex || a.waveTime.localeCompare(b.waveTime))
          .map((a) => `• יום ${dayName(a.dayIndex)} — ${a.blockLabel} ${a.waveTime} (${a.roleName})`)
          .join('\n')
      : 'אין לך משמרות במחזור הזה.';
    await this.emit(employee.id, 'schedule', `הסידור שלך, ${employee.name}:\n${lines}`);
  }

  async broadcastOpenShift(eligible: ChannelEmployee[], shift: ChannelShift): Promise<void> {
    const body = `משמרת פנויה: יום ${dayName(shift.dayIndex)} — ${shift.blockLabel} ${shift.waveTime} (${shift.roleName}). מי שרוצה לקחת — הגיב/י "אני".`;
    for (const e of eligible) {
      await this.emit(e.id, 'open_shift', `היי ${e.name}, ${body}`);
    }
  }

  async notify(employee: ChannelEmployee, message: string): Promise<void> {
    await this.emit(employee.id, 'notify', message);
  }
}
