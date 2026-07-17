import { computeScore, computeNonReportScore, computeFinancialScore } from "./scoring";
import { computeDisposition, computeUrgentFlags, resolveFinalDisposition } from "./disposition";
import { computeFilterOutcome } from "./filtering";
import type {
  AnswerValue,
  Disposition,
  DispositionOverrideInput,
  FilterFlags,
  FilterHit,
  QuestionCode,
  Thresholds,
} from "./types";

export interface PortfolioAppInput {
  applicationId: string;
  flags: FilterFlags;
  itAnswers: ReadonlyMap<QuestionCode, AnswerValue>;
  bvAnswers: ReadonlyMap<QuestionCode, AnswerValue>;
  itNonReportAnswers: ReadonlyMap<QuestionCode, AnswerValue>;
  /** Σ of the four computed Finance subtotals, or null when no cost data. */
  financeGrandTotal: number | null;
  override: DispositionOverrideInput | null;
}

export interface PortfolioSnapshot {
  strictWorkbookScoring: boolean;
  thresholds: Thresholds;
  weights: {
    it: ReadonlyMap<QuestionCode, number>;
    bv: ReadonlyMap<QuestionCode, number>;
    itNonReport: ReadonlyMap<QuestionCode, number>;
  };
  apps: readonly PortfolioAppInput[];
}

export interface PerAppResult {
  applicationId: string;
  itScore: number;
  bvScore: number;
  itPartial: boolean;
  bvPartial: boolean;
  itNonReportScore: number;
  financialScore: number | null;
  computedDisposition: Disposition;
  finalDisposition: Disposition;
  filterHit: FilterHit | null;
  statusLabel: string;
  analysisCandidate: boolean;
  veryLowBv: boolean;
  veryLowIt: boolean;
}

/**
 * Whole-engagement recompute over an in-memory snapshot — the single pure
 * entry point behind recomputeEngagement / recomputeApplication. Nothing
 * above app grain is persisted from this output; portfolio aggregates (heat
 * cells, distributions) are computed on read from the per-app results.
 */
export function computePortfolio(snapshot: PortfolioSnapshot): PerAppResult[] {
  const opts = { strictWorkbookScoring: snapshot.strictWorkbookScoring };

  // Financial Score denominator: max grand total across IN-SCOPE apps (APP-SPEC §4.6).
  let maxGrandTotal = 0;
  for (const app of snapshot.apps) {
    if (app.flags.inScope && app.financeGrandTotal !== null && app.financeGrandTotal > maxGrandTotal) {
      maxGrandTotal = app.financeGrandTotal;
    }
  }

  return snapshot.apps.map((app) => {
    const it = computeScore(snapshot.weights.it, app.itAnswers, opts);
    const bv = computeScore(snapshot.weights.bv, app.bvAnswers, opts);
    const itNonReportScore = computeNonReportScore(snapshot.weights.itNonReport, app.itNonReportAnswers);
    const computedDisposition = computeDisposition(bv.score, it.score, snapshot.thresholds);
    const finalDisposition = resolveFinalDisposition(computedDisposition, app.override);
    const urgent = computeUrgentFlags(bv.score, it.score, snapshot.thresholds);
    const filter = computeFilterOutcome(app.flags, finalDisposition);

    return {
      applicationId: app.applicationId,
      itScore: it.score,
      bvScore: bv.score,
      itPartial: it.isPartial,
      bvPartial: bv.isPartial,
      itNonReportScore,
      financialScore: computeFinancialScore(app.financeGrandTotal, maxGrandTotal),
      computedDisposition,
      finalDisposition,
      filterHit: filter.hit,
      statusLabel: filter.statusLabel,
      analysisCandidate: filter.analysisCandidate,
      veryLowBv: urgent.veryLowBv,
      veryLowIt: urgent.veryLowIt,
    };
  });
}
