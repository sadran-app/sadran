# סַדְרָן — Sadran

פלטפורמת ניהול סידור משמרות. **Milestone 1**: ליבת התכנון + מנוע החלפות, ממשק מנהל RTL, ו-MockChannel (Wizard-of-Oz).

## מבנה

```
prisma/    schema + seed (מסעדה עם ~20 עובדים, פערי סופ״ש מכוונים)
engine/    מנוע התכנון — pure TS, unit-tested (@engine)
channel/   ChannelAdapter + MockChannel + WhatsAppCloud stub (@channel)
server/    Fastify API
web/        React + Vite + Tailwind (RTL)
```

## הרצה מקומית (PostgreSQL)

צריך `DATABASE_URL` של Postgres. הכי מהיר — DB חינמי מנוהל (Neon / Supabase), או Postgres מקומי דרך Docker:

```bash
docker compose up -d        # מריץ Postgres מקומי (תואם ל-DATABASE_URL שב-.env)
```

ואז:
```bash
cp .env.example .env        # מלא DATABASE_URL, JWT_SECRET
npm run setup               # install + generate + migrate + seed (מסעדת דמו)
npm run dev                 # server :3001 + web :5173
```

בנפרד:
```bash
npm run db:reset            # מוחק, מריץ migrations, וזורע מחדש
npm test                    # unit tests למנוע
```

## פריסה לענן (שירות יחיד)

בפרודקשן השרת מגיש **גם את ה-API וגם את ה-web** מאותו origin — פריסה של שירות אחד. עובד ישירות על Render / Railway / Fly / כל מארח שתומך ב-Docker או Node.

**משתני סביבה נדרשים:** `DATABASE_URL` (Postgres), `JWT_SECRET` (מחרוזת אקראית ארוכה), `NODE_ENV=production`, `PORT` (רוב המארחים מזריקים אוטומטית).

**Build:** `npm run build`  ·  **Start:** `npm start` (מריץ `prisma migrate deploy` ואז את השרת).

או עם Docker:
```bash
docker build -t sadran .
docker run -e DATABASE_URL=... -e JWT_SECRET=... -p 3001:3001 sadran
```

**אחרי הפריסה הראשונה** — צור את חשבון מנהל-העל (בלי נתוני דמו):
```bash
ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=... npm run bootstrap:admin
```

## התחברות (רב-דיירות)
כל מנהל מתחבר לחשבון ייעודי ורואה **רק את המסעדה שלו**. חשבון דמו:
```
manager@hanamal.co.il / demo1234
```
כל בקשת API מוגנת ב-JWT ומשויכת לארגון של המנהל.

## הזרימה
1. **הגדרות** — חוקי עבודה + **עורך משמרות גמיש לכל יום**: מגדירים לכל יום בנפרד משמרות (מקטעים) עם שעות משלהן, ובתוך כל משמרת כמה עובדים מכל תפקיד ומאיזו שעה (למשל ראשון: 06:00 טבח×2, 07:00 מלצר×3, 10:00 מלצר×2; וב-16:00 משמרת ערב נפרדת).
2. **עובדים** — הוספת עובד (שם/טלפון/תאריך לידה/שכר/תפקידים) → צירוף אוטומטי לוואטסאפ (הודעת פתיחה + בקשת זמינות ל-Outbox); עריכת זמינות (ok/prefer/cant) ו-min/max; קטין מזוהה אוטומטית מגיל.
3. **דוחות** — לוח מחוונים למנהל: משמרות, שעות, **עלות שכר**, כיסוי, סופ״ש/סגירות, החלפות (הפיל/כיסה), קטינים, חוסרים — מצטבר לאורך כל השבועות.
4. **סידור** — "צור סידור" → גריד wave-based, פערים מודגשים, עריכה ידנית, "פרסם".
5. **החלפות** — "נפל ממשמרת" (↔ על תא) → שידור לזכאים → claim → אישור מנהל → reassign + fairness + notify.

כל התקשורת עוברת דרך `MockChannel` שכותב ל-`OutboxMessage` (נראה במסך החלפות) ולקונסול.

## החלפה ל-OR-Tools / WhatsApp אמיתי
- המנוע מאחורי `generateSchedule(input)` — אותו חוזה, אפשר להחליף מימוש בלי לגעת ב-callers.
- הערוץ נבחר במקום אחד: `server/src/channel.ts`. החלף `MockChannel` ב-`WhatsAppCloudChannel`.
