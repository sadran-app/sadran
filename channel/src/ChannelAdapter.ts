// The communication boundary. The engine and server never talk to WhatsApp
// directly — they talk to a ChannelAdapter. Today that's MockChannel
// (Wizard-of-Oz: writes to an Outbox the manager reads and forwards by hand).

export interface ChannelEmployee {
  id: string;
  name: string;
  phone: string;
}

export interface ChannelAssignment {
  dayIndex: number;
  blockLabel: string;
  waveTime: string;
  roleName: string;
}

export interface ChannelShift {
  dayIndex: number;
  blockLabel: string;
  waveTime: string;
  roleName: string;
}

export interface ChannelAdapter {
  sendAvailabilityRequest(employee: ChannelEmployee, cycleId: string): Promise<void>;
  sendSchedule(employee: ChannelEmployee, assignments: ChannelAssignment[]): Promise<void>;
  broadcastOpenShift(eligible: ChannelEmployee[], shift: ChannelShift): Promise<void>;
  notify(employee: ChannelEmployee, message: string): Promise<void>;
}

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const;

export function dayName(dayIndex: number): string {
  return DAY_NAMES[dayIndex] ?? `יום ${dayIndex}`;
}
