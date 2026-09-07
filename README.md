# Sadran

A shift-scheduling management platform. Milestone 1: scheduling core plus swap engine, an RTL manager interface, and a MockChannel (Wizard of Oz).

## Structure

```
prisma/    schema and seed (a restaurant with ~20 employees and intentional weekend gaps)
engine/    the scheduling engine, pure TS, unit-tested (@engine)
channel/   ChannelAdapter, MockChannel, and a WhatsAppCloud stub (@channel)
server/    Fastify API
web/       React, Vite, Tailwind (RTL)
```

## Local run (PostgreSQL)

You need a Postgres `DATABASE_URL`. Fastest is a free managed database (Neon or Supabase), or a local Postgres via Docker:

```bash
docker compose up -d        # runs a local Postgres matching DATABASE_URL in .env
```

Then:

```bash
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npm run setup               # install, generate, migrate, and seed the demo restaurant
npm run dev                 # server on 3001 and web on 5173
```

Separately:

```bash
npm run db:reset            # drops, re-runs migrations, and reseeds
npm test                    # engine unit tests
```

## Cloud deploy (single service)

In production the server serves both the API and the web app from the same origin, so it is a single-service deploy. It works directly on Render, Railway, Fly, or any host that supports Docker or Node.

Required environment variables: `DATABASE_URL` (Postgres), `JWT_SECRET` (a long random string), `NODE_ENV=production`, and `PORT` (most hosts inject this automatically).

Build: `npm run build`. Start: `npm start` (runs `prisma migrate deploy` and then the server).

Or with Docker:

```bash
docker build -t sadran .
docker run -e DATABASE_URL=... -e JWT_SECRET=... -p 3001:3001 sadran
```

After the first deploy, create the super-admin account (no demo data):

```bash
ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=... npm run bootstrap:admin
```

## Login (multi-tenant)

Each manager logs into a dedicated account and sees only their own restaurant. Demo account:

```
manager@hanamal.co.il / demo1234
```

Every API request is protected by JWT and scoped to the manager's organization.

## The flow

1. Settings: labor rules plus a flexible per-day shift editor. For each day you define shifts (segments) with their own hours, and inside each shift how many employees of each role and from what time (for example Sunday: 06:00 cook x2, 07:00 waiter x3, 10:00 waiter x2, and a separate 16:00 evening shift).
2. Employees: add an employee (name, phone, birth date, pay, roles), which auto-enrolls them to WhatsApp (a welcome message plus an availability request to the Outbox). Edit availability (ok, prefer, cant) and min/max. A minor is detected automatically from age.
3. Reports: a manager dashboard with shifts, hours, labor cost, coverage, weekends and closings, swaps (dropped and covered), minors, and gaps, aggregated across all weeks.
4. Schedule: "Generate schedule" produces a wave-based grid with highlighted gaps, manual editing, and "Publish".
5. Swaps: "drop a shift" broadcasts to eligible employees, then claim, then manager approval, then reassign plus fairness plus notify.

All communication goes through `MockChannel`, which writes to `OutboxMessage` (visible on the swaps screen) and to the console.

## Swapping in OR-Tools or real WhatsApp

- The engine sits behind `generateSchedule(input)`. Same contract, so you can swap the implementation without touching callers.
- The channel is chosen in one place: `server/src/channel.ts`. Replace `MockChannel` with `WhatsAppCloudChannel`.
