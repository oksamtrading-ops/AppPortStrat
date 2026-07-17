import type { GuardRole } from "@/lib/db/guard";

export type Role = GuardRole;

const ROLE_ORDER: Record<Role, number> = {
  CLIENT_VIEWER: 0,
  CLIENT_RESPONDENT: 1,
  CONSULTANT: 2,
  ENGAGEMENT_LEAD: 3,
};

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[min];
}

/**
 * Clerk organization role → platform role. Unknown roles (including Clerk's
 * default org:member) map to null = access denied — least surprise beats
 * least privilege here: an unmapped role is a configuration error, not a
 * viewer.
 */
const CLERK_ORG_ROLE_MAP: Record<string, Role> = {
  "org:lead": "ENGAGEMENT_LEAD",
  "org:admin": "ENGAGEMENT_LEAD", // Clerk org creator gets org:admin by default
  "org:consultant": "CONSULTANT",
  "org:client_respondent": "CLIENT_RESPONDENT",
  "org:client_viewer": "CLIENT_VIEWER",
};

export function mapClerkOrgRole(orgRole: string | null | undefined): Role | null {
  if (!orgRole) return null;
  return CLERK_ORG_ROLE_MAP[orgRole] ?? null;
}

export const ROLE_LABELS: Record<Role, string> = {
  ENGAGEMENT_LEAD: "Engagement Lead",
  CONSULTANT: "Consultant",
  CLIENT_RESPONDENT: "Client Respondent",
  CLIENT_VIEWER: "Client Viewer",
};
