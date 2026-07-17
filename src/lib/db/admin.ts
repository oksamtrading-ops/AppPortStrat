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
