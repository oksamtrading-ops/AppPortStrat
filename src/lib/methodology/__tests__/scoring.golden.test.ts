import { describe, it, expect } from "vitest";
import { computeScore, computeCompletion, computeFinancialScore, computeNonReportScore } from "../scoring";
import { computeDisposition } from "../disposition";
import type { AnswerValue } from "../types";

const DEFAULT_OPTS = { strictWorkbookScoring: false };
const STRICT_OPTS = { strictWorkbookScoring: true };

function weightsOf(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries);
}

function answersOf(entries: Array<[string, AnswerValue]>): Map<string, AnswerValue> {
  return new Map(entries);
}

function tenEqualWeights(): Map<string, number> {
  return weightsOf(Array.from({ length: 10 }, (_, i) => [`q${i + 1}`, 0.1]));
}

describe("scoring engine — golden tests (inventory §3.2)", () => {
  it("golden 1: 10 IT questions weighted 0.1 each, all answered 5 → IT score = 5.0", () => {
    const weights = tenEqualWeights();
    const answers = answersOf(Array.from({ length: 10 }, (_, i) => [`q${i + 1}`, 5 as const]));
    const result = computeScore(weights, answers, DEFAULT_OPTS);
    expect(result.score).toBeCloseTo(5.0, 10);
    // IEEE-754: ten 0.1 weights sum to 0.9999999999999999, exactly as Excel computes.
    expect(result.correctionFactor).toBeCloseTo(1, 12);
    expect(result.isPartial).toBe(false);
  });

  it("golden 2: same weights, answers [5,5,5,5,5,4,4,4,3,3] → 4.3", () => {
    const weights = tenEqualWeights();
    const values = [5, 5, 5, 5, 5, 4, 4, 4, 3, 3] as const;
    const answers = answersOf(values.map((v, i) => [`q${i + 1}`, v]));
    const result = computeScore(weights, answers, DEFAULT_OPTS);
    expect(result.score).toBeCloseTo(4.3, 10);
  });

  it("golden 3: two BV questions at 0.5 each, answers 4 and 2 → 3.0", () => {
    const weights = weightsOf([
      ["bv1", 0.5],
      ["bv2", 0.5],
    ]);
    const answers = answersOf([
      ["bv1", 4],
      ["bv2", 2],
    ]);
    const result = computeScore(weights, answers, DEFAULT_OPTS);
    expect(result.score).toBeCloseTo(3.0, 10);
  });

  it("golden 4: weights 0.5/0.3/0.2, middle answered N/A → cf = 1/0.7, score = 3.714…", () => {
    const weights = weightsOf([
      ["a", 0.5],
      ["b", 0.3],
      ["c", 0.2],
    ]);
    const answers = answersOf([
      ["a", 4],
      ["b", "NA"],
      ["c", 3],
    ]);
    const result = computeScore(weights, answers, DEFAULT_OPTS);
    expect(result.correctionFactor).toBeCloseTo(1 / 0.7, 6);
    expect(result.score).toBeCloseTo((0.5 * 4 + 0.2 * 3) * (1 / 0.7), 6);
    expect(result.score).toBeCloseTo(3.714285714, 6);
    // Explicit N/A is a deliberate answer — not a partial survey.
    expect(result.isPartial).toBe(false);
  });

  it("golden 4 (strict mode): explicit N/A renormalizes identically in strict mode", () => {
    const weights = weightsOf([
      ["a", 0.5],
      ["b", 0.3],
      ["c", 0.2],
    ]);
    const answers = answersOf([
      ["a", 4],
      ["b", "NA"],
      ["c", 3],
    ]);
    const result = computeScore(weights, answers, STRICT_OPTS);
    expect(result.correctionFactor).toBeCloseTo(1 / 0.7, 6);
    expect(result.score).toBeCloseTo(3.714285714, 6);
  });

  it("golden 5: correction factor never < 1 — all questions answered → factor = 1", () => {
    const weights = tenEqualWeights();
    const answers = answersOf(Array.from({ length: 10 }, (_, i) => [`q${i + 1}`, 3 as const]));
    expect(computeScore(weights, answers, DEFAULT_OPTS).correctionFactor).toBeGreaterThanOrEqual(1);
    expect(computeScore(weights, answers, DEFAULT_OPTS).correctionFactor).toBeCloseTo(1, 12);
    expect(computeScore(weights, answers, STRICT_OPTS).correctionFactor).toBeCloseTo(1, 12);
  });

  it("golden 6: nothing answered → score 0 → disposition Unknown", () => {
    const weights = tenEqualWeights();
    const answers = answersOf([]);
    const defaultResult = computeScore(weights, answers, DEFAULT_OPTS);
    expect(defaultResult.score).toBe(0);
    expect(Number.isFinite(defaultResult.correctionFactor)).toBe(true);
    const strictResult = computeScore(weights, answers, STRICT_OPTS);
    expect(strictResult.score).toBe(0);

    const thresholds = { optBv: 3.0, urgBv: 2.0, optIt: 3.0, urgIt: 2.0 };
    expect(computeDisposition(defaultResult.score, 4.2, thresholds)).toBe("UNKNOWN");
    expect(computeDisposition(4.2, defaultResult.score, thresholds)).toBe("UNKNOWN");
  });

  it("all questions answered explicit N/A → cf 0, score 0 (workbook IFERROR), never NaN/Infinity", () => {
    const weights = weightsOf([
      ["a", 0.6],
      ["b", 0.4],
    ]);
    const answers = answersOf([
      ["a", "NA"],
      ["b", "NA"],
    ]);
    for (const opts of [DEFAULT_OPTS, STRICT_OPTS]) {
      const result = computeScore(weights, answers, opts);
      expect(result.score).toBe(0);
      expect(result.correctionFactor).toBe(0);
      expect(Number.isNaN(result.score)).toBe(false);
    }
  });

  it("golden 8 (strict): unanswered contributes 0 and its weight stays in the denominator (legacy deflation)", () => {
    // 10 questions weighted 0.1; five answered 5, five unanswered.
    const weights = tenEqualWeights();
    const answers = answersOf(Array.from({ length: 5 }, (_, i) => [`q${i + 1}`, 5 as const]));
    const result = computeScore(weights, answers, STRICT_OPTS);
    // SUMIF over "<>N/A" includes blanks → denominator = 1.0 → cf = max(1/1, 1) = 1 → score deflated to 2.5.
    expect(result.correctionFactor).toBeCloseTo(1, 12);
    expect(result.score).toBeCloseTo(2.5, 10);
    expect(result.isPartial).toBe(true);
  });

  it("golden 8 (default): unanswered treated as N/A — renormalized + partial flag", () => {
    const weights = tenEqualWeights();
    const answers = answersOf(Array.from({ length: 5 }, (_, i) => [`q${i + 1}`, 5 as const]));
    const result = computeScore(weights, answers, DEFAULT_OPTS);
    expect(result.correctionFactor).toBeCloseTo(2, 10);
    expect(result.score).toBeCloseTo(5.0, 10);
    expect(result.isPartial).toBe(true);
  });

  it("non-report IT score: plain Σ(w·a), no correction factor, N/A and unanswered contribute 0", () => {
    const weights = weightsOf([
      ["nr1", 0.25],
      ["nr2", 0.25],
      ["nr3", 0.25],
      ["nr4", 0.25],
    ]);
    expect(
      computeNonReportScore(
        weights,
        answersOf([
          ["nr1", 4],
          ["nr2", 4],
          ["nr3", 4],
          ["nr4", 4],
        ]),
      ),
    ).toBeCloseTo(4.0, 10);
    // Two answered, one N/A, one blank → NO renormalization (workbook IT!row 50 has no cf).
    expect(
      computeNonReportScore(
        weights,
        answersOf([
          ["nr1", 4],
          ["nr2", 2],
          ["nr3", "NA"],
        ]),
      ),
    ).toBeCloseTo(0.25 * 4 + 0.25 * 2, 10);
  });

  it("completion: answered numeric ÷ (weighted>0 + always-applicable); explicit N/A does NOT count as answered", () => {
    // APS 5.0-style config: 10 of 24 questions weighted, 4 non-report always applicable.
    const weights = new Map<string, number>();
    for (let i = 1; i <= 24; i++) weights.set(`q${i}`, i <= 10 ? 0.1 : 0);
    const nonReportCodes = ["nr1", "nr2", "nr3", "nr4"];

    // All 10 weighted answered, nothing else → 10 / (10 + 4)
    const answers1 = answersOf(Array.from({ length: 10 }, (_, i) => [`q${i + 1}`, 3 as const]));
    const c1 = computeCompletion({ weights, answers: answers1, alwaysApplicableCodes: nonReportCodes });
    expect(c1.applicableCount).toBe(14);
    expect(c1.answeredCount).toBe(10);
    expect(c1.fraction).toBeCloseTo(10 / 14, 10);

    // An explicit N/A answer is not a numeric answer (Excel COUNT counts numbers only).
    const answers2 = answersOf([
      ["q1", 3],
      ["q2", "NA"],
    ]);
    const c2 = computeCompletion({ weights, answers: answers2, alwaysApplicableCodes: nonReportCodes });
    expect(c2.answeredCount).toBe(1);

    // Answers to zero-weighted questions count in the numerator (workbook COUNT spans all rows).
    const answers3 = answersOf([
      ["q11", 3],
      ["nr1", 2],
    ]);
    const c3 = computeCompletion({ weights, answers: answers3, alwaysApplicableCodes: nonReportCodes });
    expect(c3.answeredCount).toBe(2);
  });

  it("financial score: grandTotal ÷ max across in-scope apps; max 0/absent → null, never NaN", () => {
    expect(computeFinancialScore(50, 200)).toBeCloseTo(0.25, 10);
    expect(computeFinancialScore(200, 200)).toBe(1);
    expect(computeFinancialScore(0, 200)).toBe(0);
    expect(computeFinancialScore(50, 0)).toBeNull();
    expect(computeFinancialScore(null, 200)).toBeNull();
  });
});
