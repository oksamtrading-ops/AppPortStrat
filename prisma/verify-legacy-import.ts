/**
 * End-to-end verification of the legacy importer + exports against a real
 * APS v5.0 workbook. Creates a scratch engagement, imports ../excelapp.xlsm,
 * recomputes, generates XLSX + PPTX to /tmp, then deletes the engagement.
 * Run: VERIFY_STAMP=$RANDOM npx tsx prisma/verify-legacy-import.ts
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { getRawPrisma } from "../src/lib/db/prisma";
import { createEngagementWithConfig } from "../src/lib/db/provision";
import { getScopedDb, type EngagementContext } from "../src/lib/db/scoped";

async function main() {
  const raw = getRawPrisma();
  const engagement = await createEngagementWithConfig({
    name: `__phase5_verify_${process.env.VERIFY_STAMP ?? "run"}`,
    clientName: "Verify Co.",
    source: { kind: "defaults", preset: "NEUTRAL" },
  });
  const membership = await raw.membership.create({
    data: { engagementId: engagement.id, clerkUserId: "test:lead:p5", email: "p5@test.local", role: "ENGAGEMENT_LEAD" },
  });
  const ctx: EngagementContext = {
    engagementId: engagement.id,
    membershipId: membership.id,
    role: "ENGAGEMENT_LEAD",
    readOnly: false,
    clerkUserId: "test:lead:p5",
    actorDisplay: "P5 Verify",
  };
  const db = getScopedDb(ctx);

  // 1. Legacy import of the real workbook.
  const questionRefs = await db.surveyQuestion.findMany({ select: { code: true, legacyRef: true, answerKind: true } });
  const { parseLegacyWorkbook, applyLegacyImport } = await import("../src/lib/legacy-import");
  const buffer = readFileSync("../excelapp.xlsm");
  const parsed = await parseLegacyWorkbook(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    questionRefs,
  );
  const summary = await applyLegacyImport(ctx, db, parsed);
  console.log("IMPORT:", JSON.stringify(summary));

  const { recomputeEngagement } = await import("../src/lib/recompute");
  const stats = await recomputeEngagement(ctx, db, { strictWorkbookScoring: false });
  console.log("RECOMPUTE:", JSON.stringify(stats));

  const apps = await db.application.findMany({
    orderBy: { appNumber: "asc" },
    select: { appNumber: true, name: true, capabilityNodeId: true, result: { select: { bvScore: true, itScore: true, computedDisposition: true } } },
  });
  console.log("APPS:", apps.length, "| with capability:", apps.filter((a) => a.capabilityNodeId).length);
  console.log("FIRST:", JSON.stringify(apps[0]));
  const weightings = await db.questionWeighting.findMany({ where: { importanceRating: 5 }, select: { question: { select: { code: true } } } });
  console.log("VERY IMPORTANT:", weightings.length, weightings.map((w) => w.question.code).slice(0, 4).join(","), "...");
  const costs = await db.costRecord.count();
  console.log("COST RECORDS:", costs);

  // 2. XLSX + PPTX exports.
  const { buildEngagementWorkbook } = await import("../src/lib/xlsx-export");
  const workbook = await buildEngagementWorkbook(db, engagement.name);
  const xlsxBuffer = await workbook.xlsx.writeBuffer();
  writeFileSync("/tmp/p5-export.xlsx", Buffer.from(xlsxBuffer as unknown as ArrayBuffer));
  console.log("XLSX bytes:", (xlsxBuffer as ArrayBuffer).byteLength ?? (xlsxBuffer as Buffer).length);

  const { buildEngagementDeck } = await import("../src/lib/pptx-export");
  const deck = await buildEngagementDeck(db, { name: engagement.name, clientName: "Verify Co.", currency: "USD" });
  writeFileSync("/tmp/p5-deck.pptx", Buffer.from(deck));
  console.log("PPTX bytes:", deck.byteLength);

  // 3. Clean up the scratch engagement.
  await raw.engagement.delete({ where: { id: engagement.id } });
  console.log("CLEANUP: done");
  await raw.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
