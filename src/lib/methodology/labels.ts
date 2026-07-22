import type { Disposition, FilterHit } from "./types";

/**
 * Canonical enum → display labels (quirk #10: one canonical vocabulary in
 * data; display labels configurable per engagement via Engagement.dispositionLabels).
 */
export const DISPOSITION_LABELS: Record<Disposition, string> = {
  UNKNOWN: "Unknown",
  REDESIGN: "Re-Design",
  KEEP_AS_IS: "Keep-As-Is",
  TERMINATE: "Terminate",
  RETOOL: "Re-Tool",
};

/**
 * Canonical 4R disposition → hex color: the single source of truth for the
 * disposition palette in HEX-consuming renderers (SVG donuts/matrix, PPTX).
 * DOM components that need theme-aware Tailwind utilities (the matrix-view dots'
 * `UNKNOWN` uses a theme token; the capability board) keep their own class maps,
 * but those classes are chosen to MIRROR these exact hues — keep them in sync.
 */
export const DISPOSITION_COLORS: Record<Disposition, string> = {
  KEEP_AS_IS: "#16a34a", // green-600
  RETOOL: "#2563eb", // blue-600
  REDESIGN: "#f59e0b", // amber-500
  TERMINATE: "#dc2626", // red-600
  UNKNOWN: "#9ca3af", // gray-400
};

/** Industry synonyms shown alongside (Cover-tab mapping, APP-SPEC §4.7). */
export const DISPOSITION_SYNONYMS: Record<Exclude<Disposition, "UNKNOWN">, string> = {
  KEEP_AS_IS: "Retain",
  RETOOL: "Replace",
  REDESIGN: "Replace",
  TERMINATE: "Retire",
};

export const FILTER_LABELS: Record<FilterHit, string> = {
  OUT_OF_SCOPE: "Out of Scope",
  NO_LONGER_UTILIZED: "No Longer Utilized",
  TERMINATE: "Terminate",
  REPLACED: "Replaced",
  IN_FLIGHT: "In Flight",
};

/** Scores are stored raw and displayed to 1 decimal (CLAUDE.md conventions). */
export function formatScore(score: number | null): string {
  if (score === null) return "—";
  return score.toFixed(1);
}
