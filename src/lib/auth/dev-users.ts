/**
 * The seeded dev-mode identities — PURE static data, no secret-bearing code.
 *
 * This lives apart from dev.ts on purpose: the dev user-switcher UI (top-bar,
 * sign-in page) needs only this list, and it renders in every mode. Importing
 * it from here (instead of dev.ts) keeps dev.ts's cookie-signing crypto out of
 * the production bundle entirely — dev.ts is then reached ONLY via the
 * dynamic imports in session.ts / dev-actions.ts, which run in dev mode alone.
 *
 * Seeded by prisma/seed-dev.ts as memberships of the sample engagement.
 */
export interface DevUser {
  id: string; // becomes Membership.clerkUserId, "dev:" namespace
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

export const DEV_USERS: readonly DevUser[] = [
  { id: "dev:admin", email: "admin@dev.local", displayName: "Dev Platform Admin", isPlatformAdmin: true },
  { id: "dev:lead", email: "lead@dev.local", displayName: "Dev Engagement Lead", isPlatformAdmin: false },
  { id: "dev:consultant", email: "consultant@dev.local", displayName: "Dev Consultant", isPlatformAdmin: false },
  { id: "dev:respondent", email: "respondent@dev.local", displayName: "Dev Client Respondent", isPlatformAdmin: false },
  { id: "dev:viewer", email: "viewer@dev.local", displayName: "Dev Client Viewer", isPlatformAdmin: false },
];
