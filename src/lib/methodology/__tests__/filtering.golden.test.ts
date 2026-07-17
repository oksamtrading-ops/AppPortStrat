import { describe, it, expect } from "vitest";
import { computeFilterOutcome } from "../filtering";
import type { FilterFlags } from "../types";

function flags(partial: Partial<FilterFlags>): FilterFlags {
  return { inScope: true, isUtilized: true, isReplaced: false, inFlight: false, ...partial };
}

describe("filter cascade — golden tests 15–20 (inventory §5, first match wins)", () => {
  it("golden 15: inScope=N → 'Out of Scope' even if disposition = Terminate", () => {
    const outcome = computeFilterOutcome(flags({ inScope: false }), "TERMINATE");
    expect(outcome.hit).toBe("OUT_OF_SCOPE");
    expect(outcome.analysisCandidate).toBe(false);
  });

  it("golden 16: inScope=Y, isUtilized=N → 'No Longer Utilized'", () => {
    const outcome = computeFilterOutcome(flags({ isUtilized: false }), "KEEP_AS_IS");
    expect(outcome.hit).toBe("NO_LONGER_UTILIZED");
    expect(outcome.analysisCandidate).toBe(false);
  });

  it("golden 17: in scope, utilized, disposition Terminate → 'Terminate' even if isReplaced=Y", () => {
    const outcome = computeFilterOutcome(flags({ isReplaced: true }), "TERMINATE");
    expect(outcome.hit).toBe("TERMINATE");
    expect(outcome.analysisCandidate).toBe(false);
  });

  it("golden 18: in scope, utilized, non-Terminate, isReplaced=Y → 'Replaced'", () => {
    const outcome = computeFilterOutcome(flags({ isReplaced: true }), "KEEP_AS_IS");
    expect(outcome.hit).toBe("REPLACED");
    expect(outcome.analysisCandidate).toBe(false);
  });

  it("golden 19: isReplaced=N, inFlight=Y → 'In Flight'", () => {
    const outcome = computeFilterOutcome(flags({ inFlight: true }), "RETOOL");
    expect(outcome.hit).toBe("IN_FLIGHT");
    expect(outcome.analysisCandidate).toBe(false);
  });

  it("golden 20: no filter hits → status = disposition pass-through, analysisCandidate = true", () => {
    const outcome = computeFilterOutcome(flags({}), "KEEP_AS_IS");
    expect(outcome.hit).toBeNull();
    expect(outcome.statusLabel).toBe("Keep-As-Is");
    expect(outcome.analysisCandidate).toBe(true);
  });

  it("cascade order: Out of Scope beats No Longer Utilized beats Terminate", () => {
    expect(computeFilterOutcome(flags({ inScope: false, isUtilized: false }), "TERMINATE").hit).toBe("OUT_OF_SCOPE");
    expect(computeFilterOutcome(flags({ isUtilized: false }), "TERMINATE").hit).toBe("NO_LONGER_UTILIZED");
  });

  it("In Flight requires isReplaced=N (workbook cascade condition)", () => {
    // isReplaced=Y wins at the Replaced step for a non-Terminate app, even when inFlight=Y.
    const outcome = computeFilterOutcome(flags({ isReplaced: true, inFlight: true }), "KEEP_AS_IS");
    expect(outcome.hit).toBe("REPLACED");
  });
});
