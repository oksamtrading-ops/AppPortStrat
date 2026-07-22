/**
 * Pure DB-rows → PortfolioSnapshot mapping. Factored out of recompute.ts so
 * the seam the methodology golden tests can't see — the row mapping,
 * including the unanswered-vs-explicit-N/A distinction the whole quirk-#3
 * design hinges on — is unit-testable without a database.
 */
import { deriveWeights } from "@/lib/methodology";
import type { AnswerValue, PortfolioSnapshot, Thresholds } from "@/lib/methodology";

export type SnapshotScoreFamily = "BUSINESS" | "IT" | "IT_NON_REPORT" | "NONE";

export interface SnapshotRows {
  strictWorkbookScoring: boolean;
  thresholds: Thresholds;
  weightings: Array<{ code: string; scoreFamily: SnapshotScoreFamily; importanceRating: number }>;
  apps: Array<{
    id: string;
    inScope: boolean;
    isUtilized: boolean;
    isReplaced: boolean;
    inFlight: boolean;
    override: { disposition: "REDESIGN" | "KEEP_AS_IS" | "TERMINATE" | "RETOOL"; justification: string } | null;
    /** Σ of computed Finance subtotals, when cost data exists (Phase 3+). */
    financeGrandTotal?: number | null;
  }>;
  /**
   * AT MOST one row per (application, question) — multi-respondent answer sets
   * are already reduced by aggregateScoredAnswers (consensus ?? respondent
   * mean) before reaching this seam. Unanswered = NO row (quirk #3).
   */
  answers: Array<{
    applicationId: string;
    code: string;
    scoreFamily: SnapshotScoreFamily;
    isNA: boolean;
    numericValue: number | null;
  }>;
}

function toAnswerValue(row: { isNA: boolean; numericValue: number | null }): AnswerValue | null {
  if (row.isNA) return "NA";
  const v = row.numericValue;
  // Raw answers are integers 1–5; multi-respondent MEANS (aggregate.ts) are
  // fractional within the same closed range. Anything else is out-of-domain —
  // treated as unanswered rather than corrupting a score.
  if (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 5) return v;
  return null;
}

export function rowsToSnapshot(rows: SnapshotRows): PortfolioSnapshot {
  const ratingsByFamily: Record<"BUSINESS" | "IT" | "IT_NON_REPORT", Map<string, number>> = {
    BUSINESS: new Map(),
    IT: new Map(),
    IT_NON_REPORT: new Map(),
  };
  for (const w of rows.weightings) {
    if (w.scoreFamily === "NONE") continue;
    ratingsByFamily[w.scoreFamily].set(w.code, w.importanceRating);
  }

  // Families are normalized independently — they never share a denominator.
  const weights = {
    bv: deriveWeights(ratingsByFamily.BUSINESS),
    it: deriveWeights(ratingsByFamily.IT),
    itNonReport: deriveWeights(ratingsByFamily.IT_NON_REPORT),
  };

  const answersByApp = new Map<
    string,
    { it: Map<string, AnswerValue>; bv: Map<string, AnswerValue>; itNonReport: Map<string, AnswerValue> }
  >();
  for (const row of rows.answers) {
    if (row.scoreFamily === "NONE") continue;
    const value = toAnswerValue(row);
    if (value === null) continue;
    let bucket = answersByApp.get(row.applicationId);
    if (!bucket) {
      bucket = { it: new Map(), bv: new Map(), itNonReport: new Map() };
      answersByApp.set(row.applicationId, bucket);
    }
    const map = row.scoreFamily === "BUSINESS" ? bucket.bv : row.scoreFamily === "IT" ? bucket.it : bucket.itNonReport;
    map.set(row.code, value);
  }

  const empty = { it: new Map<string, AnswerValue>(), bv: new Map<string, AnswerValue>(), itNonReport: new Map<string, AnswerValue>() };

  return {
    strictWorkbookScoring: rows.strictWorkbookScoring,
    thresholds: rows.thresholds,
    weights,
    apps: rows.apps.map((app) => {
      const bucket = answersByApp.get(app.id) ?? empty;
      return {
        applicationId: app.id,
        flags: {
          inScope: app.inScope,
          isUtilized: app.isUtilized,
          isReplaced: app.isReplaced,
          inFlight: app.inFlight,
        },
        itAnswers: bucket.it,
        bvAnswers: bucket.bv,
        itNonReportAnswers: bucket.itNonReport,
        financeGrandTotal: app.financeGrandTotal ?? null,
        override: app.override,
      };
    }),
  };
}
