/**
 * The sanctioned unscoped door. Everything here either operates above the
 * tenant level (engagement/membership resolution, engagement creation) or is
 * an explicitly reviewed raw statement (the DispositionResult bulk upsert).
 * Only src/lib/auth/**, src/lib/recompute.ts, admin routes, and seeds may
 * import this module — enforced by ESLint.
 */
import { getRawPrisma } from "./prisma";

export function adminDb() {
  return getRawPrisma();
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
