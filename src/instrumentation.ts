/**
 * Boot assertion: resolve the auth mode at startup so a deployed environment
 * missing Clerk keys CRASHES here instead of silently degrading (mode.ts is
 * fail-closed). Runs once per server start.
 */
export async function register() {
  const { getAuthMode } = await import("@/lib/auth/mode");
  const mode = getAuthMode(); // throws when misconfigured
  console.info(`[aps] auth mode: ${mode}`);
}
