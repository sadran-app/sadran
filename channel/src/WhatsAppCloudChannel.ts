// STUB ONLY — do not implement the WhatsApp Cloud API yet.
// The interface is here so the wiring exists; every method is a no-op TODO.

import type {
  ChannelAdapter,
  ChannelAssignment,
  ChannelEmployee,
  ChannelShift,
} from './ChannelAdapter';

export interface WhatsAppCloudConfig {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
}

export class WhatsAppCloudChannel implements ChannelAdapter {
  constructor(private config: WhatsAppCloudConfig) {}

  async sendAvailabilityRequest(_employee: ChannelEmployee, _cycleId: string): Promise<void> {
    // TODO: POST /{phoneNumberId}/messages with an availability template.
    throw new Error('WhatsAppCloudChannel not implemented — use MockChannel for the MVP.');
  }

  async sendSchedule(_employee: ChannelEmployee, _assignments: ChannelAssignment[]): Promise<void> {
    // TODO: send the published schedule as a formatted message / template.
    throw new Error('WhatsAppCloudChannel not implemented — use MockChannel for the MVP.');
  }

  async broadcastOpenShift(_eligible: ChannelEmployee[], _shift: ChannelShift): Promise<void> {
    // TODO: fan out an interactive "claim shift" message to eligible employees.
    throw new Error('WhatsAppCloudChannel not implemented — use MockChannel for the MVP.');
  }

  async notify(_employee: ChannelEmployee, _message: string): Promise<void> {
    // TODO: freeform notification.
    throw new Error('WhatsAppCloudChannel not implemented — use MockChannel for the MVP.');
  }
}
