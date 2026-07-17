import type { HeatBucket, HeatThresholds } from "./types";

/** The workbook's exact heat map fills (VBA generate_Heatmap, verified). */
export const HEAT_COLORS = {
  TERMINATE: "#CC0000",
  RETOOL_REDESIGN: "#FFFF00",
  RETAIN: "#00B050",
} as const;

export interface HeatCellCounts {
  /** Apps mapped to this (L1, L2) cell with a KNOWN disposition (≠ Unknown). */
  appCount: number;
  terminateCount: number;
  retoolRedesignCount: number;
}

/**
 * Heat map bucket per (L1, L2) cell (inventory §6, quirk #11 sanctioned
 * simplification: plain strict fraction comparison instead of ROUNDUP(x,1) —
 * identical outcomes at whole-app counts):
 *   red    if terminate/appCount    >  t1          (strict)
 *   yellow if retoolRedesign/appCount > (t2 − t1)  (strict — NOT t2 itself)
 *   green  otherwise
 *   null   when the cell has no known-disposition apps (uncolored)
 */
export function computeHeatBucket(cell: HeatCellCounts, t: HeatThresholds): HeatBucket | null {
  if (cell.appCount === 0) return null;
  if (cell.terminateCount / cell.appCount > t.t1) return "TERMINATE";
  if (cell.retoolRedesignCount / cell.appCount > t.t2 - t.t1) return "RETOOL_REDESIGN";
  return "RETAIN";
}

/**
 * Threshold validation (inventory §6.2): t2 must exceed t1, both fractions in
 * [0, 1]. The workbook's second clause — retool/redesign% + retain% = 100% —
 * is satisfied structurally: retain share is ALWAYS the derived value 1 − t2
 * (never stored or edited independently).
 */
export function validateHeatThresholds(t: HeatThresholds): void {
  if (!Number.isFinite(t.t1) || !Number.isFinite(t.t2)) {
    throw new Error("Heat map thresholds must be finite fractions");
  }
  if (t.t1 < 0 || t.t1 > 1 || t.t2 < 0 || t.t2 > 1) {
    throw new Error("Heat map thresholds must be fractions between 0 and 1");
  }
  if (t.t2 <= t.t1) {
    throw new Error("The Re-Tool/Re-Design/Terminate share (t2) must exceed the Terminate share (t1)");
  }
}

/** Retain share is derived, never stored (workbook 'Heat Map'!J5 = 1 − J3). */
export function retainShare(t: HeatThresholds): number {
  return 1 - t.t2;
}
