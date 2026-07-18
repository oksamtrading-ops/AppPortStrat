/**
 * Column statistics for the master grid — the live replacement for the
 * workbook's VBA RefreshStatistics_MDV button (inventory §3.4): Min, Max,
 * Mean, Median, Mode, Count over the currently FILTERED set.
 */

export interface ColumnStats {
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
  /** Null when no value repeats (the workbook shows "N/A"). */
  mode: number | null;
  count: number;
}

export function computeColumnStats(values: ReadonlyArray<number | null | undefined>): ColumnStats {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const count = nums.length;
  if (count === 0) return { min: null, max: null, mean: null, median: null, mode: null, count: 0 };

  const sorted = [...nums].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[count - 1];
  const mean = nums.reduce((a, b) => a + b, 0) / count;
  const median = count % 2 === 1 ? sorted[(count - 1) / 2] : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;

  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) ?? 0) + 1);
  let mode: number | null = null;
  let best = 1; // a value must repeat to be a mode
  for (const [value, f] of freq) {
    if (f > best) {
      best = f;
      mode = value;
    }
  }

  return { min, max, mean, median, mode, count };
}
