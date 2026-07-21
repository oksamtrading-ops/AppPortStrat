/**
 * The sanctioned unscoped door. Everything here either operates above the
 * tenant level (engagement/membership resolution, engagement creation) or is
 * an explicitly reviewed raw statement (the DispositionResult bulk upsert).
 * Only src/lib/auth/**, src/lib/recompute.ts, admin routes, and seeds may
 * import this module — enforced by ESLint.
 */
import { randomUUID } from "node:crypto";
import { getRawPrisma } from "./prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PerAppResult } from "@/lib/methodology";

export function adminDb() {
  return getRawPrisma();
}

/**
 * Serverless-safe fixed-window rate limiter (security review: expensive paths
 * were unthrottled). Atomic INSERT ... ON CONFLICT increments the per-window
 * counter in one round-trip; no external Redis.
 *
 * Failure policy on a DB error is the CALLER's choice (security review):
 *  - default (failClosed:false) fails OPEN — a limiter hiccup never blocks
 *    legitimate traffic on cheap/idempotent paths.
 *  - failClosed:true DENIES on error — used for the money-spending AI path,
 *    where a DB brownout (which also errors the limiter, since it shares the
 *    connection pool) must NOT uncap Anthropic spend.
 *
 * `cost` charges more than one unit in a single call — used to weight a request
 * by how expensive it is (e.g. a large AI input costs several units).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  now: number = Date.now(),
  opts: { failClosed?: boolean; cost?: number } = {},
): Promise<{ allowed: boolean; count: number }> {
  const windowIndex = Math.floor(now / (windowSeconds * 1000));
  const bucket = `${key}:${windowIndex}`;
  const windowEnd = new Date((windowIndex + 1) * windowSeconds * 1000);
  const cost = Math.max(1, Math.floor(opts.cost ?? 1));
  const db = getRawPrisma();
  try {
    const rows = await db.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "RateLimitHit" ("bucket", "count", "windowEnd")
      VALUES (${bucket}, ${cost}, ${windowEnd})
      ON CONFLICT ("bucket") DO UPDATE SET "count" = "RateLimitHit"."count" + ${cost}
      RETURNING "count"`;
    const count = rows[0]?.count ?? cost;
    // Opportunistic cleanup of expired buckets (~1% of calls) keeps the table
    // from accumulating stale rows without a scheduled job.
    if (Math.random() < 0.01) {
      await db.$executeRaw`DELETE FROM "RateLimitHit" WHERE "windowEnd" < now()`;
    }
    return { allowed: count <= limit, count };
  } catch {
    // Fail open by default; fail closed for cost-sensitive callers.
    return opts.failClosed ? { allowed: false, count: limit + 1 } : { allowed: true, count: 0 };
  }
}

/**
 * THE one sanctioned raw statement: bulk-persist computed portfolio results.
 * - Serialized per engagement via pg_advisory_xact_lock (concurrent config
 *   saves cannot interleave).
 * - Touches ONLY computed columns — authored data (DispositionOverride) lives
 *   in its own table and can never be destroyed by a recompute.
 * - Short write-only transaction: the snapshot read and the pure computation
 *   happen before this is called.
 */
