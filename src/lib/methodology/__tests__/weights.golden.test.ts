import { describe, it, expect } from "vitest";
import { deriveWeights, RATING_VALUES } from "../weights";

describe("weight derivation — golden test 7 (inventory §3.1)", () => {
  it("ratings [Very important, Very important, N/A, …] → weights [0.5, 0.5, 0, …]", () => {
    const ratings = new Map<string, number>([
      ["a", RATING_VALUES["Very important"]], // 5
      ["b", RATING_VALUES["Very important"]], // 5
      ["c", RATING_VALUES["N/A"]], // 0
      ["d", RATING_VALUES["N/A"]],
    ]);
    const weights = deriveWeights(ratings);
    expect(weights.get("a")).toBeCloseTo(0.5, 10);
    expect(weights.get("b")).toBeCloseTo(0.5, 10);
    expect(weights.get("c")).toBe(0);
    expect(weights.get("d")).toBe(0);
  });

  it("weights always sum to 1 within a family", () => {
    const ratings = new Map<string, number>([
      ["a", 2], // Normal
      ["b", 3], // Somewhat important
      ["c", 4], // Important
      ["d", 5], // Very important
      ["e", 1], // Less important
    ]);
    const weights = deriveWeights(ratings);
    const sum = [...weights.values()].reduce((acc, w) => acc + w, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(weights.get("d")).toBeCloseTo(5 / 15, 10);
  });

  it("all questions N/A → all weights 0 (not NaN)", () => {
    const ratings = new Map<string, number>([
      ["a", 0],
      ["b", 0],
    ]);
    const weights = deriveWeights(ratings);
    expect(weights.get("a")).toBe(0);
    expect(weights.get("b")).toBe(0);
  });

  it("families never share a denominator — derivation is per invocation", () => {
    // Simulates BV (2 questions Very important) and IT (10 questions Very important)
    // derived independently: BV → 0.5 each, IT → 0.1 each (the APS 5.0 sample config).
    const bv = deriveWeights(new Map([["bv1", 5], ["bv2", 5]]));
    const it10 = deriveWeights(new Map(Array.from({ length: 10 }, (_, i) => [`it${i + 1}`, 5])));
    expect(bv.get("bv1")).toBeCloseTo(0.5, 10);
    expect(it10.get("it1")).toBeCloseTo(0.1, 10);
    const bvSum = [...bv.values()].reduce((a, b) => a + b, 0);
    const itSum = [...it10.values()].reduce((a, b) => a + b, 0);
    expect(bvSum).toBeCloseTo(1, 10);
    expect(itSum).toBeCloseTo(1, 10);
  });

  it("rating scale matches Ratings2: N/A=0 … Very important=5", () => {
    expect(RATING_VALUES["N/A"]).toBe(0);
    expect(RATING_VALUES["Less important"]).toBe(1);
    expect(RATING_VALUES["Normal"]).toBe(2);
    expect(RATING_VALUES["Somewhat important"]).toBe(3);
    expect(RATING_VALUES["Important"]).toBe(4);
    expect(RATING_VALUES["Very important"]).toBe(5);
  });
});
