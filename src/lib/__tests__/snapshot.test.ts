import { describe, it, expect } from "vitest";
import { rowsToSnapshot, type SnapshotRows } from "../recompute-core";
import { computePortfolio } from "../methodology";

/**
 * The DB-rows → snapshot seam: the place quirk-#3 bugs would actually live.
 * Fixtures include the unanswered-vs-explicit-N/A distinction under both
 * scoring modes.
 */

const THRESHOLDS = { optBv: 3.0, urgBv: 2.0, optIt: 3.0, urgIt: 2.0 };

function baseRows(strict: boolean): SnapshotRows {
  return {
    strictWorkbookScoring: strict,
    thresholds: THRESHOLDS,
    // 10 IT questions Very important (0.1 each), 2 BV Very important (0.5 each).
    weightings: [
      ...Array.from({ length: 10 }, (_, i) => ({
        code: `IT_Q${i + 1}`,
        scoreFamily: "IT" as const,
        importanceRating: 5,
      })),
      { code: "BV_Q1", scoreFamily: "BUSINESS" as const, importanceRating: 5 },
      { code: "BV_Q2", scoreFamily: "BUSINESS" as const, importanceRating: 5 },
      { code: "NR_Q1", scoreFamily: "IT_NON_REPORT" as const, importanceRating: 2 },
    ],
    apps: [
      {
        id: "app_full",
        inScope: true,
        isUtilized: true,
        isReplaced: false,
        inFlight: false,
        override: null,
      },
      {
        id: "app_partial",
        inScope: true,
        isUtilized: true,
        isReplaced: false,
        inFlight: false,
        override: null,
      },
    ],
    answers: [
      // app_full: all 10 IT answered 5; BV answered 4 and 2.
      ...Array.from({ length: 10 }, (_, i) => ({
        applicationId: "app_full",
        code: `IT_Q${i + 1}`,
        scoreFamily: "IT" as const,
        isNA: false,
        numericValue: 5,
      })),
      { applicationId: "app_full", code: "BV_Q1", scoreFamily: "BUSINESS" as const, isNA: false, numericValue: 4 },
      { applicationId: "app_full", code: "BV_Q2", scoreFamily: "BUSINESS" as const, isNA: false, numericValue: 2 },
      // app_partial: 5 of 10 IT answered 5, the rest UNANSWERED (no rows);
      // BV_Q1 explicit N/A, BV_Q2 answered 4.
      ...Array.from({ length: 5 }, (_, i) => ({
        applicationId: "app_partial",
        code: `IT_Q${i + 1}`,
        scoreFamily: "IT" as const,
        isNA: false,
        numericValue: 5,
      })),
      { applicationId: "app_partial", code: "BV_Q1", scoreFamily: "BUSINESS" as const, isNA: true, numericValue: null },
      { applicationId: "app_partial", code: "BV_Q2", scoreFamily: "BUSINESS" as const, isNA: false, numericValue: 4 },
    ],
  };
}

describe("rowsToSnapshot → computePortfolio", () => {
  it("maps answers per app per family; explicit N/A becomes 'NA', missing rows stay unanswered", () => {
    const snapshot = rowsToSnapshot(baseRows(false));
    const partial = snapshot.apps.find((a) => a.applicationId === "app_partial")!;
    expect(partial.bvAnswers.get("BV_Q1")).toBe("NA");
    expect(partial.bvAnswers.get("BV_Q2")).toBe(4);
    expect(partial.itAnswers.size).toBe(5); // 5 unanswered → absent
    expect(snapshot.weights.it.get("IT_Q1")).toBeCloseTo(0.1, 10);
    expect(snapshot.weights.bv.get("BV_Q1")).toBeCloseTo(0.5, 10);
  });

  it("default mode: unanswered renormalizes with a partial flag; explicit N/A renormalizes without one", () => {
    const results = computePortfolio(rowsToSnapshot(baseRows(false)));
    const full = results.find((r) => r.applicationId === "app_full")!;
    expect(full.itScore).toBeCloseTo(5.0, 6);
    expect(full.bvScore).toBeCloseTo(3.0, 6);
    expect(full.itPartial).toBe(false);
    expect(full.computedDisposition).toBe("KEEP_AS_IS"); // 3.0 >= 3.0 boundary

    const partial = results.find((r) => r.applicationId === "app_partial")!;
    expect(partial.itScore).toBeCloseTo(5.0, 6); // renormalized over answered half
    expect(partial.itPartial).toBe(true);
    // BV: explicit N/A on Q1 → renormalize over Q2 only → 4.0, NOT partial.
    expect(partial.bvScore).toBeCloseTo(4.0, 6);
    expect(partial.bvPartial).toBe(false);
  });

  it("strict workbook mode: unanswered deflates (quirk #3 legacy behavior)", () => {
    const results = computePortfolio(rowsToSnapshot(baseRows(true)));
    const partial = results.find((r) => r.applicationId === "app_partial")!;
    expect(partial.itScore).toBeCloseTo(2.5, 6); // 5 × 0.1 × 5, cf = 1
    // Explicit N/A still renormalizes in strict mode (only blanks deflate).
    expect(partial.bvScore).toBeCloseTo(4.0, 6);
    // 2.5 < 3 and 4.0 >= 3 → Re-Tool under strict mode.
    expect(partial.computedDisposition).toBe("RETOOL");
  });

  it("override flows through to the final disposition and the filter cascade", () => {
    const rows = baseRows(false);
    rows.apps[0].override = { disposition: "TERMINATE", justification: "Client mandate" };
    const results = computePortfolio(rowsToSnapshot(rows));
    const full = results.find((r) => r.applicationId === "app_full")!;
    expect(full.computedDisposition).toBe("KEEP_AS_IS"); // computed value preserved
    expect(full.finalDisposition).toBe("TERMINATE"); // override wins
    expect(full.filterHit).toBe("TERMINATE"); // cascade sees the final value
    expect(full.analysisCandidate).toBe(false);
  });

  it("out-of-domain numeric values are treated as unanswered rather than corrupting a score", () => {
    const rows = baseRows(false);
    rows.answers.push({
      applicationId: "app_full",
      code: "NR_Q1",
      scoreFamily: "IT_NON_REPORT",
      isNA: false,
      numericValue: 42,
    });
    const snapshot = rowsToSnapshot(rows);
    const full = snapshot.apps.find((a) => a.applicationId === "app_full")!;
    expect(full.itNonReportAnswers.size).toBe(0);
  });
});