export async function persistPortfolioResults(
  engagementId: string,
  results: PerAppResult[],
  opts: { bumpConfigVersion: boolean },
): Promise<{ configVersion: number }> {
  const db = getRawPrisma();

  return db.$transaction(
    async (tx) => {
      // Under FORCE ROW LEVEL SECURITY the admin door is itself subject to the
      // tenant policy, so set the engagement GUC for this transaction's writes
      // to the RLS'd DispositionResult table (defense-in-depth, hardening.sql).
      await tx.$executeRaw`SELECT set_config('app.engagement_id', ${engagementId}, TRUE)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${engagementId}))`;

      const engagement = opts.bumpConfigVersion
        ? await tx.engagement.update({
            where: { id: engagementId },
            data: { configVersion: { increment: 1 } },
            select: { configVersion: true },
          })
        : await tx.engagement.findUniqueOrThrow({
            where: { id: engagementId },
            select: { configVersion: true },
          });

      if (results.length > 0) {
        const rows = Prisma.join(
          results.map(
            (r) =>
              Prisma.sql`(${randomUUID()}, ${engagementId}, ${r.applicationId}, ${r.itScore}, ${r.bvScore}, ${r.itPartial}, ${r.bvPartial}, ${r.itNonReportScore}, ${r.financialScore}, ${r.computedDisposition}::"Disposition", ${r.filterHit}::"FilterHit", ${r.analysisCandidate}, ${r.veryLowBv}, ${r.veryLowIt}, ${engagement.configVersion}, now())`,
          ),
        );
        await tx.$executeRaw`
          INSERT INTO "DispositionResult"
            ("id", "engagementId", "applicationId", "itScore", "bvScore", "itPartial", "bvPartial",
             "itNonReportScore", "financialScore", "computedDisposition", "filterHit",
             "analysisCandidate", "veryLowBv", "veryLowIt", "configVersion", "computedAt")
          VALUES ${rows}
          ON CONFLICT ("applicationId", "engagementId") DO UPDATE SET
            "itScore" = EXCLUDED."itScore",
            "bvScore" = EXCLUDED."bvScore",
            "itPartial" = EXCLUDED."itPartial",
            "bvPartial" = EXCLUDED."bvPartial",
            "itNonReportScore" = EXCLUDED."itNonReportScore",
            "financialScore" = EXCLUDED."financialScore",
            "computedDisposition" = EXCLUDED."computedDisposition",
            "filterHit" = EXCLUDED."filterHit",
            "analysisCandidate" = EXCLUDED."analysisCandidate",
            "veryLowBv" = EXCLUDED."veryLowBv",
            "veryLowIt" = EXCLUDED."veryLowIt",
            "configVersion" = EXCLUDED."configVersion",
            "computedAt" = EXCLUDED."computedAt"`;
      }

      return { configVersion: engagement.configVersion };
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}

/** Engagement lookup for context resolution (pre-scoping, by necessity). */
export async function getEngagementById(engagementId: string) {
  return adminDb().engagement.findUnique({ where: { id: engagementId } });
}

/** Memberships for a signed-in user across engagements (engagement switcher). */
export async function listMembershipsForUser(params: { clerkUserId?: string | null; email?: string | null }) {
  const or: Array<Record<string, string>> = [];
  if (params.clerkUserId) or.push({ clerkUserId: params.clerkUserId });
  if (params.email) or.push({ email: params.email });
  if (or.length === 0) return [];
  return adminDb().membership.findMany({
    where: { OR: or },
    include: { engagement: { select: { id: true, name: true, clientName: true, status: true } } },
  });
}

/** Membership within one engagement for context resolution. */
export async function findMembership(engagementId: string, params: { clerkUserId?: string | null; email?: string | null }) {
  const or: Array<Record<string, string>> = [];
  if (params.clerkUserId) or.push({ clerkUserId: params.clerkUserId });
  if (params.email) or.push({ email: params.email });
  if (or.length === 0) return null;
  return adminDb().membership.findFirst({ where: { engagementId, OR: or } });
}

/**
 * Survey completion counts (inventory §3.2, no 2% floor). Admin door by
 * design: Client Respondents may not read QuestionWeighting, but the
 * completion DENOMINATOR (how many questions count) is needed to render
 * their own survey. Only counts leave this function — never weighting values.
 * Tenancy: every query is explicitly filtered by the caller's engagementId.
 */
export async function computeSurveyCompletion(
  engagementId: string,
  templateId: string,
  responseId: string | null,
): Promise<{ answeredCount: number; applicableCount: number; fraction: number; addressedCount: number }> {
  // Reads RLS'd tables (SurveyTemplate, Answer, QuestionWeighting) via the
  // admin door — set the engagement GUC so FORCE'd RLS admits these rows.
  return getRawPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.engagement_id', ${engagementId}, TRUE)`;

    const template = await tx.surveyTemplate.findFirst({
      where: { id: templateId, engagementId },
      include: { questions: { select: { id: true, scoreFamily: true } } },
    });
    if (!template) throw new Error("Unknown template for this engagement");

    const answers = responseId
      ? await tx.answer.findMany({
          where: { responseId, engagementId },
          select: { questionId: true, isNA: true, numericValue: true, textValue: true, boolValue: true },
        })
      : [];

    // A question is "addressed" when it has any stored response — a value OR an
    // explicit N/A. Drives auto-complete (every applicable question addressed).
    const isAddressed = (a: { isNA: boolean; numericValue: number | null; textValue: string | null; boolValue: boolean | null }) =>
      a.isNA || a.numericValue !== null || a.textValue !== null || a.boolValue !== null;

    const scored = template.questions.some((q) => q.scoreFamily !== "NONE");
    if (!scored) {
      // Demographics/Finance: applicable = every field; answered = any value (Excel COUNTA).
      const answeredCount = answers.filter(isAddressed).length;
      const applicableCount = template.questions.length;
      // For unscored templates "answered" already counts N/A, so addressed = answered.
      return { answeredCount, applicableCount, addressedCount: answeredCount, fraction: applicableCount === 0 ? 0 : answeredCount / applicableCount };
    }

    // IT/BV: applicable = weighted>0 report questions + non-report; answered = numeric (N/A ≠ answered).
    const weighted = await tx.questionWeighting.findMany({
      where: {
        engagementId,
        importanceRating: { gt: 0 },
        question: { templateId, scoreFamily: { in: ["IT", "BUSINESS"] } },
      },
      select: { questionId: true },
    });
    const applicableIds = new Set<string>([
      ...weighted.map((w) => w.questionId),
      ...template.questions.filter((q) => q.scoreFamily === "IT_NON_REPORT").map((q) => q.id),
    ]);
    const applicableCount = applicableIds.size;
    // Both counts are scoped to APPLICABLE questions so the ratio never exceeds
    // 100% (a respondent can answer non-weighted questions too). answered = a
    // numeric value; addressed also counts an explicit N/A (the auto-complete signal).
    const answeredCount = answers.filter((a) => applicableIds.has(a.questionId) && !a.isNA && a.numericValue !== null).length;
    const addressedCount = answers.filter((a) => applicableIds.has(a.questionId) && isAddressed(a)).length;
    return { answeredCount, applicableCount, addressedCount, fraction: applicableCount === 0 ? 0 : answeredCount / applicableCount };
  });
}

