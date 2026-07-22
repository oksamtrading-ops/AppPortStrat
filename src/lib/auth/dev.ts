/**
 * Dev-mode auth: signed-cookie minting/verification over the seeded identities.
 *
 * The secret-bearing code here is reached ONLY through the dynamic imports in
 * session.ts and dev-actions.ts, which run after getAuthMode() returned "dev"
 * — impossible in a deployed environment (see mode.ts). The static identity
 * list the switcher UI renders lives in dev-users.ts precisely so importing it
 * does not pull this module into the production bundle. DEV_USERS is re-exported
 * here for the (dev-only, dynamic) dev-actions.ts importer.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { DEV_USERS, type DevUser } from "./dev-users";

export { DEV_USERS, type DevUser };

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
