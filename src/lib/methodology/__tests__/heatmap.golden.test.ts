import { describe, it, expect } from "vitest";
import { computeHeatBucket, validateHeatThresholds, HEAT_COLORS } from "../heatmap";

const T = { t1: 0.1, t2: 0.26 };

function cell(appCount: number, terminateCount: number, retoolRedesignCount: number) {
  return { appCount, terminateCount, retoolRedesignCount };
}

describe("heat map bucket — golden tests 21–25 (inventory §6, strict >)", () => {
  it("golden 21: 10 apps, 2 Terminate → red (0.2 > 0.1)", () => {
    expect(computeHeatBucket(cell(10, 2, 0), T)).toBe("TERMINATE");
  });

  it("golden 22: 10 apps, 1 Terminate → not red (0.1 ≯ 0.1, strict)", () => {
    expect(computeHeatBucket(cell(10, 1, 0), T)).not.toBe("TERMINATE");
    expect(computeHeatBucket(cell(10, 1, 0), T)).toBe("RETAIN");
  });

  it("golden 23: 10 apps, 0 Terminate, 2 Re-Tool/Re-Design → yellow (0.2 > t2−t1 = 0.16)", () => {
    expect(computeHeatBucket(cell(10, 0, 2), T)).toBe("RETOOL_REDESIGN");
  });

  it("yellow tests against t2−t1, not t2 (2/10 = 0.2 which is NOT > 0.26)", () => {
    // If an implementation compared against t2 directly, this cell would wrongly be green.
    expect(computeHeatBucket(cell(10, 0, 2), { t1: 0.1, t2: 0.26 })).toBe("RETOOL_REDESIGN");
  });

  it("golden 24: 10 apps, 1 Terminate, 1 Re-Tool → green (neither strict threshold exceeded)", () => {
    expect(computeHeatBucket(cell(10, 1, 1), T)).toBe("RETAIN");
  });

  it("golden 25: 0 known-disposition apps → uncolored", () => {
    expect(computeHeatBucket(cell(0, 0, 0), T)).toBeNull();
  });

  it("colors are exactly the workbook RGBs", () => {
    expect(HEAT_COLORS.TERMINATE).toBe("#CC0000");
    expect(HEAT_COLORS.RETOOL_REDESIGN).toBe("#FFFF00");
    expect(HEAT_COLORS.RETAIN).toBe("#00B050");
  });

  it("config validation: reject t2 ≤ t1", () => {
    expect(() => validateHeatThresholds({ t1: 0.26, t2: 0.1 })).toThrow();
    expect(() => validateHeatThresholds({ t1: 0.1, t2: 0.1 })).toThrow();
    expect(() => validateHeatThresholds({ t1: 0.1, t2: 0.26 })).not.toThrow();
  });

  it("config validation: thresholds are fractions in [0, 1]; retain share is derived 1 − t2", () => {
    expect(() => validateHeatThresholds({ t1: -0.1, t2: 0.26 })).toThrow();
    expect(() => validateHeatThresholds({ t1: 0.1, t2: 1.2 })).toThrow();
  });
});
