import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getSession, type Session } from "./session";
import { evaluateAccess } from "./access";
import type { Role } from "./roles";
import { getEngagementById, findMembership, adminDb } from "@/lib/db/admin";
import { getScopedDb, type EngagementContext, type ScopedDb } from "@/lib/db/scoped";

export interface EngagementRequestContext {
  ctx: EngagementContext;
  db: ScopedDb;
  session: Session;
  engagement: NonNullable<Awaited<ReturnType<typeof getEngagementById>>>;
}

/**
 * THE security boundary for engagement data. Must be called in EVERY page,
 * server action, and route handler that touches engagement data — the
 * e/[engagementId] layout check is navigation UX, not enforcement (App Router
 * layouts do not gate page data or server actions).
 *
 * Every denial renders an identical 404: no tenant-existence oracle.
 */
export const requireEngagementContext = cache(
  async (engagementId: string, minRole?: Role): Promise<EngagementRequestContext> => {
    const session = await getSession();
    if (!session) notFound();

    const engagement = await getEngagementById(engagementId);

    // Membership: role authority in dev mode; FK anchor in both modes.
    // In Clerk mode the email fallback may only resolve an UNCLAIMED row, so a
    // session can never adopt another user's membership (findMembership docs).
    let membership = engagement
      ? await findMembership(
          engagement.id,
          { clerkUserId: session.userId, email: session.email },
          { emailMatchesUnclaimedOnly: session.mode === "clerk" },
        )
      : null;

    const decision = evaluateAccess({
      mode: session.mode,
      engagement: engagement ? { clerkOrgId: engagement.clerkOrgId, status: engagement.status } : null,
      activeOrgId: session.activeOrgId,
      clerkOrgRole: session.activeOrgRole,
      membershipRole: (membership?.role as Role | undefined) ?? null,
      minRole,
    });
    if (!decision.ok || !engagement) notFound();

    // Clerk mode: lazily anchor/refresh the local membership row FROM VERIFIED
    // SESSION CLAIMS only. Sync never widens beyond the claim role and never
    // resurrects rows for orgs absent from the current token (the org match
    // already passed in evaluateAccess).
    if (session.mode === "clerk") {
      if (!membership) {
        membership = await adminDb().membership.create({
          data: {
            engagementId: engagement.id,
            clerkUserId: session.userId,
            email: session.email ?? `${session.userId}@unknown.clerk`,
            displayName: session.displayName,
            role: decision.role,
          },
        });
      } else if (membership.role !== decision.role || membership.clerkUserId !== session.userId) {
        membership = await adminDb().membership.update({
          where: { id: membership.id },
          data: { role: decision.role, clerkUserId: session.userId },
        });
      }
    }
    if (!membership) notFound();

    const ctx: EngagementContext = {
      engagementId: engagement.id,
      membershipId: membership.id,
      role: decision.role,
      readOnly: decision.readOnly,
      clerkUserId: session.userId,
      actorDisplay: session.displayName,
    };
    return { ctx, db: getScopedDb(ctx), session, engagement };
  },
);

/** Platform Admin gate for /admin routes (engagement CRUD, purge). */
export async function requirePlatformAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session || !session.isPlatformAdmin) notFound();
  return session;
}
