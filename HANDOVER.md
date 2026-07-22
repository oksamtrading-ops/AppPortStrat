# APS Platform — Session Handover

_Last updated: 2026-07-21. Hand this to a new session as context. It is self-contained; you should not need prior chat history._

---

## 1. What this is

**APS Platform (App Portfolio Strategy)** — a multi-tenant Next.js web app that replaces Deloitte's fragile 2016 Excel/VBA application-rationalization workbook (`excelapp.xlsm`). Consultants run client engagements: catalogue applications, score them via surveys (Business Value × IT Health), map them to a capability model, and produce 4R dispositions (Keep-As-Is / Re-Tool / Re-Design / Terminate), financials, and executive reports.

- **User:** Albert (albert.ahadjie@tomame.ca). GitHub/Clerk owner account: samowusuking@gmail.com / oksamtrading-ops.
- **Status:** ALL planned phases complete, deployed to production, in **pilot**. This is live software with real intent — verify before claiming done, don't break the security model.

## 2. Where everything lives

| Thing | Location |
|---|---|
| **Repo** | GitHub `oksamtrading-ops/AppPortStrat` (public), branch `main` |
| **Local checkout** | `/Users/oksam/Documents/Projects/Deloitte Projects/Application Rationalization/AppPortStrat` — **work here**, run git/npm from here |
| **Do NOT use** | the sibling `aps-platform/` folder (old scaffold with spec copies only) |
| **Source-of-truth docs** (committed) | `APP-SPEC.md` (requirements), `CLAUDE.md` (build brief + 26 golden tests), `workbook-logic-inventory.md` (verified Excel formulas/thresholds) |
| **Original workbook** | `../excelapp.xlsm` (one level up from the repo) — real client data, confidential |
| **Live app** | https://app-port-strat.vercel.app (Vercel, auto-deploys on push to `main`) |
| **Memory file** | `/Users/oksam/.claude/projects/-Users-oksam/memory/aps-platform-build-target.md` — the durable running log; update it when you finish notable work |

**Deploy identifiers:** Vercel team `team_Bf6xravg5ebaUSfxqa6bKBbN`, project `prj_qvX3HvEbdtQng77frnZoG49LS0rE` (`app-port-strat`). Vercel MCP tools (`list_deployments`, `get_deployment`, `get_deployment_build_logs`) are available for checking deploys.

## 3. Stack & infrastructure

- **Next.js 16** App Router (React 19, TypeScript strict, Tailwind v4, shadcn/ui). Middleware is `src/proxy.ts` (nonce CSP). Tenant routes are `export const dynamic = "force-dynamic"`.
- **Prisma 7** (`prisma-client` generator, output `src/generated/prisma` — **gitignored**, so the Vercel build must run `prisma generate`; it does, via `package.json` build = `prisma generate && next build`, pinned in `vercel.json` with `framework: nextjs`).
- **Postgres = Neon.** ⚠️ **Dev and prod share the SAME Neon database.** Prod's `DATABASE_URL` connects as a **non-owner `aps_runtime` role** (so Postgres RLS actually bites); dev uses the owner role. `pg` is an explicit dependency (`^8.22.0`); `src/lib/db/pg-config.ts` pins sslmode=verify-full + a SerializingClient (Prisma parallelizes queries on one tx connection).
- **Auth = Clerk** (Organizations; **org = engagement = tenant**). Currently a **dev instance** (`pk_test_…`, `accounts.dev`, ~100-user cap) — fine for pilot. Roles: `org:lead / org:consultant / org:client_respondent / org:client_viewer` → `ENGAGEMENT_LEAD / CONSULTANT / CLIENT_RESPONDENT / CLIENT_VIEWER`. Albert = platform admin (publicMetadata.platformAdmin).
- **AI = Anthropic SDK server-side.** Model `process.env.APS_AI_MODEL ?? "claude-sonnet-5"`. ⚠️ **Never set `temperature`** — it's deprecated on claude-sonnet-5 and 400s. Platform key `ANTHROPIC_API_KEY`; per-engagement opt-in via `Engagement.aiEnabled`.
- **Vercel env vars that must be set (Production):** `DATABASE_URL` (aps_runtime), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `ANTHROPIC_API_KEY`, and the four Clerk URL vars (`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in`, `SIGN_UP_URL=/sign-up`, `SIGN_IN_FALLBACK_REDIRECT_URL=/`, `SIGN_UP_FALLBACK_REDIRECT_URL=/`). **Never** set `ALLOW_DEV_AUTH` / `DEV_AUTH_SECRET` in a deployed env.

