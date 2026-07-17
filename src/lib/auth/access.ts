import { mapClerkOrgRole, roleAtLeast, type Role } from "./roles";
import type { AuthMode } from "./mode";

/**
 * Pure access decision for an engagement workspace — the testable core of
 * requireEngagementContext. Every deny renders as an identical 404 upstream
 * (no tenant-existence oracle).
 */

export type EngagementStatusLike = "ACTIVE" | "ARCHIVED" | "PENDING_PURGE";

export interface AccessInput {
  mode: AuthMode;
  engagement: { clerkOrgId: string | null; status: EngagementStatusLike } | null;
  /** Clerk mode: the verified session's active organization + role claims. */
  activeOrgId: string | null;
  clerkOrgRole: string | null;
  /** Local membership row (dev-mode role authority; FK anchor in both modes). */
  membershipRole: Role | null;
  minRole?: Role;
}

export type AccessDecision = { ok: true; role: Role; readOnly: boolean } | { ok: false; reason: string };

export function evaluateAccess(input: AccessInput): AccessDecision {
  if (!input.engagement) return deny("engagement not found");

  let role: Role | null;
  if (input.mode === "clerk") {
    // H4: an engagement with no bound Clerk org is a hard deny in Clerk mode —
    // never "skip the check".
    if (!input.engagement.clerkOrgId) return deny("engagement has no Clerk organization bound");
    if (!input.activeOrgId || input.activeOrgId !== input.engagement.clerkOrgId) {
      return deny("active organization does not match engagement");
    }
    // Role authority = live verified session claims, never the local row.
    role = mapClerkOrgRole(input.clerkOrgRole);
    if (!role) return deny(`unmapped Clerk org role: ${input.clerkOrgRole ?? "none"}`);
  } else {
    role = input.membershipRole;
    if (!role) return deny("no membership in this engagement");
  }

  if (input.minRole && !roleAtLeast(role, input.minRole)) {
    return deny(`requires ${input.minRole}`);
  }

  return { ok: true, role, readOnly: input.engagement.status !== "ACTIVE" };
}

function deny(reason: string): AccessDecision {
  return { ok: false, reason };
}
