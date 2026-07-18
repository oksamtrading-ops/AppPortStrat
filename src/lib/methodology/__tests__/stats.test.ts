import { describe, it, expect } from "vitest";
import { computeColumnStats } from "../stats";

describe("column statistics (MDV stats band)", () => {
  it("computes min/max/mean/median/mode/count", () => {
    const s = computeColumnStats([3, 1, 4, 1, 5]);
    expect(s).toEqual({ min: 1, max: 5, mean: 2.8, median: 3, mode: 1, count: 5 });
  });

  it("even count → median is the midpoint average", () => {
    expect(computeColumnStats([1, 2, 3, 4]).median).toBe(2.5);
  });

  it("mode is null when nothing repeats (workbook shows N/A)", () => {
    expect(computeColumnStats([1, 2, 3]).mode).toBeNull();
  });

  it("nulls and undefined are excluded; empty set yields null stats", () => {
    expect(computeColumnStats([null, undefined, 2, null]).count).toBe(1);
    expect(computeColumnStats([])).toEqual({ min: null, max: null, mean: null, median: null, mode: null, count: 0 });
  });
});
