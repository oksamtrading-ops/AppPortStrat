import { describe, it, expect } from "vitest";
import { computeDisposition, computeUrgentFlags, finalDisposition, resolveFinalDisposition } from "../disposition";

const T = { optBv: 3.0, urgBv: 2.0, optIt: 3.0, urgIt: 2.0 };

describe("disposition engine — golden tests 9–14 (inventory §4)", () => {
  it("golden 9: BV 2.9, IT 3.0 → Re-Design", () => {
    expect(computeDisposition(2.9, 3.0, T)).toBe("REDESIGN");
  });

  it("golden 10: BV 3.0, IT 3.0 → Keep-As-Is (>= boundary counts as high)", () => {
    expect(computeDisposition(3.0, 3.0, T)).toBe("KEEP_AS_IS");
  });

  it("golden 11: BV 2.9, IT 2.9 → Terminate", () => {
    expect(computeDisposition(2.9, 2.9, T)).toBe("TERMINATE");
  });

  it("golden 12: BV 3.0, IT 2.9 → Re-Tool", () => {
    expect(computeDisposition(3.0, 2.9, T)).toBe("RETOOL");
  });

  it("golden 13: BV 0 or IT 0 → Unknown, regardless of the other", () => {
    expect(computeDisposition(0, 5.0, T)).toBe("UNKNOWN");
    expect(computeDisposition(5.0, 0, T)).toBe("UNKNOWN");
    expect(computeDisposition(0, 0, T)).toBe("UNKNOWN");
  });

  it("raw unrounded comparison: 2.96 is low-BV even though it displays as 3.0", () => {
    expect(computeDisposition(2.96, 3.0, T)).toBe("REDESIGN");
  });

  it("golden 14 (pure half): override requires a non-empty justification", () => {
    expect(resolveFinalDisposition("TERMINATE", { disposition: "RETOOL", justification: "Client mandate" })).toBe(
      "RETOOL",
    );
    expect(() => resolveFinalDisposition("TERMINATE", { disposition: "RETOOL", justification: "" })).toThrow();
    expect(() => resolveFinalDisposition("TERMINATE", { disposition: "RETOOL", justification: "   " })).toThrow();
  });

  it("golden 14 (pure half): override restricted to the four R values — UNKNOWN rejected", () => {
    expect(() =>
      // @ts-expect-error UNKNOWN is not an overridable disposition
      resolveFinalDisposition("TERMINATE", { disposition: "UNKNOWN", justification: "x" }),
    ).toThrow();
  });

  it("no override → computed passes through", () => {
    expect(resolveFinalDisposition("KEEP_AS_IS", null)).toBe("KEEP_AS_IS");
  });

  it("finalDisposition (read-time): override wins, else computed, else UNKNOWN", () => {
    // Override present → override value (even against a different computed).
    expect(finalDisposition({ override: { disposition: "TERMINATE" }, result: { computedDisposition: "KEEP_AS_IS" } })).toBe("TERMINATE");
    // No override → computed.
    expect(finalDisposition({ override: null, result: { computedDisposition: "RETOOL" } })).toBe("RETOOL");
    // Neither → UNKNOWN (missing rows, unscored app).
    expect(finalDisposition({ override: null, result: null })).toBe("UNKNOWN");
    expect(finalDisposition({})).toBe("UNKNOWN");
    // Null override.disposition is ignored (falls through to computed).
    expect(finalDisposition({ override: { disposition: null }, result: { computedDisposition: "REDESIGN" } })).toBe("REDESIGN");
  });

  it("urgent flags: strictly below urgent threshold AND score ≠ 0 (quirk #7 — alerts only)", () => {
    expect(computeUrgentFlags(1.9, 2.5, T)).toEqual({ veryLowBv: true, veryLowIt: false });
    expect(computeUrgentFlags(2.5, 1.9, T)).toEqual({ veryLowBv: false, veryLowIt: true });
    // Boundary: score equal to the urgent threshold is NOT very low (strict <).
    expect(computeUrgentFlags(2.0, 2.0, T)).toEqual({ veryLowBv: false, veryLowIt: false });
    // Zero = unscored/Unknown, never "very low".
    expect(computeUrgentFlags(0, 0, T)).toEqual({ veryLowBv: false, veryLowIt: false });
  });
});
