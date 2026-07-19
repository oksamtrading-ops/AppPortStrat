/**
 * Dashboard aggregates (inventory §8, verified COUNTIFS semantics).
 * Pure — the caller supplies the already-scoped rows.
 */

/**
 * Score distribution buckets (Weightings CP E5:I5 / Dashboard rows 41–45):
 * [0,1), [1,2), [2,3), [3,4), [4,5] — the last bucket is closed at the top.
 * The workbook counts scores >= 0, so unscored apps (score 0) land in the
 * first bucket — faithful, and worth knowing when reading the chart.
 */
export function computeScoreDistribution(scores: ReadonlyArray<number>): { buckets: number[]; total: number } {
  const buckets = [0, 0, 0, 0, 0];
  let total = 0;
  for (const score of scores) {
    if (!Number.isFinite(score) || score < 0 || score > 5) continue;
    total += 1;
    if (score >= 4) buckets[4] += 1;
    else buckets[Math.floor(score)] += 1;
  }
  return { buckets, total };
}

export const SCORE_BUCKET_LABELS = ["0–1", "1–2", "2–3", "3–4", "4–5"] as const;
