import "server-only";
import { cache } from "react";
import { getAuthMode } from "./mode";

export interface Session {
  mode: "clerk" | "dev";
  userId: string; // Clerk user id, or "dev:<name>"
  email: string | null;
  displayName: string;
  isPlatformAdmin: boolean;
  activeOrgId: string | null;
  activeOrgRole: string | null;
}

/**
 * The signed-in user, or null. Mode is decided once per process (fail-closed);
 * the dev resolver is dynamic-imported only when mode === "dev", which cannot
 * happen in a deployed environment.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const mode = getAuthMode();
  if (mode === "clerk") {
    const { auth, clerkClient } = await import("@clerk/nextjs/server");
    const a = await auth();
    if (!a.userId) return null;
    // Platform Admin is read from the server-verified user record (Backend
    // API), never from client-supplied data. cache() dedupes per request.
    const client = await clerkClient();
    const user = await client.users.getUser(a.userId);
    return {
      mode,
      userId: a.userId,
      email: user.primaryEmailAddress?.emailAddress ?? null,
      displayName: user.fullName || user.primaryEmailAddress?.emailAddress || a.userId,
      isPlatformAdmin: user.publicMetadata?.platformAdmin === true,
      activeOrgId: a.orgId ?? null,
      activeOrgRole: a.orgRole ?? null,
    };
  }

  const [{ cookies }, dev] = await Promise.all([import("next/headers"), import("./dev")]);
  const store = await cookies();
  const user = dev.verifyDevCookieValue(store.get(dev.DEV_COOKIE_NAME)?.value);
  if (!user) return null;
  return {
    mode,
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    isPlatformAdmin: user.isPlatformAdmin,
    activeOrgId: null,
    activeOrgRole: null,
  };
});
