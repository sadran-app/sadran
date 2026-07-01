// Creates ONLY the platform admin (from env vars) — for production, where you
// don't want the demo restaurant. Run once after the first deploy:
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run bootstrap:admin

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? 'מנהל-על';
  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables.');
    process.exit(1);
  }
  const existing = await prisma.manager.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin already exists: ${email}`);
    return;
  }
  await prisma.manager.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 10), isAdmin: true },
  });
  console.log(`Created platform admin: ${email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
