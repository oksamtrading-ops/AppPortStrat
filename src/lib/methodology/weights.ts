import type { QuestionCode } from "./types";

/**
 * The workbook's Ratings2 lookup (Lookup!B29:C34): importance label → value.
 * Inventory §3.1, verified.
 */
export const RATING_VALUES = {
  "N/A": 0,
  "Less important": 1,
  Normal: 2,
  "Somewhat important": 3,
  Important: 4,
  "Very important": 5,
} as const;

export type ImportanceLabel = keyof typeof RATING_VALUES;
export type ImportanceRating = (typeof RATING_VALUES)[ImportanceLabel];

export const IMPORTANCE_LABELS: readonly ImportanceLabel[] = [
  "N/A",
  "Less important",
  "Normal",
  "Somewhat important",
  "Important",
  "Very important",
];

/**
 * Weight derivation (Weightings Control Panel, inventory §3.1):
 * weight = rating ÷ Σ(ratings of all questions in the SAME score family).
 *
 * Call once per family (BUSINESS, IT, IT_NON_REPORT) — families never share a
 * denominator. Weights sum to 1 within a family, unless every rating is N/A
 * (sum 0) → all weights 0.
 */
export function deriveWeights(ratings: ReadonlyMap<QuestionCode, number>): Map<QuestionCode, number> {
  let sum = 0;
  for (const rating of ratings.values()) {
    if (!Number.isFinite(rating) || rating < 0) {
      throw new Error(`Invalid importance rating: ${rating}`);
    }
    sum += rating;
  }
  const weights = new Map<QuestionCode, number>();
  for (const [code, rating] of ratings) {
    weights.set(code, sum === 0 ? 0 : rating / sum);
  }
  return weights;
}
