# APS Platform

Multi-engagement web platform replacing Deloitte's APS v5.0 Excel application-rationalization tool
(`excelapp.xlsm`). The methodology — weighted IT/Business scoring, 4R dispositions, capability heat maps,
TCO analysis — is replicated exactly from the verified workbook extraction; the delivery experience is
rebuilt around guided surveys, live dashboards, and client-ready exports.

**Read first:** [APP-SPEC.md](APP-SPEC.md) (requirements contract) ·
[CLAUDE.md](CLAUDE.md) (build brief + golden tests) ·
[workbook-logic-inventory.md](workbook-logic-inventory.md) (verified source of truth for all formulas).

## Status

Phases 1–2 of 5 (foundation + methodology core) are built. Golden tests 1–27 pass (`npm test`).
Phases 3–5 (survey forms, dashboards/heat map, import/export) are next.

## Stack

Next.js (App Router, TS) · Clerk Organizations (org = engagement) · PostgreSQL + Prisma 7 ·
Tailwind v4 + shadcn/ui · vitest. Scoring/disposition/filter/heat-map engines are pure TypeScript in
`src/lib/methodology` (ESLint-enforced purity).

## Local development

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL; set ALLOW_DEV_AUTH=true for keyless dev
npx prisma migrate dev      # creates schema (needs DATABASE_URL as the DB owner role)
npm run db:harden           # RLS policies, aps_runtime role, append-only audit (idempotent — rerun after new migrations)
npm run db:seed             # global question bank (safe reference data)
npm run db:seed-dev         # dev identities + sample engagement (refuses to run outside local dev)
npm run dev
```

- **Without Clerk keys** the app runs in dev-auth mode (cookie user switcher over seeded roles) — only when
  `NODE_ENV=development`, `ALLOW_DEV_AUTH=true`, and not on Vercel/CI. A deployed environment without Clerk
  keys refuses to start.
- **With Clerk keys**: create the org roles `org:lead`, `org:consultant`, `org:client_respondent`,
  `org:client_viewer` in the Clerk Dashboard, and point a webhook (organizationMembership.*) at
  `/api/webhooks/clerk` with `CLERK_WEBHOOK_SIGNING_SECRET` set. Platform admins carry
  `publicMetadata.platformAdmin: true`.
- **Production database**: the app's `DATABASE_URL` must use the restricted `aps_runtime` role created by
  `db:harden` (row-level security applies; audit log is append-only). Migrations/seeds run as the owner role.
  On Vercel, scope env vars to Production AND Preview deliberately — Preview without keys will not boot.

## Deploying (Vercel)

1. Push to GitHub and import the repo in Vercel (framework: Next.js, no special config).
2. Environment variables (Production AND Preview — a deployed env without Clerk keys refuses to boot):
   `DATABASE_URL` (the `aps_runtime` role, `sslmode=require`), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`.
3. In Clerk: switch to a production instance for the real domain, re-create the org roles, and point a
   webhook (organizationMembership.*) at `https://<domain>/api/webhooks/clerk`.
4. Run migrations from a trusted machine: `npx prisma migrate deploy && npm run db:harden` (owner role).

## Tests

```bash
npm test          # pure golden tests (methodology 1–25, tenancy 26 matrix, auth-mode 27, seams)
DATABASE_URL=... npm test   # additionally runs the DB integration tests (override persistence, RLS)
```

## Tenancy model (do not weaken)

- Every domain row carries `engagementId`; composite `(id, engagementId)` FKs make cross-engagement
  references unwritable at the database.
- All data access goes through `getScopedDb(ctx)` obtained from `requireEngagementContext(...)` — call it in
  **every** page, server action, and route handler. Raw SQL is blocked on the scoped client; the one
  sanctioned raw statement lives in `src/lib/db/admin.ts`.
- Postgres RLS (via `db:harden`) is the backstop; the ESLint config bans the raw client and raw SQL outside
  `src/lib/db/**`.
