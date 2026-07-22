import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * prisma/hardening.sql lists the tenant-scoped tables TWICE — once in the
 * RLS-enable loop, once in the aps_rls_inactive_reason() boot assertion. They
 * must stay identical, and together they must cover every engagement-scoped
 * model in the schema. Because the SQL is applied by hand (npm run db:harden),
 * nothing else catches a table added to the schema but forgotten here — a
 * silent RLS gap. This test is that catch (mirrors the RELATION_MAP drift test).
 *
 * A single source of truth in the SQL itself (an aps_tenant_tables() helper both
 * sites call) would remove the duplication outright, but that requires re-running
 * db:harden against the shared prod DB; until then this guards the drift.
 */

/** Models deliberately NOT row-level-security'd, with the reason each is safe. */
const INTENTIONALLY_NOT_RLS: Record<string, string> = {
  // Must be readable to resolve the engagement context BEFORE app.engagement_id
  // exists; guarded at the access layer instead (see hardening.sql header).
  Membership: "resolved pre-context; access-layer guarded",
  // In the guard's DENIED_MODELS — no scoped client can touch it; the purge
  // admin door manages it directly.
  EngagementTombstone: "guard DENIED_MODELS; admin-door only",
};

function hardeningSql(): string {
  return readFileSync(join(__dirname, "../../../../prisma/hardening.sql"), "utf8");
}

/** Pull the quoted table names out of the ARRAY[...] literal following `marker`. */
function tableArrayAfter(sql: string, marker: string): string[] {
  const start = sql.indexOf(marker);
  if (start < 0) throw new Error(`marker not found in hardening.sql: ${marker}`);
  const open = sql.indexOf("[", start + marker.length - 1);
  const close = sql.indexOf("]", open);
  const body = sql.slice(open + 1, close);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
}

/** Every model in prisma/schema.prisma that declares an `engagementId` field. */
function engagementScopedModels(): string[] {
  const schema = readFileSync(join(__dirname, "../../../../prisma/schema.prisma"), "utf8");
  const models: string[] = [];
  for (const [, name, body] of schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
    if (/\n\s*engagementId\s+\w/.test(body)) models.push(name);
  }
  return models.sort();
}

describe("hardening.sql RLS tenant list stays in sync", () => {
  const rlsLoop = tableArrayAfter(hardeningSql(), "FOREACH t IN ARRAY ARRAY[");
  const bootAssertion = tableArrayAfter(hardeningSql(), "tables text[] :=");

  it("both lists are non-empty", () => {
    expect(rlsLoop.length).toBeGreaterThan(0);
    expect(bootAssertion.length).toBe(rlsLoop.length);
  });

  it("the RLS loop and the boot-assertion list are identical", () => {
    expect(rlsLoop).toEqual(bootAssertion);
  });

  it("covers every engagement-scoped model except the documented exclusions", () => {
    const scoped = engagementScopedModels();
    const expected = scoped.filter((m) => !(m in INTENTIONALLY_NOT_RLS)).sort();
    // Any new tenant table (has engagementId) that isn't RLS'd here — and isn't
    // an explicit, justified exclusion above — fails this assertion.
    expect(rlsLoop).toEqual(expected);
  });
});
