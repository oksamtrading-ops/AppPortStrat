/**
 * Pure sanitizers and data-shaping helpers for the AI modules — NO "server-only"
 * marker so they are unit-testable and safe to reuse client-side. Model output is
 * UNTRUSTED: the sanitize* helpers coerce every field to its type, clamp lengths
 * and numeric ranges, drop malformed rows, and cap the row count, so a compromised
 * or confused model can't inject oversized/typed-wrong data into the review grids
 * (sanitizeFindings additionally enforces grounding + the evidence requirement).
 * The to* helpers shape DB rows into the bundles the prompts reason over. The
 * extract / capability-map / quality modules keep their server-only API-call code
 * and delegate here for the pre-/post-response shaping.
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

export interface QualityFinding {
  type: "straight-lining" | "contradiction" | "possible-duplicate" | "other";
  appName: string;
  finding: string;
  evidence: string;
  severity: "high" | "medium" | "low";
}

export interface QualityAppData {
  name: string;
  description: string | null;
  /** Per survey template: the 1-5 score values in question order. */
  scores: Record<string, number[]>;
  comments: string[];
}

/** The application rows quality.ts reads from the DB, before shaping. */
export interface RawQualityApp {
  name: string;
  description: string | null;
  responses: {
    template: { name: string };
    answers: { isNA: boolean; numericValue: number | null; textValue: string | null; question: { answerKind: string } }[];
  }[];
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

const FINDING_TYPES = new Set(["straight-lining", "contradiction", "possible-duplicate", "other"]);
const SEVERITIES = new Set(["high", "medium", "low"]);
const MAX_FINDINGS = 100;

/**
 * Shape the report_findings tool output into safe QualityFindings. Beyond the
 * usual clamps this enforces two grounding rules in code, not just the prompt:
 *  - a finding's appName MUST be one of the apps we actually sent (drops
 *    hallucinated findings about apps that don't exist in the engagement);
 *  - a finding with no finding text OR no evidence is discarded ("no finding
 *    without evidence").
 */
export function sanitizeFindings(raw: unknown[], appNames: Set<string>): QualityFinding[] {
  return raw
    .map((f) => f as Record<string, unknown>)
    .filter((f) => typeof f.appName === "string" && appNames.has(f.appName as string))
    .slice(0, MAX_FINDINGS)
    .map((f) => ({
      type: (FINDING_TYPES.has(String(f.type)) ? String(f.type) : "other") as QualityFinding["type"],
      appName: String(f.appName),
      finding: String(f.finding ?? "").slice(0, 500),
      evidence: String(f.evidence ?? "").slice(0, 500),
      severity: (SEVERITIES.has(String(f.severity)) ? String(f.severity) : "low") as QualityFinding["severity"],
    }))
    .filter((f) => f.finding && f.evidence);
}

/**
 * Shape raw application+response rows into the per-app score/comment bundle the
 * quality copilot reasons over: 1-5 scores grouped by survey template (N/A and
 * null dropped), free-text comments collected (trimmed, length-clamped, capped).
 */
export function toQualityAppData(apps: RawQualityApp[]): QualityAppData[] {
  return apps.map((a) => {
    const scores: Record<string, number[]> = {};
    const comments: string[] = [];
    for (const r of a.responses) {
      for (const ans of r.answers) {
        if (ans.question.answerKind === "SCORE_1_5" && !ans.isNA && ans.numericValue != null) {
          (scores[r.template.name] ??= []).push(ans.numericValue);
        } else if (ans.question.answerKind === "TEXT" && ans.textValue?.trim()) {
          comments.push(ans.textValue.trim().slice(0, 300));
        }
      }
    }
    return { name: a.name, description: a.description?.slice(0, 300) ?? null, scores, comments: comments.slice(0, 10) };
  });
}
