import { describe, it, expect } from "vitest";
import { computeScoreDistribution } from "../dashboard";

describe("score distribution buckets (workbook rows 41–45)", () => {
  it("boundaries: bucket edges go to the upper bucket; 4–5 is closed at the top", () => {
    const { buckets, total } = computeScoreDistribution([0, 0.9, 1.0, 2.999, 3.0, 4.0, 5.0]);
    expect(buckets).toEqual([2, 1, 1, 1, 2]);
    expect(total).toBe(7);
  });

  it("unscored (0) lands in the first bucket — faithful to the >=0 COUNTIFS", () => {
    expect(computeScoreDistribution([0, 0]).buckets[0]).toBe(2);
  });

  it("ignores out-of-range garbage", () => {
    const { buckets, total } = computeScoreDistribution([-1, 6, Number.NaN, 2.5]);
    expect(buckets).toEqual([0, 0, 1, 0, 0]);
    expect(total).toBe(1);
  });
});
