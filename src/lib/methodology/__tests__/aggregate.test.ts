import { describe, it, expect } from "vitest";
import { aggregateScoredAnswers, type ScoredAnswerRow } from "../aggregate";

/**
 * Multi-respondent aggregation (MULTI-RESPONDENT-SURVEYS.md §5):
 * consensus ?? mean(respondents), N/A rules, and — critically — the
 * migration-safety property: one answer row in ⇒ that same row out.
 */

const row = (over: Partial<ScoredAnswerRow>): ScoredAnswerRow => ({
  applicationId: "app1",
  code: "IT_TC_AVAILABILITY",
  scoreFamily: "IT",
  isNA: false,
  numericValue: 3,
  kind: "RESPONDENT",
  ...over,
});

describe("aggregateScoredAnswers", () => {
  it("IDENTITY: a single answer row passes through unchanged (migration safety)", () => {
    // Every pre-migration survey has exactly one response; its answers must
    // aggregate to themselves regardless of which layer they were reclassified into.
    for (const kind of ["CONSENSUS", "RESPONDENT"] as const) {
      for (const values of [
        { isNA: false, numericValue: 1 },
        { isNA: false, numericValue: 5 },
        { isNA: true, numericValue: null },
      ]) {
        const out = aggregateScoredAnswers([row({ kind, ...values })]);
        expect(out).toEqual([
          { applicationId: "app1", code: "IT_TC_AVAILABILITY", scoreFamily: "IT", ...values },
        ]);
      }
    }
  });

  it("averages respondent numeric answers (fractional means allowed)", () => {
    const out = aggregateScoredAnswers([
      row({ numericValue: 3 }),
      row({ numericValue: 4 }),
    ]);
    expect(out).toEqual([expect.objectContaining({ isNA: false, numericValue: 3.5 })]);

    const three = aggregateScoredAnswers([row({ numericValue: 1 }), row({ numericValue: 5 }), row({ numericValue: 3 })]);
    expect(three[0].numericValue).toBe(3);
  });

  it("excludes respondent N/As from the mean; all-N/A → N/A; nothing → unanswered", () => {
    const mixed = aggregateScoredAnswers([row({ numericValue: 4 }), row({ isNA: true, numericValue: null })]);
    expect(mixed).toEqual([expect.objectContaining({ isNA: false, numericValue: 4 })]);

    const allNa = aggregateScoredAnswers([row({ isNA: true, numericValue: null }), row({ isNA: true, numericValue: null })]);
    expect(allNa).toEqual([expect.objectContaining({ isNA: true, numericValue: null })]);

    // A row with neither a value nor N/A contributes nothing → no output row.
    expect(aggregateScoredAnswers([row({ isNA: false, numericValue: null })])).toEqual([]);
  });

  it("consensus wins verbatim over any respondent spread — including consensus N/A", () => {
    const out = aggregateScoredAnswers([
      row({ numericValue: 4 }),
      row({ numericValue: 5 }),
      row({ kind: "CONSENSUS", numericValue: 2 }),
    ]);
    expect(out).toEqual([expect.objectContaining({ isNA: false, numericValue: 2 })]);

    const naWins = aggregateScoredAnswers([
      row({ numericValue: 4 }),
      row({ kind: "CONSENSUS", isNA: true, numericValue: null }),
    ]);
    expect(naWins).toEqual([expect.objectContaining({ isNA: true, numericValue: null })]);
  });

  it("out-of-domain respondent values are excluded from the mean (mirrors the raw-row guard)", () => {
    const out = aggregateScoredAnswers([row({ numericValue: 7 }), row({ numericValue: 3 })]);
    expect(out).toEqual([expect.objectContaining({ numericValue: 3 })]);
    // Only out-of-domain input → nothing usable → unanswered.
    expect(aggregateScoredAnswers([row({ numericValue: 7 })])).toEqual([]);
  });

  it("groups strictly by (application, question)", () => {
    const out = aggregateScoredAnswers([
      row({ applicationId: "app1", code: "Q1", numericValue: 2 }),
      row({ applicationId: "app1", code: "Q1", numericValue: 4 }),
      row({ applicationId: "app1", code: "Q2", numericValue: 5 }),
      row({ applicationId: "app2", code: "Q1", numericValue: 1 }),
    ]);
    const byKey = new Map(out.map((o) => [`${o.applicationId} ${o.code}`, o.numericValue]));
    expect(byKey.get("app1 Q1")).toBe(3);
    expect(byKey.get("app1 Q2")).toBe(5);
    expect(byKey.get("app2 Q1")).toBe(1);
    expect(out).toHaveLength(3);
  });
});
