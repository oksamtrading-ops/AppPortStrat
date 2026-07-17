import type { AnswerValue, QuestionCode, ScoreResult, ScoringOptions } from "./types";

/**
 * Weighted survey score (inventory §3.2, verified):
 *   score = Σ(weightᵢ × answerᵢ) × correctionFactor
 *   correctionFactor = MAX(1 / Σ(weights in the cf denominator), 1), or 0 when
 *   the denominator is 0 (the workbook's IFERROR(…, 0) wrapper — an all-N/A
 *   survey scores 0, never Infinity/NaN).
 *
 * The two modes differ ONLY in the correction-factor denominator:
 * - default (strictWorkbookScoring=false): weights of answered, non-N/A
 *   questions — unanswered is treated as N/A (excluded + renormalized) and the
 *   result carries isPartial (APP-SPEC §4.6 sanctioned deviation, quirk #3).
 * - strict (true): weights of every question whose answer is not an explicit
 *   N/A, unanswered INCLUDED — the workbook's SUMIF(answers,"<>N/A") counts
 *   blanks, so unanswered questions deflate the score.
 */
export function computeScore(
  weights: ReadonlyMap<QuestionCode, number>,
  answers: ReadonlyMap<QuestionCode, AnswerValue>,
  opts: ScoringOptions,
): ScoreResult {
  let numerator = 0;
  let cfDenominator = 0;
  let answeredCount = 0;
  let applicableCount = 0;
  let isPartial = false;

  for (const [code, weight] of weights) {
    const answer = answers.get(code);
    if (weight > 0) applicableCount += 1;

    if (typeof answer === "number") {
      numerator += weight * answer;
      answeredCount += 1;
      cfDenominator += weight;
    } else if (answer === "NA") {
      // Explicit N/A: excluded from the denominator in BOTH modes (the
      // correction factor's design intent — quirk #2).
    } else {
      // Unanswered.
      if (weight > 0) isPartial = true;
      if (opts.strictWorkbookScoring) cfDenominator += weight;
    }
  }

  const correctionFactor = cfDenominator === 0 ? 0 : Math.max(1 / cfDenominator, 1);
  return {
    score: numerator * correctionFactor,
    correctionFactor,
    isPartial,
    answeredCount,
    applicableCount,
  };
}

/**
 * Non-Report IT Health Score (inventory IT!row 50, quirk #9): plain
 * SUMPRODUCT with NO correction factor. Informational only — never feeds the
 * disposition.
 */
export function computeNonReportScore(
  weights: ReadonlyMap<QuestionCode, number>,
  answers: ReadonlyMap<QuestionCode, AnswerValue>,
): number {
  let sum = 0;
  for (const [code, weight] of weights) {
    const answer = answers.get(code);
    if (typeof answer === "number") sum += weight * answer;
  }
  return sum;
}

export interface CompletionInput {
  weights: ReadonlyMap<QuestionCode, number>;
  answers: ReadonlyMap<QuestionCode, AnswerValue>;
  /** Questions always counted applicable regardless of weight (the IT sheet's 4 non-report rows). */
  alwaysApplicableCodes?: readonly QuestionCode[];
}

export interface CompletionResult {
  answeredCount: number;
  applicableCount: number;
  fraction: number;
}

/**
 * Survey completion (inventory §3.2, workbook-exact, no 2% floor — quirk #16):
 *   applicable = count(weight > 0) + count(always-applicable)
 *   answered   = numeric answers across ALL questions (Excel COUNT counts
 *                numbers only, so an explicit N/A does NOT count as answered,
 *                and answers to zero-weighted questions DO count).
 */
export function computeCompletion(input: CompletionInput): CompletionResult {
  const alwaysApplicable = input.alwaysApplicableCodes ?? [];
  let applicableCount = alwaysApplicable.length;
  let answeredCount = 0;

  const allCodes = new Set<QuestionCode>([...input.weights.keys(), ...alwaysApplicable]);
  for (const code of allCodes) {
    if ((input.weights.get(code) ?? 0) > 0) applicableCount += 1;
    if (typeof input.answers.get(code) === "number") answeredCount += 1;
  }

  return {
    answeredCount,
    applicableCount,
    fraction: applicableCount === 0 ? 0 : answeredCount / applicableCount,
  };
}

/**
 * Financial Score (inventory Finance!row 53, quirk #1 fixed): the app's grand
 * total (Σ of the four COMPUTED subtotals) ÷ the max grand total across
 * in-scope apps — a 0–1 relative cost index. Null when the app has no cost
 * data or no in-scope app has a positive grand total (never NaN).
 */
export function computeFinancialScore(grandTotal: number | null, maxGrandTotal: number): number | null {
  if (grandTotal === null || !Number.isFinite(grandTotal)) return null;
  if (!Number.isFinite(maxGrandTotal) || maxGrandTotal <= 0) return null;
  return grandTotal / maxGrandTotal;
}
