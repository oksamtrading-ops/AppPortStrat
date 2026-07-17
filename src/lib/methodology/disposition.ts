import type { Disposition, DispositionOverrideInput, Thresholds, UrgentFlags } from "./types";

const OVERRIDABLE: ReadonlySet<string> = new Set(["REDESIGN", "KEEP_AS_IS", "TERMINATE", "RETOOL"]);

/**
 * 4R disposition (inventory §4, verified — DCP col I). Boundary semantics are
 * `>=`: a score exactly equal to the Optimum threshold counts as "high"
 * (quirk #4, preserved). Comparison uses RAW unrounded scores — display
 * rounding to 1 decimal happens separately.
 */
export function computeDisposition(bvScore: number, itScore: number, t: Thresholds): Disposition {
  if (bvScore === 0 || itScore === 0) return "UNKNOWN";
  if (bvScore < t.optBv && itScore >= t.optIt) return "REDESIGN";
  if (bvScore >= t.optBv && itScore >= t.optIt) return "KEEP_AS_IS";
  if (bvScore < t.optBv && itScore < t.optIt) return "TERMINATE";
  return "RETOOL"; // bvScore >= optBv && itScore < optIt
}

/**
 * Urgent-review flags (inventory §4 row 17, quirk #7): strictly below the
 * urgent threshold AND non-zero (zero = unscored, not "very low"). These are
 * alert counts only — never a fifth disposition.
 */
export function computeUrgentFlags(bvScore: number, itScore: number, t: Thresholds): UrgentFlags {
  return {
    veryLowBv: bvScore > 0 && bvScore < t.urgBv,
    veryLowIt: itScore > 0 && itScore < t.urgIt,
  };
}

/**
 * Final disposition = manual override (Engagement Lead, quirk #8) or the
 * computed value. An override must be one of the four R values (never
 * UNKNOWN — inventory §2.5 lkup_Final_Disposition) and carries a non-empty
 * justification. Both computed and override values are stored; this resolves
 * which one is final.
 */
export function resolveFinalDisposition(
  computed: Disposition,
  override: DispositionOverrideInput | null,
): Disposition {
  if (override === null) return computed;
  if (!OVERRIDABLE.has(override.disposition)) {
    throw new Error(`Disposition override must be one of the four R values, got: ${override.disposition}`);
  }
  if (override.justification.trim().length === 0) {
    throw new Error("A disposition override requires a justification");
  }
  return override.disposition;
}
