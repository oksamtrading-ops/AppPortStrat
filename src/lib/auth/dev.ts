/**
 * Dev-mode auth: a signed-cookie user switcher over seeded identities.
 * Statically unreachable in Clerk mode — session.ts only dynamic-imports this
 * module after getAuthMode() returned "dev", which is impossible in a
 * deployed environment (see mode.ts).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface DevUser {
  id: string; // becomes Membership.clerkUserId, "dev:" namespace
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

/** Seeded by prisma/seed-dev.ts as memberships of the sample engagement. */
export const DEV_USERS: readonly DevUser[] = [
  { id: "dev:admin", email: "admin@dev.local", displayName: "Dev Platform Admin", isPlatformAdmin: true },
  { id: "dev:lead", email: "lead@dev.local", displayName: "Dev Engagement Lead", isPlatformAdmin: false },
  { id: "dev:consultant", email: "consultant@dev.local", displayName: "Dev Consultant", isPlatformAdmin: false },
  { id: "dev:respondent", email: "respondent@dev.local", displayName: "Dev Client Respondent", isPlatformAdmin: false },
  { id: "dev:viewer", email: "viewer@dev.local", displayName: "Dev Client Viewer", isPlatformAdmin: false },
];

export const DEV_COOKIE_NAME = "aps-dev-user";

function secret(): string {
  // Fail-closed: require an explicit secret even in dev, so a shared non-Clerk
  // environment can't be spoofed with a well-known constant. Dev mode itself
  // cannot exist in a deployed environment (see auth/mode.ts).
  const value = process.env.DEV_AUTH_SECRET;
  if (!value) {
    throw new Error("DEV_AUTH_SECRET must be set when running in dev-auth mode (see .env.example)");
  }
  return value;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createDevCookieValue(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

export function verifyDevCookieValue(cookieValue: string | undefined): DevUser | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const expected = sign(userId);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return DEV_USERS.find((u) => u.id === userId) ?? null;
}
