// NOTE: no "server-only" marker — exercised by verification scripts; only route handlers call this in the app.
import ExcelJS from "exceljs";
import type { ScopedDb } from "@/lib/db/scoped";
import { DISPOSITION_LABELS, FILTER_LABELS } from "@/lib/methodology";
import type { Disposition, FilterHit } from "@/lib/methodology";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: "FFFFFFFF" }, bold: true, size: 10 };

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  header: string[],
  rows: Array<Array<string | number | boolean | null>>,
) {
  const sheet = workbook.addWorksheet(name);
  const headerRow = sheet.addRow(header);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  for (const row of rows) {
    // exceljs writes strings as literal strings (never formulas) — no
    // formula-injection surface, values land exactly as stored.
    sheet.addRow(row.map((v) => (v === null ? "" : v)));
  }
  sheet.columns.forEach((column, i) => {
    const lengths = [header[i]?.length ?? 8, ...rows.map((r) => String(r[i] ?? "").length)];
    column.width = Math.min(48, Math.max(10, ...lengths) + 2);
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return sheet;
}

/**
 * The full-dataset engagement export (APP-SPEC §4.12; also the purge exit
 * path). Modern one-row-per-application layout — the transposed 1,000-column
 * sheets do not return.
 */
export async function buildEngagementWorkbook(db: ScopedDb, engagementName: string): Promise<ExcelJS.Workbook> {
  const [applications, nodes, templates, weightings, thresholds, costRecords] = await Promise.all([
    db.application.findMany({
      orderBy: { appNumber: "asc" },
      include: { result: true, override: true },
    }),
    db.capabilityNode.findMany({ orderBy: { name: "asc" } }),
    db.surveyTemplate.findMany({
      include: {
        questions: { orderBy: { orderIndex: "asc" }, select: { id: true, code: true, text: true, section: true } },
        responses: {
          select: {
            applicationId: true,
            status: true,
            answers: { select: { questionId: true, isNA: true, numericValue: true, textValue: true, boolValue: true } },
          },
        },
      },
      orderBy: { type: "asc" },
    }),
    db.questionWeighting.findMany({
      select: { importanceRating: true, question: { select: { code: true, text: true, scoreFamily: true } } },
    }),
    db.thresholdConfig.findFirst(),
    db.costRecord.findMany({ orderBy: [{ fiscalYear: "asc" }, { versionType: "asc" }] }),
  ]);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const chainFor = (nodeId: string | null) => {
    const chain = { l0: "", l1: "", l2: "" };
    let node = nodeId ? nodeById.get(nodeId) : undefined;
    while (node) {
      if (node.level === "L0") chain.l0 = node.name;
      if (node.level === "L1") chain.l1 = node.name;
      if (node.level === "L2") chain.l2 = node.name;
      node = node.parentId ? nodeById.get(node.parentId) : undefined;
    }
    return chain;
  };
  const appNumberById = new Map(applications.map((a) => [a.id, a.appNumber]));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "APS Platform";

  // ── Applications (the MDV) ──
  addSheet(
    workbook,
    "Applications",
    [
      "App #", "Name", "Acronym", "Description", "Type", "L0", "L1", "L2",
      "Business Function Detail", "Target", "Meets Future State", "Action Plan",
      "Action Plan Justification", "Mission Critical", "In Scope", "Is Utilized",
      "Is Replaced", "In Flight", "BV Score", "IT Score", "Non-Report IT Score",
      "Computed Disposition", "Override", "Override Justification", "Filter Status",
      "Analysis Candidate", "Comments",
    ],
    applications.map((app) => {
      const chain = chainFor(app.capabilityNodeId);
      const computed = (app.result?.computedDisposition ?? "UNKNOWN") as Disposition;
      const finalDisposition = (app.override?.disposition as Disposition | undefined) ?? computed;
      return [
        app.appNumber, app.name, app.acronym, app.description, app.applicationType,
        chain.l0, chain.l1, chain.l2, app.businessFunctionDetail, app.target,
        app.meetsFutureState, app.actionPlanAssignment, app.actionPlanJustification,
        app.missionCritical ? "Y" : "N", app.inScope ? "Y" : "N", app.isUtilized ? "Y" : "N",
        app.isReplaced ? "Y" : "N", app.inFlight ? "Y" : "N",
        app.result?.bvScore ?? null, app.result?.itScore ?? null, app.result?.itNonReportScore ?? null,
        DISPOSITION_LABELS[computed],
        app.override ? DISPOSITION_LABELS[app.override.disposition as Disposition] : null,
        app.override?.justification ?? null,
        app.result?.filterHit ? FILTER_LABELS[app.result.filterHit as FilterHit] : DISPOSITION_LABELS[finalDisposition],
        app.result?.analysisCandidate ? "Y" : "N",
        app.comments,
      ];
    }),
  );

  // ── One sheet per survey: apps as rows, questions as columns ──
  for (const template of templates) {
    if (template.questions.length === 0) continue;
    const answersByApp = new Map(template.responses.map((r) => [r.applicationId, r]));
    addSheet(
      workbook,
      template.name.replace(" Survey", "").slice(0, 28),
      ["App #", "Application", "Status", ...template.questions.map((q) => q.text)],
      applications.map((app) => {
        const response = answersByApp.get(app.id);
        const answerByQuestion = new Map((response?.answers ?? []).map((a) => [a.questionId, a]));
        return [
          app.appNumber,
          app.name,
          response?.status ?? "NOT_STARTED",
          ...template.questions.map((q) => {
            const a = answerByQuestion.get(q.id);
            if (!a) return null;
            if (a.isNA) return "N/A";
            if (a.numericValue !== null) return a.numericValue;
            if (a.boolValue !== null) return a.boolValue ? "Yes" : "No";
            return a.textValue;
          }),
        ];
      }),
    );
  }

  // ── Capability model (denormalized, paste-import compatible) ──
  const capRows: Array<[string, string, string]> = [];
  for (const l0 of nodes.filter((n) => n.level === "L0")) {
    const l1s = nodes.filter((n) => n.parentId === l0.id);
    if (l1s.length === 0) capRows.push([l0.name, "", ""]);
    for (const l1 of l1s) {
      const l2s = nodes.filter((n) => n.parentId === l1.id);
      if (l2s.length === 0) capRows.push([l0.name, l1.name, ""]);
      for (const l2 of l2s) capRows.push([l0.name, l1.name, l2.name]);
    }
  }
  addSheet(workbook, "Capabilities", ["L0 Capability", "L1 Capability", "L2 Capability"], capRows);

  // ── Configuration ──
  addSheet(
    workbook,
    "Configuration",
    ["Setting", "Value"],
    [
      ["Optimum Business Value", thresholds?.optBv ?? 3],
      ["Urgent Business Value", thresholds?.urgBv ?? 2],
      ["Optimum IT Health", thresholds?.optIt ?? 3],
      ["Urgent IT Health", thresholds?.urgIt ?? 2],
      ["Heat map T1 (terminate share)", thresholds?.heatT1 ?? 0.1],
      ["Heat map T2 (terminate + re-tool/re-design share)", thresholds?.heatT2 ?? 0.26],
      ...weightings
        .filter((w) => w.question.scoreFamily !== "NONE")
        .map((w): [string, number] => [`Importance: ${w.question.code} — ${w.question.text}`, w.importanceRating]),
    ],
  );

  // ── Fiscal-year cost dataset ──
  if (costRecords.length > 0) {
    addSheet(
      workbook,
      "Cost Data",
      ["App #", "Fiscal Year", "Version", "Category", "Line Item", "Amount"],
      costRecords.map((r) => [
        appNumberById.get(r.applicationId) ?? null,
        r.fiscalYear,
        r.versionType,
        r.category,
        r.lineItem,
        Number(r.amount),
      ]),
    );
  }

  workbook.title = engagementName;
  return workbook;
}