## 4. The security model (the crown jewels — understand before touching data access)

Independently security-audited this session; **no Critical/High findings**. Do not weaken these:

- **Scoped Prisma client `getScopedDb(ctx)`** (`src/lib/db/scoped.ts`) is the ONLY door to tenant data. It runs a pure argument guard `guardArgs` (`src/lib/db/guard.ts`): default-deny op allowlist, injects `engagementId`, rejects any foreign engagementId (incl. nested connect), role-aware scoping. Raw `$queryRaw`/`$executeRaw`/`$transaction` are stubbed to throw on the scoped client. Raw Prisma import is ESLint-fenced outside `src/lib/db/**`.
- **Row-level rules live in the guard as predicates**, not UI convention: `Notification` → own `recipientMembershipId` (every role); `Comment` → `internal:false` for `CLIENT_VIEWER`; `DENIED_MODELS` (Engagement, Bank*, CapabilityLibrary*, Tombstone); `VIEWER_DENIED_MODELS` = {`Task`, `AuditEvent`}. Include/select traversal into role-denied models is re-checked (`RELATION_MAP` + a schema-parsing **drift test** that fails if the map rots).
- **DB backstops:** every tenant model has composite `(id, engagementId)` FKs; Postgres **RLS** (`prisma/hardening.sql`) on all ~20 tenant tables (incl. Comment/Notification/Task/DispositionSignOff) with a boot assertion `aps_rls_inactive_reason()` that refuses to serve in prod if the connected role can bypass RLS. `AuditEvent` is append-only (DB REVOKE).
- **Admin door** (`src/lib/db/admin.ts`, `library.ts`, `provision.ts`) does sanctioned unscoped ops; it sets the RLS GUC (`set_config('app.engagement_id', …, TRUE)`) before RLS'd reads/writes.
- **Auth fail-closed:** dev-auth is impossible in a deployed env (triple gate + boot crash in `instrumentation.ts`). Clerk-mode role authority = live session claims, never the local Membership row. `src/lib/auth/` = {mode, access, context, session, roles, dev}.
- **Rate limiter** `rateLimit(key, limit, windowSeconds, now?, opts?)` in `admin.ts` — atomic; `opts = { failClosed?, cost? }`. AI paths fail **closed** + size-weighted; imports/config-recompute throttled.

## 5. CRITICAL operational gotchas (these WILL bite you)

