import { MockChannel, WhatsAppCloudChannel } from '@channel';
import { prisma } from './db';

// Channel is chosen by env vars — this is the ONLY place it's decided.
// With WhatsApp creds set (locally, for testing) → real WhatsApp.
// Without them (e.g. production on Render) → the safe Mock/Outbox channel.
const token = process.env.WHATSAPP_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

export const channel =
  token && phoneNumberId
    ? new WhatsAppCloudChannel(prisma, { token, phoneNumberId, testRecipient: process.env.WHATSAPP_TEST_RECIPIENT })
    : new MockChannel(prisma);

console.log(`[channel] ${token && phoneNumberId ? 'WhatsApp Cloud API' : 'Mock (Outbox)'}`);