/**
 * Convergent membership sync from a verified Clerk membership list (webhook).
 * Upserts every current member, removes rows whose clerkUserId is no longer
 * in the org (email-invite rows with no clerkUserId yet are left alone).
 */
export async function reconcileMemberships(
  clerkOrgId: string,
  members: Array<{ clerkUserId: string; email: string; displayName: string | null; role: "ENGAGEMENT_LEAD" | "CONSULTANT" | "CLIENT_RESPONDENT" | "CLIENT_VIEWER" }>,
): Promise<{ engagementId: string; upserted: number; removed: number } | { skipped: string }> {
  const db = adminDb();
  const engagement = await db.engagement.findUnique({ where: { clerkOrgId } });
  if (!engagement) return { skipped: "no engagement bound to this organization" };

  let upserted = 0;
  for (const member of members) {
    await db.membership.upsert({
      where: { engagementId_clerkUserId: { engagementId: engagement.id, clerkUserId: member.clerkUserId } },
      create: {
        engagementId: engagement.id,
        clerkUserId: member.clerkUserId,
        email: member.email,
        displayName: member.displayName,
        role: member.role,
      },
      update: { email: member.email, displayName: member.displayName, role: member.role },
    });
    upserted += 1;
  }

  const currentIds = members.map((m) => m.clerkUserId);
  const { count: removed } = await db.membership.deleteMany({
    where: { engagementId: engagement.id, clerkUserId: { notIn: currentIds, not: null } },
  });

  return { engagementId: engagement.id, upserted, removed };
}
