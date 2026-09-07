// Auto-generated login credentials for a new business, plus the WhatsApp messages
// that deliver them to the manager. The admin no longer types a username/password.
import crypto from 'node:crypto';
import { prisma } from '../db';

// 8 chars, lowercase letters + digits, guaranteed to contain at least one of each.
export function generatePassword(): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const all = lower + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)]!;
  const chars = [pick(lower), pick(digits)];
  for (let i = 0; i < 6; i++) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { // Fisher–Yates shuffle
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

// Username = the manager's name. If taken, append a sensible numeric suffix until free.
export async function generateUsername(name: string): Promise<string> {
  let base = name.trim().replace(/\s+/g, ' ').slice(0, 36);
  if (base.length < 3) base = (base + '111').slice(0, 3);
  const free = async (u: string) => !(await prisma.manager.findFirst({ where: { username: u }, select: { id: true } }));
  if (await free(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const cand = `${base}${i}`.slice(0, 40);
    if (await free(cand)) return cand;
  }
  return `${base}${crypto.randomInt(100000)}`.slice(0, 40);
}

const APP_URL = process.env.APP_URL || '';

// Full onboarding message: what the system does + the (bold) credentials.
export function welcomeMessage(managerName: string, businessName: string, username: string, password: string): string {
  return [
    `היי ${managerName}! 👋`,
    `ברוך/ה הבא/ה לסַדְרָן — מערכת שיבוץ המשמרות החכמה ל${businessName}.`,
    ``,
    `מה המערכת עושה בשבילך:`,
    `🗓️ בונה סידור עבודה שבועי אוטומטי בלחיצה אחת`,
    `💬 אוספת זמינות מהעובדים ישירות בוואטסאפ — בלי אפליקציה`,
    `⚖️ מאזנת עומס בהוגנות ושומרת על חוקי העבודה אוטומטית`,
    `🕐 תומכת בשעות חופשי ושיבוץ חלקי בין עובדים`,
    `🔁 מנהלת החלפות משמרת · 📊 דוחות עלות, שעות ותובנות`,
    `📈 חיזוי ביקוש והמלצות איוש חכמות`,
    ``,
    `פרטי הכניסה שלך (שמור/י אותם):`,
    `שם משתמש: *${username}*`,
    `סיסמה: *${password}*`,
    ...(APP_URL ? [``, `כניסה: ${APP_URL}`] : []),
    `אפשר לשנות את הסיסמה בכל עת ממסך ההתחברות.`,
  ].join('\n');
}

// Sent after a self-service password change from the login screen.
export function passwordChangedMessage(managerName: string, username: string, password: string): string {
  return [
    `🔐 היי ${managerName}, הסיסמה שלך בסַדְרָן עודכנה.`,
    ``,
    `שם משתמש: *${username}*`,
    `סיסמה חדשה: *${password}*`,
    ``,
    `אם לא ביקשת את השינוי הזה — פנה/י אלינו מיד.`,
  ].join('\n');
}
