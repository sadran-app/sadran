// Temporary local test: sends real Sadran messages via the app's channel
// (WhatsAppCloudChannel, since .env has WhatsApp creds). All redirected to
// WHATSAPP_TEST_RECIPIENT. Delete after testing.
import { channel } from '../server/src/channel';
import { prisma } from '../server/src/db';

async function main() {
  const emp = await prisma.employee.findFirst({ where: { active: true } });
  if (!emp) throw new Error('no employee found');
  const e = { id: emp.id, name: emp.name, phone: emp.phone };
  console.log('sending Sadran messages as employee:', emp.name);

  await channel.sendAvailabilityRequest(e, 'שבוע קרוב');
  await channel.sendSchedule(e, [
    { dayIndex: 0, blockLabel: 'בוקר', waveTime: '07:00', roleName: 'מלצר' },
    { dayIndex: 3, blockLabel: 'ערב', waveTime: '18:00', roleName: 'ברמן' },
    { dayIndex: 5, blockLabel: 'ערב', waveTime: '16:45', roleName: 'אחראי משמרת' },
  ]);

  console.log('done — sent 2 app messages (availability request + schedule)');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
