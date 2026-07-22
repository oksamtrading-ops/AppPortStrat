/**
 * Generate a POPULATED sample APS v5.0 workbook (sample-portfolio.xlsx) shaped
 * exactly like excelapp.xlsm as far as the legacy importer reads it, with
 * fabricated sample data spread across all four disposition quadrants.
 *
 * It builds the transposed answer sheets against the app's OWN seeded question
 * bank (so every legacyRef row lines up), then SELF-TESTS the result through the
 * real parseLegacyWorkbook + applyLegacyImport before writing the file.
 *
 * Run from AppPortStrat/:  npx tsx <this file>
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { getRawPrisma } from "../src/lib/db/prisma";
import { createEngagementWithConfig } from "../src/lib/db/provision";
import { getScopedDb, type EngagementContext } from "../src/lib/db/scoped";

const OUT = "../sample-portfolio.xlsx"; // written next to excelapp.xlsm

// ── Sample portfolio: 10 apps across the 2×2 (BV×IT) grid + one unscored ──
type Profile = { bv: number; it: number } | "unscored";
interface SampleApp {
  id: number;
  name: string;
  acronym: string;
  description: string;
  type: string;
  l0: string; l1: string; l2: string;
  businessFn: string;
  target: string;
  meets: "Y" | "N" | "PARTIAL";
  actionPlan: string;
  missionCritical: boolean;
  inScope: boolean; isUtilized: boolean; isReplaced: boolean; inFlight: boolean;
  profile: Profile;
}

const L0 = "Enterprise Operations";
const APPS: SampleApp[] = [
  { id: 1, name: "Customer Portal", acronym: "CP", description: "Self-service portal for retail customers.", type: "Web Application", l0: L0, l1: "Sales & Service", l2: "Customer Management", businessFn: "Digital channels", target: "Invest", meets: "Y", actionPlan: "Enhance", missionCritical: true, inScope: true, isUtilized: true, isReplaced: false, inFlight: false, profile: { bv: 5, it: 5 } },
  { id: 2, name: "Order Management System", acronym: "OMS", description: "Processes and tracks customer orders.", type: "COTS", l0: L0, l1: "Sales & Service", l2: "Order Management", businessFn: "Order fulfilment", target: "Maintain", meets: "Y", actionPlan: "Keep", missionCritical: true, inScope: true, isUtilized: true, isReplaced: false, inFlight: false, profile: { bv: 4, it: 5 } },
  { id: 3, name: "Data Warehouse", acronym: "DWH", description: "Enterprise analytics data store.", type: "Platform", l0: L0, l1: "Information Technology", l2: "Data & Analytics", businessFn: "Analytics", target: "Invest", meets: "PARTIAL", actionPlan: "Enhance", missionCritical: false, inScope: true, isUtilized: true, isReplaced: false, inFlight: true, profile: { bv: 5, it: 4 } },
  { id: 4, name: "Legacy CRM", acronym: "LCRM", description: "Aging customer relationship system, high value but poor health.", type: "COTS", l0: L0, l1: "Sales & Service", l2: "Customer Management", businessFn: "Sales", target: "Re-tool", meets: "N", actionPlan: "Modernise", missionCritical: true, inScope: true, isUtilized: true, isReplaced: false, inFlight: false, profile: { bv: 4, it: 2 } },
  { id: 5, name: "Billing Engine", acronym: "BILL", description: "Core billing and invoicing.", type: "Custom", l0: L0, l1: "Finance", l2: "Accounts Receivable", businessFn: "Billing", target: "Re-tool", meets: "N", actionPlan: "Modernise", missionCritical: true, inScope: true, isUtilized: true, isReplaced: false, inFlight: false, profile: { bv: 5, it: 2 } },
  { id: 6, name: "Marketing Automation", acronym: "MKTA", description: "Campaign management tool, healthy but low business value.", type: "SaaS", l0: L0, l1: "Sales & Service", l2: "Marketing", businessFn: "Marketing", target: "Re-design", meets: "PARTIAL", actionPlan: "Reassess", missionCritical: false, inScope: true, isUtilized: true, isReplaced: false, inFlight: false, profile: { bv: 2, it: 4 } },
  { id: 7, name: "Employee Wiki", acronym: "WIKI", description: "Internal knowledge base.", type: "SaaS", l0: L0, l1: "Human Resources", l2: "Knowledge Management", businessFn: "Collaboration", target: "Re-design", meets: "Y", actionPlan: "Reassess", missionCritical: false, inScope: true, isUtilized: true, isReplaced: false, inFlight: false, profile: { bv: 2, it: 5 } },
  { id: 8, name: "Fax Gateway", acronym: "FAX", description: "Legacy fax integration, low value and poor health.", type: "Custom", l0: L0, l1: "Information Technology", l2: "Integration", businessFn: "Integration", target: "Retire", meets: "N", actionPlan: "Decommission", missionCritical: false, inScope: true, isUtilized: true, isReplaced: true, inFlight: false, profile: { bv: 1, it: 1 } },
  { id: 9, name: "Legacy Reporting Tool", acronym: "LRT", description: "Old reporting suite scheduled for retirement.", type: "COTS", l0: L0, l1: "Finance", l2: "Financial Reporting", businessFn: "Reporting", target: "Retire", meets: "N", actionPlan: "Decommission", missionCritical: false, inScope: true, isUtilized: false, isReplaced: true, inFlight: false, profile: { bv: 2, it: 2 } },
  { id: 10, name: "Pilot Sandbox", acronym: "PILOT", description: "Experimental app, not yet assessed.", type: "Custom", l0: L0, l1: "Information Technology", l2: "Development", businessFn: "R&D", target: "TBD", meets: "PARTIAL", actionPlan: "Assess", missionCritical: false, inScope: false, isUtilized: true, isReplaced: false, inFlight: true, profile: "unscored" },
];

function main(): Promise<void> {
  return (async () => {
    const raw = getRawPrisma();

    // Scratch engagement A — source of the seeded question bank (legacyRefs).
    const engA = await createEngagementWithConfig({
      name: `__sample_gen_${Date.now()}`,
      clientName: "Sample Gen Co.",
      source: { kind: "defaults", preset: "NEUTRAL" },
    });
    const memA = await raw.membership.create({
      data: { engagementId: engA.id, clerkUserId: "test:gen", email: "gen@test.local", role: "ENGAGEMENT_LEAD" },
    });
    const ctxA: EngagementContext = { engagementId: engA.id, membershipId: memA.id, role: "ENGAGEMENT_LEAD", readOnly: false, clerkUserId: "test:gen", actorDisplay: "Gen" };
    const dbA = getScopedDb(ctxA);
    const questionRefs = await dbA.surveyQuestion.findMany({ select: { code: true, legacyRef: true, answerKind: true } });

    // ── Build the workbook ──
    const wb = new ExcelJS.Workbook();
    const set = (ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue) => {
      ws.getCell(row, col).value = value;
    };

    // Master Data View (rows 13+): A id, B name, C acronym, D desc, E type,
    // F comments, G/H/I L0/L1/L2, J businessFn, L target, M meets, N actionPlan,
    // O justification, U missionCritical.
    const mdv = wb.addWorksheet("Master Data View");
    mdv.getRow(12).values = { 1: "App ID", 2: "Name", 3: "Acronym", 4: "Description", 5: "Type", 6: "Comments", 7: "L0", 8: "L1", 9: "L2", 10: "Business Function", 12: "Target", 13: "Meets Future State", 14: "Action Plan", 15: "Justification", 21: "Mission Critical" };
    APPS.forEach((a, i) => {
      const r = 13 + i;
      set(mdv, r, 1, a.id); set(mdv, r, 2, a.name); set(mdv, r, 3, a.acronym);
      set(mdv, r, 4, a.description); set(mdv, r, 5, a.type);
      set(mdv, r, 6, `Sample comment for ${a.name}`);
      set(mdv, r, 7, a.l0); set(mdv, r, 8, a.l1); set(mdv, r, 9, a.l2);
      set(mdv, r, 10, a.businessFn); set(mdv, r, 12, a.target);
      set(mdv, r, 13, a.meets); set(mdv, r, 14, a.actionPlan);
      set(mdv, r, 15, `Rationale for ${a.name}`);
      set(mdv, r, 21, a.missionCritical ? "Y" : "N");
    });

    // Filtering Control Panel (rows 13+): A id, S inScope, T isUtilized, U isReplaced, V inFlight.
    const fcp = wb.addWorksheet("Filtering Control Panel");
    fcp.getRow(12).values = { 1: "App ID", 19: "In Scope", 20: "Utilized", 21: "Replaced", 22: "In Flight" };
    APPS.forEach((a, i) => {
      const r = 13 + i;
      set(fcp, r, 1, a.id);
      set(fcp, r, 19, a.inScope ? "Y" : "N");
      set(fcp, r, 20, a.isUtilized ? "Y" : "N");
      set(fcp, r, 21, a.isReplaced ? "Y" : "N");
      set(fcp, r, 22, a.inFlight ? "Y" : "N");
    });

    // Capability Map (rows 8+): A L0, B L1, C L2 — one row per distinct triple.
    const cap = wb.addWorksheet("Capability Map");
    cap.getRow(7).values = { 1: "L0 Capability", 2: "L1 Capability", 3: "L2 Capability" };
    const triples = new Map<string, { l0: string; l1: string; l2: string }>();
    for (const a of APPS) triples.set(`${a.l0}|${a.l1}|${a.l2}`, { l0: a.l0, l1: a.l1, l2: a.l2 });
    let capRow = 8;
    for (const t of triples.values()) { set(cap, capRow, 1, t.l0); set(cap, capRow, 2, t.l1); set(cap, capRow, 3, t.l2); capRow++; }

    // Weightings Control Panel: all BV/IT questions "Normal" (col K) so family
    // scores equal the answer averages — predictable dispositions.
    const BV_WEIGHT_ROWS = [17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 29];
    const IT_WEIGHT_ROWS = [33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 49, 50, 51, 54, 55, 56, 57, 58, 59, 60];
    const wcp = wb.addWorksheet("Weightings Control Panel");
    [...BV_WEIGHT_ROWS, ...IT_WEIGHT_ROWS].forEach((row) => set(wcp, row, 11, "Normal"));

    // Disposition Control Panel row 7: E optBv, F urgBv, G optIt, H urgIt.
    const dcp = wb.addWorksheet("Disposition Control Panel");
    set(dcp, 7, 5, 3); set(dcp, 7, 6, 2); set(dcp, 7, 7, 3); set(dcp, 7, 8, 2);

    // Heat Map: J1 t1, J3 t2.
    const heat = wb.addWorksheet("Heat Map");
    set(heat, 1, 10, 0.1); set(heat, 3, 10, 0.26);

    // Transposed answer sheets: app id at (idRow, col), answers at (legacyRef row, col).
    const LAYOUT: Record<string, { idRow: number; firstCol: number }> = {
      IT: { idRow: 4, firstCol: 10 }, Business: { idRow: 4, firstCol: 10 },
      Demographics: { idRow: 6, firstCol: 3 }, Finance: { idRow: 4, firstCol: 4 },
    };
    const sheets: Record<string, ExcelJS.Worksheet> = {
      IT: wb.addWorksheet("IT"), Business: wb.addWorksheet("Business"),
      Demographics: wb.addWorksheet("Demographics"), Finance: wb.addWorksheet("Finance"),
    };
    // Non-report IT ratings live on the IT sheet rows 46-49 col H — set "Normal".
    [46, 47, 48, 49].forEach((row) => set(sheets.IT, row, 8, "Normal"));

    // Group question refs by their sheet, and pick a sample value per answerKind.
    const sampleValue = (kind: string, app: SampleApp, i: number): ExcelJS.CellValue | null => {
      switch (kind) {
        case "SCORE_1_5": {
          if (app.profile === "unscored") return null;
          // BV questions score to profile.bv, IT (incl. NR) to profile.it.
          return null; // handled per-family below
        }
        case "TEXT": return `${app.acronym} note ${i}`;
        case "NUMBER": return 100 + i;
        case "CURRENCY": return 25000 + i * 1000;
        case "BOOLEAN": return i % 2 === 0; // exceljs writes a boolean cell
        case "DATE": return "2024-06-15";
        case "OPTION": return null; // skip — avoids option-set mismatches
        default: return null;
      }
    };

    for (const [sheetName, layout] of Object.entries(LAYOUT)) {
      const ws = sheets[sheetName];
      const refs = questionRefs
        .map((q) => ({ ...q, m: q.legacyRef?.match(/^(\w+)!row(\d+)$/) }))
        .filter((q) => q.m && q.m[1] === sheetName)
        .map((q) => ({ code: q.code, row: Number(q.m![2]), kind: q.answerKind }));
      APPS.forEach((app, ai) => {
        const col = layout.firstCol + ai;
        set(ws, layout.idRow, col, app.id); // app id header
        for (const ref of refs) {
          let val: ExcelJS.CellValue | null;
          if (ref.kind === "SCORE_1_5") {
            if (app.profile === "unscored") continue;
            val = ref.code.startsWith("BV_") ? app.profile.bv : app.profile.it;
          } else {
            val = sampleValue(ref.kind, app, ai);
          }
          if (val !== null && val !== undefined) set(ws, ref.row, col, val);
        }
      });
    }

    // Financial Data (rows 2+): A appId, D version, E/L/R/X category totals.
    const fin = wb.addWorksheet("Financial Data");
    fin.getRow(1).values = { 1: "App ID", 4: "Version", 5: "Infrastructure", 12: "App Maintenance", 18: "App Development", 24: "Commercial Software" };
    let finRow = 2;
    APPS.filter((a) => a.inScope).forEach((a) => {
      set(fin, finRow, 1, a.id); set(fin, finRow, 4, "FY24_ACTUAL");
      set(fin, finRow, 5, 50000 + a.id * 5000);
      set(fin, finRow, 12, 30000 + a.id * 3000);
      set(fin, finRow, 18, 20000 + a.id * 2000);
      set(fin, finRow, 24, 15000 + a.id * 1500);
      finRow++;
    });

    const buffer = await wb.xlsx.writeBuffer();
    const bytes = new Uint8Array(buffer as ArrayBuffer);
    writeFileSync(OUT, bytes);
    console.log(`WROTE ${OUT} (${bytes.byteLength} bytes)`);

    // ── SELF-TEST: import into a fresh scratch engagement B ──
    const engB = await createEngagementWithConfig({
      name: `__sample_verify_${Date.now()}`,
      clientName: "Sample Verify Co.",
      source: { kind: "defaults", preset: "NEUTRAL" },
    });
    const memB = await raw.membership.create({
      data: { engagementId: engB.id, clerkUserId: "test:ver", email: "ver@test.local", role: "ENGAGEMENT_LEAD" },
    });
    const ctxB: EngagementContext = { engagementId: engB.id, membershipId: memB.id, role: "ENGAGEMENT_LEAD", readOnly: false, clerkUserId: "test:ver", actorDisplay: "Ver" };
    const dbB = getScopedDb(ctxB);
    const refsB = await dbB.surveyQuestion.findMany({ select: { code: true, legacyRef: true, answerKind: true } });
    const { parseLegacyWorkbook, applyLegacyImport } = await import("../src/lib/legacy-import");
    const parsed = await parseLegacyWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), refsB);
    console.log("PARSE warnings:", parsed.warnings.length ? parsed.warnings : "(none)");
    const summary = await applyLegacyImport(ctxB, dbB, parsed);
    console.log("IMPORT:", JSON.stringify(summary));
    const { recomputeEngagement } = await import("../src/lib/recompute");
    await recomputeEngagement(ctxB, dbB, { strictWorkbookScoring: false });
    const apps = await dbB.application.findMany({
      orderBy: { appNumber: "asc" },
      select: { appNumber: true, name: true, capabilityNodeId: true, override: { select: { disposition: true } }, result: { select: { bvScore: true, itScore: true, computedDisposition: true } } },
    });
    console.log(`APPS ${apps.length} | mapped ${apps.filter((a) => a.capabilityNodeId).length}`);
    for (const a of apps) {
      const d = a.override?.disposition ?? a.result?.computedDisposition ?? "UNKNOWN";
      console.log(`  #${a.appNumber} ${a.name}: BV ${a.result?.bvScore?.toFixed(1) ?? "—"} IT ${a.result?.itScore?.toFixed(1) ?? "—"} → ${d}`);
    }
    console.log("COST RECORDS:", await dbB.costRecord.count());

    // Clean up both scratch engagements.
    await raw.engagement.delete({ where: { id: engA.id } });
    await raw.engagement.delete({ where: { id: engB.id } });
    console.log("CLEANUP: done");
    await raw.$disconnect();
  })();
}
main().catch((e) => { console.error(e); process.exit(1); });
