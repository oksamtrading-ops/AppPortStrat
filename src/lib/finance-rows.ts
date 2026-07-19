// NOTE: no "server-only" marker — exercised by verification scripts; only server code imports this.
import type { ScopedDb } from "@/lib/db/scoped";
import type { Disposition } from "@/lib/methodology";
import { GRAND_TOTAL_SECTIONS } from "@/lib/finance";

/**
 * Shared per-application TCO rows from the Finance survey — one source of
 * truth for the Financials page and the dashboard's cost strip. Grand total =
 * Σ of the four computed section subtotals (workbook quirk #1 resolution);
 * the Financial Score denominator is the max grand total across IN-SCOPE
 * apps (quirk #13). Costs are context only — never an input to disposition.
 */

export interface AppCostRow {
  appId: string;
  appNumber: number;
  name: string;
  inScope: boolean;
  isUtilized: boolean;
  capabilityNodeId: string | null;
  /** Section → subtotal, only for the four grand-total sections. */
  subtotals: Map<string, number>;
  grandTotal: number;
  hasCosts: boolean;
  finalDisposition: Disposition;
}

export interface FinanceRows {
  rows: AppCostRow[];
  /** Rows with at least one Finance answer. */
  costed: AppCostRow[];
  maxGrandTotal: number;
  totalCost: number;
  /** Terminate cost + cost of in-scope apps no longer utilized. */
  savingsCandidate: number;
  costOf: (d: Disposition) => number;
}

export async function loadFinanceRows(db: ScopedDb): Promise<FinanceRows> {
  const [financeTemplate, apps] = await Promise.all([
    db.surveyTemplate.findFirst({
      where: { type: "FINANCE" },
      include: { questions: { where: { answerKind: "CURRENCY" }, select: { id: true, section: true } } },
    }),
    db.application.findMany({
      orderBy: { appNumber: "asc" },
      select: {
        id: true,
        appNumber: true,
        name: true,
        inScope: true,
        isUtilized: true,
        capabilityNodeId: true,
        result: { select: { computedDisposition: true } },
        override: { select: { disposition: true } },
        responses: {
          where: { template: { type: "FINANCE" } },
          select: { answers: { select: { questionId: true, numericValue: true } } },
        },
      },
    }),
  ]);

  const sectionByQuestion = new Map((financeTemplate?.questions ?? []).map((q) => [q.id, q.section]));
  const grandSections = [...GRAND_TOTAL_SECTIONS];

  const rows: AppCostRow[] = apps.map((app) => {
    const subtotals = new Map<string, number>();
    for (const answer of app.responses.flatMap((r) => r.answers)) {
      if (answer.numericValue === null) continue;
      const section = sectionByQuestion.get(answer.questionId);
      if (!section || !GRAND_TOTAL_SECTIONS.has(section)) continue;
      subtotals.set(section, (subtotals.get(section) ?? 0) + answer.numericValue);
    }
    const grandTotal = grandSections.reduce((sum, s) => sum + (subtotals.get(s) ?? 0), 0);
    const computed = (app.result?.computedDisposition ?? "UNKNOWN") as Disposition;
    return {
      appId: app.id,
      appNumber: app.appNumber,
      name: app.name,
      inScope: app.inScope,
      isUtilized: app.isUtilized,
      capabilityNodeId: app.capabilityNodeId,
      subtotals,
      grandTotal,
      hasCosts: subtotals.size > 0,
      finalDisposition: ((app.override?.disposition as Disposition | undefined) ?? computed) as Disposition,
    };
  });

  const costed = rows.filter((r) => r.hasCosts);
  const maxGrandTotal = Math.max(0, ...rows.filter((r) => r.inScope).map((r) => r.grandTotal));
  const totalCost = costed.reduce((sum, r) => sum + r.grandTotal, 0);
  const costOf = (d: Disposition) => costed.filter((r) => r.finalDisposition === d).reduce((s, r) => s + r.grandTotal, 0);
  const nluCost = costed.filter((r) => r.inScope && !r.isUtilized).reduce((s, r) => s + r.grandTotal, 0);

  return { rows, costed, maxGrandTotal, totalCost, savingsCandidate: costOf("TERMINATE") + nluCost, costOf };
}
