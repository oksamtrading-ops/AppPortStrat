import { describe, it, expect } from "vitest";
import { validateAnswer } from "../answers";

describe("validateAnswer — kind vs value matrix", () => {
  it("SCORE_1_5 accepts integers 1–5 and explicit NA", () => {
    for (const v of [1, 2, 3, 4, 5]) {
      const r = validateAnswer({ answerKind: "SCORE_1_5" }, v);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.numericValue).toBe(v);
    }
    const na = validateAnswer({ answerKind: "SCORE_1_5" }, "NA");
    expect(na.ok).toBe(true);
    if (na.ok) expect(na.value.isNA).toBe(true);
  });

  it("SCORE_1_5 rejects out-of-range, non-integer, and junk", () => {
    for (const v of [0, 6, 3.5, -1, "abc", true, {}]) {
      expect(validateAnswer({ answerKind: "SCORE_1_5" }, v).ok).toBe(false);
    }
  });

  it("TEXT accepts strings, rejects non-strings", () => {
    expect(validateAnswer({ answerKind: "TEXT" }, "hello").ok).toBe(true);
    expect(validateAnswer({ answerKind: "TEXT" }, 42).ok).toBe(false);
  });

  it("NUMBER and CURRENCY accept finite numbers only", () => {
    for (const kind of ["NUMBER", "CURRENCY"] as const) {
      expect(validateAnswer({ answerKind: kind }, 123.45).ok).toBe(true);
      expect(validateAnswer({ answerKind: kind }, Number.NaN).ok).toBe(false);
      expect(validateAnswer({ answerKind: kind }, Number.POSITIVE_INFINITY).ok).toBe(false);
      expect(validateAnswer({ answerKind: kind }, "12").ok).toBe(false);
    }
  });

  it("BOOLEAN accepts booleans only", () => {
    expect(validateAnswer({ answerKind: "BOOLEAN" }, true).ok).toBe(true);
    expect(validateAnswer({ answerKind: "BOOLEAN" }, "true").ok).toBe(false);
  });

  it("DATE accepts ISO date strings, rejects invalid dates", () => {
    expect(validateAnswer({ answerKind: "DATE" }, "2026-07-17").ok).toBe(true);
    expect(validateAnswer({ answerKind: "DATE" }, "not-a-date").ok).toBe(false);
  });

  it("OPTION accepts a listed value and rejects unlisted when options provided", () => {
    const q = { answerKind: "OPTION" as const, allowedOptions: ["Low", "Medium", "High"] };
    expect(validateAnswer(q, "Low").ok).toBe(true);
    expect(validateAnswer(q, "Extreme").ok).toBe(false);
    expect(validateAnswer(q, 3).ok).toBe(false);
  });

  it("every kind accepts explicit NA (surveys allow declining any question)", () => {
    for (const kind of ["SCORE_1_5", "TEXT", "NUMBER", "CURRENCY", "BOOLEAN", "DATE", "OPTION"] as const) {
      const r = validateAnswer({ answerKind: kind }, "NA");
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.isNA).toBe(true);
    }
  });
});
