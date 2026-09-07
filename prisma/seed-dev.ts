// Dev seed for the isolated sadran_dev database: the platform super-admin
// (username/password login) + a demo business so the admin panel isn't empty.
import bcrypt from 'bcryptjs';
import { prisma } from '../server/src/db';
import { encryptSecret } from '../server/src/crypto';
import { createOrganization } from '../server/src/services/onboarding';

async function main() {
  const ADMIN_USER = 'ShlomiH';
  const ADMIN_PASS = 'Shlomi1998!';

  const existingAdmin = await prisma.manager.findFirst({ where: { username: ADMIN_USER } });
  if (!existingAdmin) {
    await prisma.manager.create({
      data: { username: ADMIN_USER, name: 'שלומי', isAdmin: true, orgId: null, passwordHash: await bcrypt.hash(ADMIN_PASS, 10) },
    });
    console.log('✓ super-admin created:', ADMIN_USER);
  } else {
    // keep password in sync during dev
    await prisma.manager.update({ where: { id: existingAdmin.id }, data: { passwordHash: await bcrypt.hash(ADMIN_PASS, 10), isAdmin: true } });
    console.log('✓ super-admin exists (password synced):', ADMIN_USER);
  }

  if (!(await prisma.manager.findFirst({ where: { username: 'hanamal' } }))) {
    await createOrganization({
      businessName: 'מסעדת הנמל',
      managerName: 'דנה',
      username: 'hanamal',
      passwordHash: await bcrypt.hash('demo1234', 10),
      passwordEnc: encryptSecret('demo1234'),
      planName: 'בסיסי',
      employeeQuota: 20,
      monthlyPrice: 149,
      subscriptionMonths: 12,
      whatsappEnabled: true,
      waSenderName: 'מסעדת הנמל',
      waPhoneDisplay: '+972 55-000-0000',
    });
    console.log('✓ demo business created: hanamal / demo1234');
  } else {
    console.log('✓ demo business exists: hanamal');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
