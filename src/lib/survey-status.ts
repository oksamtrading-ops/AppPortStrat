/**
 * Derived per-(application, survey) completion for the multi-respondent model
 * (MULTI-RESPONDENT-SURVEYS.md §8). PURE — no I/O; safe in client and server.
 *
 * A survey now has several response rows per application (one per respondent +
 * an optional consensus layer), so every "is this survey done?" surface must
 * collapse them to ONE status rather than counting rows (which would multiply
 * by respondent count — the double-count bug this replaces).
 */
export type ResponseStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";

export interface SurveyLayerRow {
  kind: "CONSENSUS" | "RESPONDENT";
  status: ResponseStatus;
  /** True when the consensus row is finalized (finalizedAt set) — the locked record. */
  finalized?: boolean;
}

/**
 * COMPLETE when the consensus layer is finalized or itself complete (workshop
 * mode), or every respondent that has a row is complete (remote, fully
 * collected). Otherwise IN_PROGRESS if anyone has started, else NOT_STARTED.
 * Assignment materializes a respondent row, so the respondent rows ARE the
 * assigned set — no separate assignment count needed.
 */
export function deriveSurveyStatus(rows: SurveyLayerRow[]): ResponseStatus {
  const consensus = rows.find((r) => r.kind === "CONSENSUS");
  if (consensus && (consensus.finalized || consensus.status === "COMPLETE")) return "COMPLETE";
  const respondents = rows.filter((r) => r.kind === "RESPONDENT");
  if (respondents.length > 0 && respondents.every((r) => r.status === "COMPLETE")) return "COMPLETE";
  if (rows.some((r) => r.status !== "NOT_STARTED")) return "IN_PROGRESS";
  return "NOT_STARTED";
}

/** Respondent coverage for a "N of M respondents complete" caption. */
export function respondentCoverage(rows: SurveyLayerRow[]): { complete: number; total: number } {
  const respondents = rows.filter((r) => r.kind === "RESPONDENT");
  return { complete: respondents.filter((r) => r.status === "COMPLETE").length, total: respondents.length };
}

/**
 * Group flat response rows by a key and derive one status per group — the shape
 * every dashboard/grid surface needs. `keyOf` returns e.g. `${appId}:${tplId}`.
 */
export function deriveStatusByKey<T extends SurveyLayerRow>(
  rows: T[],
  keyOf: (row: T) => string,
): Map<string, ResponseStatus> {
  const grouped = new Map<string, SurveyLayerRow[]>();
  for (const r of rows) {
    const key = keyOf(r);
    let arr = grouped.get(key);
    if (!arr) grouped.set(key, (arr = []));
    arr.push(r);
  }
  const out = new Map<string, ResponseStatus>();
  for (const [key, group] of grouped) out.set(key, deriveSurveyStatus(group));
  return out;
}
