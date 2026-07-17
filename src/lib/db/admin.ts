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
