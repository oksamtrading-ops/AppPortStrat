/**
 * Backfill Demographics/Finance item descriptions into the database from
 * prisma/seed-data/demographics-finance.json (populated by
 * extract-demfin-descriptions.ts).
 *
 * Why a dedicated script rather than re-seeding: `npm run db:seed` rebuilds the
 * whole bank and touches more than these two templates, and syncEngagementFromBank
 * is ADDITIVE (it never updates an existing question's fields). Existing engagements
 * already hold Demographics/Finance SurveyQuestion rows with description = null, so
 * they need a targeted update.
 *
 * Keyed by legacyRef ("Demographics!rowN" / "Finance!rowN") — unique per bank
 * question and stable across every engagement's copy. ADDITIVE + IDEMPOTENT:
 * only the `description` text column is written; re-running sets identical values.
 *
 * Run from AppPortStrat/:  NODE_OPTIONS=--conditions=react-server npx tsx prisma/backfill-demfin-descriptions.ts
 * WRITES TO THE DATABASE the .env DATABASE_URL points at.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getRawPrisma } from "../src/lib/db/prisma";

interface FieldRow {
  row: number;
  section: string;
  name: string;
  description?: string | null;
}

async function main(): Promise<void> {
  const db = getRawPrisma();
  const data: { demographics: FieldRow[]; finance: FieldRow[] } = JSON.parse(
    readFileSync(join(__dirname, "seed-data", "demographics-finance.json"), "utf8"),
  );

  const updates: { legacyRef: string; description: string }[] = [];
  for (const [sheet, rows] of [
    ["Demographics", data.demographics],
    ["Finance", data.finance],
  ] as const) {
    for (const r of rows) {
      if (r.description) updates.push({ legacyRef: `${sheet}!row${r.row}`, description: r.description });
    }
  }
  console.log(`Prepared ${updates.length} description(s) from the JSON.`);

  const before = await db.surveyQuestion.count({
    where: { legacyRef: { startsWith: "Demographics!" }, NOT: { description: null } },
  });
  const beforeFin = await db.surveyQuestion.count({
    where: { legacyRef: { startsWith: "Finance!" }, NOT: { description: null } },
  });
  console.log(`SurveyQuestion with description BEFORE — Demographics: ${before}, Finance: ${beforeFin}`);

  let bankUpdated = 0;
  let surveyUpdated = 0;
  for (const u of updates) {
    const bank = await db.bankQuestion.updateMany({ where: { legacyRef: u.legacyRef }, data: { description: u.description } });
    const survey = await db.surveyQuestion.updateMany({ where: { legacyRef: u.legacyRef }, data: { description: u.description } });
    bankUpdated += bank.count;
    surveyUpdated += survey.count;
  }
  console.log(`Applied: BankQuestion rows updated ${bankUpdated}, SurveyQuestion rows updated ${surveyUpdated}.`);

  const afterDem = await db.surveyQuestion.count({
    where: { legacyRef: { startsWith: "Demographics!" }, NOT: { description: null } },
  });
  const afterFin = await db.surveyQuestion.count({
    where: { legacyRef: { startsWith: "Finance!" }, NOT: { description: null } },
  });
  console.log(`SurveyQuestion with description AFTER — Demographics: ${afterDem}, Finance: ${afterFin}`);

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(String(e));
  await getRawPrisma().$disconnect();
  process.exit(1);
});
