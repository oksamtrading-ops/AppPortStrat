import { getRawPrisma } from "./prisma";

/**
 * Boot-time verification that the RLS tenant backstop is ACTIVE for the
 * connected role: RLS enabled on every tenant table AND the runtime role does
 * not bypass it (owner / BYPASSRLS / superuser bypass ENABLE'd RLS). Backed by
 * the SQL function aps_rls_inactive_reason() installed by prisma/hardening.sql.
 *
 * Fatal in a deployed environment; a warning in local dev, where the app
 * commonly runs as the DB owner (which bypasses ENABLE'd RLS by design).
 */
const REASONS: Record<string, string> = {
  "rls-not-enabled": "row-level security is not enabled on all tenant tables",
  "runtime-role-bypasses-rls":
    "the runtime DB role bypasses RLS (it owns the tables or has BYPASSRLS/superuser) — point DATABASE_URL at the non-owner aps_runtime role",
};

export async function assertRlsActive(isDeployed: boolean): Promise<void> {
  if (!process.env.DATABASE_URL) return; // nothing to check (e.g. build step)

  const fail = (message: string) => {
    if (isDeployed) throw new Error(`[aps] RLS backstop check failed: ${message}`);
    console.warn(
      `[aps] RLS backstop warning (dev): ${message} — run \`npm run db:harden\` and use the aps_runtime role in production`,
    );
  };

  try {
    const rows = await getRawPrisma().$queryRawUnsafe<Array<{ reason: string }>>(
      'SELECT aps_rls_inactive_reason() AS "reason"',
    );
    const reason = rows[0]?.reason ?? "";
    if (reason) fail(REASONS[reason] ?? reason);
    else console.info("[aps] RLS backstop: active for the connected role");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/aps_rls_inactive_reason|42883|does not exist/i.test(message)) {
      fail("database hardening not applied (aps_rls_inactive_reason() missing)");
    } else if (isDeployed) {
      throw err;
    } else {
      console.warn(`[aps] RLS backstop check skipped (dev): ${message}`);
    }
  }
}
