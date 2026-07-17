/**
 * Auth mode resolution — FAIL-CLOSED (pure; "golden test 27").
 *
 * clerk mode: both Clerk keys present.
 * dev mode:   requires ALL of — NODE_ENV === 'development', ALLOW_DEV_AUTH === 'true',
 *             and NOT running on Vercel or CI. No env var can enable dev auth in a
 *             deployed environment.
 * anything else: refuse to start. A deployed environment missing Clerk keys must
 * crash at boot (instrumentation.ts), never silently degrade — a Vercel Preview
 * deployment that didn't inherit the keys is the canonical trap.
 */

export type AuthMode = "clerk" | "dev";

export interface AuthEnv {
  nodeEnv: string | undefined;
  vercel: string | undefined;
  ci: string | undefined;
  allowDevAuth: string | undefined;
  publishableKey: string | undefined;
  secretKey: string | undefined;
}

export function readAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  return {
    nodeEnv: env.NODE_ENV,
    vercel: env.VERCEL,
    ci: env.CI,
    allowDevAuth: env.ALLOW_DEV_AUTH,
    publishableKey: env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  };
}

export function resolveAuthMode(env: AuthEnv): AuthMode {
  const hasKeys = Boolean(env.publishableKey) && Boolean(env.secretKey);
  if (hasKeys) return "clerk";

  const deployed = Boolean(env.vercel) || Boolean(env.ci) || env.nodeEnv === "production";
  if (deployed) {
    throw new Error(
      "Clerk keys are missing in a deployed environment. Refusing to start without authentication — " +
        "set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY (including on Vercel Preview).",
    );
  }
  if (env.nodeEnv === "development" && env.allowDevAuth === "true") {
    return "dev";
  }
  throw new Error(
    "No authentication configured. Set the Clerk keys, or for local development set ALLOW_DEV_AUTH=true in .env.",
  );
}

let cachedMode: AuthMode | null = null;

/** Resolved once per process; throws at first use when misconfigured. */
export function getAuthMode(): AuthMode {
  if (cachedMode === null) {
    cachedMode = resolveAuthMode(readAuthEnv());
  }
  return cachedMode;
}
