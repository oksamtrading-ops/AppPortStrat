/**
 * Shared types for the pure methodology core.
 *
 * This module (and every sibling in src/lib/methodology) is PURE: no I/O, no
 * framework imports, no database types. It is the single implementation of the
 * APS workbook's verified formulas (workbook-logic-inventory.md §3–§6).
 */

export type QuestionCode = string;

export type Score15 = 1 | 2 | 3 | 4 | 5;

/** An answer to a scored question: 1–5, explicit N/A, or absent (unanswered). */
export type AnswerValue = Score15 | "NA";

export type Disposition = "UNKNOWN" | "REDESIGN" | "KEEP_AS_IS" | "TERMINATE" | "RETOOL";

/** The four R values a Lead may override to — never UNKNOWN. */
export type OverridableDisposition = Exclude<Disposition, "UNKNOWN">;

export type FilterHit = "OUT_OF_SCOPE" | "NO_LONGER_UTILIZED" | "TERMINATE" | "REPLACED" | "IN_FLIGHT";

export interface Thresholds {
  optBv: number;
  urgBv: number;
  optIt: number;
  urgIt: number;
}

export interface HeatThresholds {
  /** Fraction of a cell's known-disposition apps that must be Terminate (strict >) for red. */
  t1: number;
  /** Terminate + Re-Tool/Re-Design fraction; yellow tests against (t2 − t1). Must exceed t1. */
  t2: number;
}

export type HeatBucket = "TERMINATE" | "RETOOL_REDESIGN" | "RETAIN";

export interface ScoreResult {
  /** 0–5; 0 means unscored → disposition UNKNOWN downstream. */
  score: number;
  correctionFactor: number;
  /** True when at least one weighted (>0) question is unanswered (explicit N/A is an answer). */
  isPartial: boolean;
  answeredCount: number;
  applicableCount: number;
}

export interface ScoringOptions {
  /**
   * false (default): unanswered questions are treated as N/A — excluded and
   * renormalized, with isPartial flagged (APP-SPEC §4.6 deliberate deviation).
   * true: workbook-faithful legacy behavior (quirk #3) — unanswered questions
   * contribute 0 to the numerator while their weight stays in the correction-
   * factor denominator, silently deflating partially-surveyed apps.
   */
  strictWorkbookScoring: boolean;
}

export interface FilterFlags {
  inScope: boolean;
  isUtilized: boolean;
  isReplaced: boolean;
  inFlight: boolean;
}

export interface FilterOutcome {
  /** Null = no filter hit → status displays the disposition (pass-through). */
  hit: FilterHit | null;
  statusLabel: string;
  analysisCandidate: boolean;
}

export interface DispositionOverrideInput {
  disposition: OverridableDisposition;
  justification: string;
}

export interface UrgentFlags {
  veryLowBv: boolean;
  veryLowIt: boolean;
}
