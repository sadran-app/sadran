// One-off: create an isolated dev database on the SAME Neon server, so local
// development never touches production (neondb). Safe to re-run.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
try {
  await prisma.$executeRawUnsafe('CREATE DATABASE sadran_dev');
  console.log('OK: created sadran_dev');
} catch (e) {
  console.log('NOTE:', e.message.split('\n')[0]);
} finally {
  await prisma.$disconnect();
}
