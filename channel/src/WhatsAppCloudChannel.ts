// Real WhatsApp Cloud API channel. Sends via Meta's Graph API and also records
// every message in OutboxMessage (so the manager UI + delivery failures stay
// visible). Selected only when WhatsApp env vars are present — otherwise the
// app falls back to MockChannel (see server/src/channel.ts), so production stays
// on the mock until you deliberately turn WhatsApp on.

import type { PrismaClient } from '@prisma/client';
import {
  type ChannelAdapter,
  type ChannelAssignment,
  type ChannelEmployee,
  type ChannelShift,
  dayName,
} from './ChannelAdapter';

export interface WhatsAppCloudConfig {
  token: string;
  phoneNumberId: string;
  apiVersion?: string;
  /** If set, EVERY message is redirected to this number (E.164, no '+') — for testing. */
  testRecipient?: string;
}

/** Normalize an Israeli/local phone to WhatsApp's E.164-digits form (e.g. 0501234567 → 972501234567). */
function toWaNumber(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d;
}

export class WhatsAppCloudChannel implements ChannelAdapter {
  constructor(
    private prisma: PrismaClient,
    private config: WhatsAppCloudConfig,
  ) {}

  private async sendText(employeeId: string, phone: string, kind: string, body: string): Promise<void> {
    const to = this.config.testRecipient || toWaNumber(phone);
    const version = this.config.apiVersion ?? 'v21.0';
    const url = `https://graph.facebook.com/${version}/${this.config.phoneNumberId}/messages`;

    let ok = false;
    let detail = '';
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
      });
      ok = res.ok;
      if (!ok) detail = (await res.text()).slice(0, 300);
      else console.log(`[WhatsApp → ${to}] ${kind} ✓`);
    } catch (e) {
      detail = (e as Error).message;
    }
    if (!ok) console.error(`[WhatsApp → ${to}] ${kind} FAILED: ${detail}`);

    await this.prisma.outboxMessage.create({
      data: { employeeId, channel: 'whatsapp', kind, body: ok ? body : `${body}\n— ${detail}`, failed: !ok },
    });
  }

  async sendAvailabilityRequest(employee: ChannelEmployee, cycleId: string): Promise<void> {
    await this.sendText(
      employee.id,
      employee.phone,
      'availability_request',
      `היי ${employee.name}, נא לשלוח את הימים שבהם תוכל/י לעבוד בשבוע הקרוב 🙏 (מחזור ${cycleId})`,
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
    await this.sendText(employee.id, employee.phone, 'schedule', `הסידור שלך, ${employee.name}:\n${lines}`);
  }

  async broadcastOpenShift(eligible: ChannelEmployee[], shift: ChannelShift): Promise<void> {
    const body = `משמרת פנויה: יום ${dayName(shift.dayIndex)} — ${shift.blockLabel} ${shift.waveTime} (${shift.roleName}). מי שרוצה לקחת — הגיב/י "אני".`;
    for (const e of eligible) {
      await this.sendText(e.id, e.phone, 'open_shift', `היי ${e.name}, ${body}`);
    }
  }

  async notify(employee: ChannelEmployee, message: string): Promise<void> {
    await this.sendText(employee.id, employee.phone, 'notify', message);
  }
}
