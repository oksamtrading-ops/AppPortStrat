/**
 * Pure sanitizers for AI tool-call output — NO "server-only" marker so they are
 * unit-testable and safe to reuse client-side. Model output is UNTRUSTED: these
 * coerce every field to its type, clamp lengths and numeric ranges, drop
 * nameless rows, and cap the row count, so a compromised or confused model can't
 * inject oversized/typed-wrong data into the review grids. The extract.ts /
 * capability-map.ts modules keep their server-only API-call code and delegate
 * here for the post-response shaping.
 */

export interface ExtractedApplication {
  name: string;
  description: string | null;
  /** Capability name from the provided tree, or a proposed new one. */
  suggestedCapability: string | null;
  /** True when suggestedCapability matches the engagement's existing tree. */
  capabilityExists: boolean;
  /** 0–100: how certain the extraction is that this is a real application. */
  confidence: number;
  /** Verbatim snippet or visual location the row was derived from. */
  evidence: string;
}

export interface ExtractionResult {
  applications: ExtractedApplication[];
  /** Notes on anything ambiguous or skipped (legends, decorations, unclear labels). */
  notes: string | null;
}

export interface MappingSuggestion {
  appName: string;
  /** Verbatim capability name from the provided tree, or null when nothing fits. */
  capability: string | null;
  confidence: number;
  rationale: string;
}

/** Clamp to an integer in [0, 100]; non-numbers become 0. */
function clampConfidence(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

const MAX_EXTRACTED_APPS = 500;
const MAX_MAPPINGS = 200;

/** Shape the report_extraction tool output into a safe ExtractionResult. */
export function sanitizeExtraction(raw: { applications?: unknown[]; notes?: string }): ExtractionResult {
  const applications: ExtractedApplication[] = (raw.applications ?? [])
    .map((a) => a as Record<string, unknown>)
    .filter((a) => typeof a.name === "string" && (a.name as string).trim().length > 0)
    .slice(0, MAX_EXTRACTED_APPS)
    .map((a) => ({
      name: String(a.name).trim().slice(0, 300),
      description: a.description ? String(a.description).slice(0, 1000) : null,
      suggestedCapability: a.suggestedCapability ? String(a.suggestedCapability).slice(0, 200) : null,
      capabilityExists: Boolean(a.capabilityExists),
      confidence: clampConfidence(a.confidence),
      evidence: String(a.evidence ?? "").slice(0, 500),
    }));
  return { applications, notes: raw.notes ? String(raw.notes).slice(0, 2000) : null };
}

/** Shape the report_mappings tool output into safe MappingSuggestions. */
export function sanitizeMappings(raw: unknown[]): MappingSuggestion[] {
  return raw
    .map((m) => m as Record<string, unknown>)
    .filter((m) => typeof m.appName === "string")
    .slice(0, MAX_MAPPINGS)
    .map((m) => ({
      appName: String(m.appName).slice(0, 300),
      capability: m.capability ? String(m.capability).slice(0, 200) : null,
      confidence: clampConfidence(m.confidence),
      rationale: String(m.rationale ?? "").slice(0, 300),
    }));
}

/** Review-grid gating: ≥90 pre-checked, 60–89 flagged for review, <60 unchecked. */
export function confidenceTier(confidence: number): "high" | "medium" | "low" {
  return confidence >= 90 ? "high" : confidence >= 60 ? "medium" : "low";
}