- **Migrations — never `prisma migrate dev`.** The hardening composite FKs read as permanent drift, so `migrate dev` always demands a destructive reset. Instead: hand-write `prisma/migrations/<ts>_<name>/migration.sql`, run `npx prisma db execute --file <it>`, then `npx prisma migrate resolve --applied <name>`. **GOTCHA:** `db execute` can fail P1001 (Neon drop) AFTER `resolve` marks it applied → always verify with `to_regclass('public."Table"')` before proceeding. After adding a tenant table, add it to the **two arrays** in `prisma/hardening.sql` and re-run `npm run db:harden` (can transiently deadlock vs a running dev server — retry). **Because prod shares the Neon DB, apply migrations to Neon BEFORE pushing.**
- **Dev servers (`.claude/launch.json`):** `aps-platform` (:3000, Albert's Clerk instance) and `aps-devauth` (:3001, dev user-switcher for role testing). **Only ONE runs at a time.** Always `preview_stop` one before `preview_start` the other, and **always restore `aps-platform` when done.** The dev-auth session resets on server restart (re-navigate to establish the cookie). `rm -rf .next` cures Turbopack phantom compile errors.
- **Tests:** `set -a; source .env; set +a; npm test` — vitest does NOT auto-load `.env`, so DB-integration + `DEV_AUTH_SECRET` tests fail/skip without it. **158 tests currently green.** Golden methodology tests are the fidelity contract — don't loosen them.
- **server-only modules under tsx:** run scripts with `NODE_OPTIONS=--conditions=react-server`. Seeds/scripts must `$disconnect()` or tsx hangs.
- **Build is slow (~5–6 min) when a dev server is competing** for the machine; stop the preview server first for a fast (~4s) build.
- **Browser preview pane degrades** intermittently (blank screenshots, viewport 0×0). Fall back to `javascript_tool` DOM checks / `get_page_text`, and server-side verification via role-scoped clients.
- **Charts are hand-rolled SVG/CSS** (`src/components/dashboard/charts.tsx`) — Recharts was removed (ResponsiveContainer rendered empty). The 4R matrix (`src/components/apps/matrix-view.tsx`) is shared by dashboard + Applications page.
- Client-module exports become opaque refs in server components (e.g. `SIDEBAR_COOKIE` lives in its own plain module).

## 6. What shipped THIS session (newest first — all deployed)

| Commit | Summary |
|---|---|
| `b3a65b9` | **@mention autocomplete** in comment/reply boxes (dropdown of matching members; the piece that ensures the server's exact-name mention match fires). |
| `61de04d` | **Fixed org-invitation redirect** — `createOrganizationInvitation` now passes `redirectUrl = <origin>/sign-up` (was missing → invitees stranded on Clerk's hosted pages). |
| `4c165bf` | **Currency formatting** on the "Cost by disposition" donut legend + tooltips (added `formatValue` prop; count donut unchanged). |
| `9690079` | **Survey auto-complete** (a survey auto-marks COMPLETE once every applicable question has a value OR explicit N/A; auto-reopens only on a clear; manual "Mark complete now" kept as override). **4R matrix parity**: Portfolio dots now clickable + acronym labels on both matrices + captions explaining the population difference (dashboard = in-scope+utilized analysis pool; Portfolio = full filter). Fixed a completion display bug (was showing >100%). |
| `57c0bcd` | **Tech debt:** single `finalDisposition(app)` helper replaces ~14 inline sites; comment logic extracted to pure `src/lib/comments.ts` (`resolveMentions`, `toCommentViews`) + 10 tests. |
| `fba523a` | **Security hardening (audit fixes 1–4):** AuditEvent denied to viewers at the guard; decompression-bomb guard now enforces during inflation (byte-counting stream) not on declared size + empty-engagement check moved before parse; AI rate-limit paths fail-closed + size-weighted; import/config actions rate-limited. |
| `507c1c2` / `25d593f` | **Collaboration C3:** capability detail page (`/capabilities/[nodeId]`) + polymorphic `Comment` (application XOR capability, DB CHECK) + `DispositionSignOff` (Lead records client agreement to the final disposition as a snapshot; stale flag when the live value diverges). |

Earlier in the project: C1/C2 collaboration (comments, notifications bell, tasks, activity feed, viewer surface), full AI suite (grounded narratives + brief, AI import with staging review, capability auto-mapping, final report with draft→critique→revise, data-quality copilot, portfolio Q&A), capability reference library (11 hand-authored industry packs; LeanIX used only as a coverage checklist, vendor name scrubbed), engagement settings page, UX overhaul (icon sidebar, single header, executive dashboard), all five original build phases, and a full security-hardening pass.

## 7. Open items / backlog (nothing is blocking the pilot)

**Security — remaining LOW / defense-in-depth (from the audit, not yet done):**
- `dev.ts` is statically bundled into prod builds (not exploitable — server-only components, never called in Clerk mode; the comment claims "never bundled" but it is). Dynamic-import it in the dev branch, or correct the comment.
- Email-based membership match in `context.ts` (`findMembership` matches `clerkUserId` OR `email`) can adopt another user's row (no priv-esc; attribution only). Resolve by `clerkUserId` only in Clerk mode. Same mechanism underlies the webhook edge case.
- CSP `img-src … https:` is broad; HSTS lacks `preload`; grounding verifier uses substring containment (not exact numeric tokens); webhook `reconcileMemberships` caps at 500 members (webhook not deployed).

**Tech debt (from the review, not yet done):** heat/disposition color palette redefined in ~6 places; date-format closure duplicated in ~11 files (make a `lib/format.ts`); `hardening.sql` tenant list duplicated ×2 (drift hazard); most AI modules (`extract`/`report`/`quality`/`capability-map`) still untested.

**Deferred features (agreed, revisit on demand):** email digests for notifications (needs a mail provider — recommended **Resend** free tier); Clerk membership webhook (intentionally SKIPPED — the in-app invite flow is self-sufficient; only needed if managing membership from the Clerk dashboard, and would need the email-match reconcile fix first); production Clerk instance + custom domain (for scaling past the ~100-user dev cap); Deloitte-branded PPTX template; separate prod DB; Neon pooler host if connection errors appear under load.

## 8. Pending USER actions (Albert needs to do these — remind him)

1. **Re-send the stuck invitations.** ⏳ STILL PENDING (Albert-only — needs your live session + sends emails). The redirect fix only applies to NEW invitations; ones already in inboxes still have no redirect. On the Members page, remove + re-invite the affected people. Test with one invite to himself first.
2. **Add the two missing Clerk URL vars to Vercel Production + redeploy.** ⚠️ VERIFIED MISSING (2026-07-21). Checked live: `window.Clerk.buildSignInUrl()`/`buildSignUpUrl()` on app-port-strat.vercel.app return the **hosted** Account Portal (`settling-hermit-95.accounts.dev/…`), so **`NEXT_PUBLIC_CLERK_SIGN_IN_URL` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL` are NOT applied in the production build** — the "Sign up" / "Sign in" cross-links on the auth cards bounce users to Clerk's hosted portal instead of the in-app `/sign-in` `/sign-up` routes (both routes themselves render fine). The two FALLBACK vars ARE fine (`buildAfterSignIn/Up` → app origin `/`). All four are set in local `.env`, and `<ClerkProvider>` (`layout.tsx:37`) takes no props, so this is a pure Vercel Production config gap (likely cause: the shorthand names from an earlier version of this doc — `SIGN_UP_URL` etc. — were used instead of the full `NEXT_PUBLIC_CLERK_*` names). **FIX:** in Vercel → Project → Settings → Environment Variables (Production), add exactly `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, then **Redeploy** (NEXT_PUBLIC vars are inlined at build time — a rebuild is required; a plain alias swap won't pick them up). No MCP tool can write env vars, so this must be done in the dashboard/CLI. Re-verify after: `window.Clerk.buildSignInUrl()` should return `…/sign-in` on the app's own origin.
3. **`prisma/generate-sample-workbook.ts` — DECIDED: KEPT.** ✅ DONE (2026-07-21, commit `3b4140e`, pushed to main). Committed as a dev tool; it's a standalone tsx script never imported by the Next build, so it doesn't affect the deploy. Generates `../sample-portfolio.xlsx` (a valid populated sample APS v5.0 workbook, self-tested through the real importer: 10 apps across all quadrants, 14 capabilities, weightings, thresholds, survey answers, 36 cost records).
4. `.env.vercel-notes` — ✅ CONFIRMED GONE (not in the working tree and absent from all git history). Nothing to do.

## 9. Handy commands (run from the AppPortStrat dir)

```bash
# Verify (the standard gate before any push):
npx tsc --noEmit                                   # types
set -a; source .env; set +a; npm test              # 158 tests (needs .env for DB/dev-secret)
npm run lint
npm run build                                      # stop the dev preview server first for a fast build

# Migrations (hand-written; never `migrate dev`):
npx prisma db execute --file prisma/migrations/<ts>_<name>/migration.sql
npx prisma migrate resolve --applied <name>
npm run db:harden                                  # after adding a tenant table (update the 2 arrays in hardening.sql first)

# Run a server-only tsx script:
set -a; source .env; set +a; NODE_OPTIONS=--conditions=react-server npx tsx prisma/<script>.ts

# Regenerate the sample workbook (self-tests through the real importer):
set -a; source .env; set +a; NODE_OPTIONS=--conditions=react-server npx tsx prisma/generate-sample-workbook.ts
```

## 10. How to deploy & verify

Push to `main` → Vercel auto-deploys (build = `prisma generate && next build`). Confirm with the Vercel MCP `get_deployment` on `app-port-strat.vercel.app` → `state: READY` (earlier ERRORs in the history were the pre-`21f1ac9` Prisma-client build failure — ignore them). The dev Clerk instance shows a "Development mode" badge on sign-in; that's expected for the pilot.

**Working style Albert expects:** brainstorm before building when he says so; verify in the browser and report proof, never "should work"; keep the security model intact; commit + push per logical unit with a descriptive message ending `Co-Authored-By: Claude <noreply@anthropic.com>`; update the memory file after notable work.
