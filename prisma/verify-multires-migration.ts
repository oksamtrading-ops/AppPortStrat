/**
 * Read-only verification for migration 20260722120000_multires_survey_layers.
 * Run AFTER `prisma db execute` and BEFORE `prisma migrate resolve` (the
 * P1001-after-resolve gotcha: never mark applied without proving the DDL landed).
 *
 * Run: set -a; source .env; set +a; NODE_OPTIONS=--conditions=react-server npx tsx prisma/verify-multires-migration.ts
 */
import "dotenv/config";
import { getRawPrisma } from "../src/lib/db/prisma";

async function main(): Promise<void> {
  const db = getRawPrisma();
  let failures = 0;
  const check = (label: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };

  // DDL landed: enum, columns, check, FK, partial indexes.
  const [enumRow] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM pg_type WHERE typname = 'ResponseKind'`;
  check("ResponseKind enum exists", Number(enumRow.n) === 1);

  const cols = await db.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'SurveyResponse' AND column_name IN ('kind', 'respondentMembershipId', 'finalizedAt')`;
  check("SurveyResponse new columns", cols.length === 3, cols.map((c) => c.column_name).join(","));

  const [ansCol] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM information_schema.columns
    WHERE table_name = 'Answer' AND column_name = 'updatedAt'`;
  check("Answer.updatedAt", Number(ansCol.n) === 1);

  const cons = await db.$queryRaw<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conname IN ('SurveyResponse_kind_respondent_check', 'SurveyResponse_respondent_fkey')`;
  check("CHECK + composite FK", cons.length === 2, cons.map((c) => c.conname).join(","));

  const idx = await db.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'SurveyResponse'
    AND indexname IN ('SurveyResponse_consensus_key', 'SurveyResponse_respondent_key', 'SurveyResponse_respondentMembershipId_idx', 'SurveyResponse_applicationId_templateId_key')`;
  check("partial uniques + respondent idx + TRANSITIONAL legacy unique", idx.length === 4, idx.map((i) => i.indexname).join(","));

  // Data reclassification is coherent.
  const [counts] = await db.$queryRaw<{ total: bigint; consensus: bigint; respondent: bigint; badresp: bigint; finalized: bigint }[]>`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE "kind" = 'CONSENSUS') AS consensus,
           count(*) FILTER (WHERE "kind" = 'RESPONDENT') AS respondent,
           count(*) FILTER (WHERE ("kind" = 'RESPONDENT') <> ("respondentMembershipId" IS NOT NULL)) AS badresp,
           count(*) FILTER (WHERE "kind" = 'CONSENSUS' AND "status" = 'COMPLETE' AND "finalizedAt" IS NULL) AS finalized
    FROM "SurveyResponse"`;
  console.log(`INFO  responses: total ${counts.total}, consensus ${counts.consensus}, respondent ${counts.respondent}`);
  check("kind/respondent coherence (0 violations)", Number(counts.badresp) === 0);
  check("all COMPLETE consensus rows finalized", Number(counts.finalized) === 0);

  // Respondent rows really belong to CLIENT_RESPONDENTs.
  const [wrongRole] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "SurveyResponse" r JOIN "Membership" m ON m."id" = r."respondentMembershipId"
    WHERE r."kind" = 'RESPONDENT' AND m."role" <> 'CLIENT_RESPONDENT'`;
  check("respondent rows owned by CLIENT_RESPONDENTs", Number(wrongRole.n) === 0);

  // Migration cannot have changed scores: still exactly one row per app+survey.
  const [dupes] = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM (
      SELECT "applicationId", "templateId" FROM "SurveyResponse"
      GROUP BY "applicationId", "templateId" HAVING count(*) > 1) d`;
  check("still one response per (app, survey) — scores unchanged", Number(dupes.n) === 0);

  await db.$disconnect();
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED — do NOT run migrate resolve.`);
    process.exit(1);
  }
  console.log("\nAll checks passed — safe to run: npx prisma migrate resolve --applied 20260722120000_multires_survey_layers");
}

main().catch(async (e) => {
  console.error(String(e));
  await getRawPrisma().$disconnect();
  process.exit(1);
});
