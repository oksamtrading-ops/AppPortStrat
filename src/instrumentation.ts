/**
 * Boot assertions (run once per server start):
 *  1. Resolve the auth mode so a deployed environment missing Clerk keys
 *     CRASHES here instead of silently degrading (mode.ts is fail-closed).
 *  2. Confirm the RLS tenant backstop is actually ACTIVE for the connected
 *     role — RLS enabled on every tenant table AND the runtime role does not
 *     bypass it (i.e. it is the non-owner aps_runtime role). Fatal in a
 *     deployed environment; a warning in local dev, where the app commonly
 *     runs as the DB owner (which bypasses ENABLE'd RLS by design).
 */
export async function register() {
  const { getAuthMode } = await import("@/lib/auth/mode");
  const mode = getAuthMode(); // throws when misconfigured
  console.info(`[aps] auth mode: ${mode}`);

  // The RLS probe needs the Node Postgres driver, which must not be bundled
  // into the Edge instrumentation pass (node:* is unavailable there).
  // NEXT_RUNTIME is inlined at build time, so this branch — and the Prisma
  // import behind it — is dead-code-eliminated from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertRlsActive } = await import("@/lib/db/rls-check");
    await assertRlsActive(Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production");
  }
}
