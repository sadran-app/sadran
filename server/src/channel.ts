import { MockChannel } from '@channel';
import { prisma } from './db';

// The one place the channel is chosen. Swap MockChannel → WhatsAppCloudChannel
// here (and nowhere else) when the real integration is ready.
export const channel = new MockChannel(prisma);
