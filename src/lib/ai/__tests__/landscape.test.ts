import { describe, it, expect } from "vitest";
import { buildBriefPrompt, buildLandscapePrompt, type LandscapeBundle } from "../landscape";

const bundle: LandscapeBundle = {
  engagement: { name: "Test Engagement", clientName: "Acme", currency: "USD" },
  counts: { total: 9, inScope: 8, outOfScope: 1, notUtilized: 1, pool: 7, scored: 4 },
  quadrants: { keepAsIs: 1, retool: 1, redesign: 0, terminate: 2, unknown: 3 },
  urgent: { belowBvThreshold: 1, belowItThreshold: 0 },
  missionCritical: [{ name: "GL", disposition: "TERMINATE" }],
  finance: { costedApps: 3, totalAnnualCost: "$1.2M", savingsCandidate: "$400K" },
  hotspots: [{ capability: "Finance", bucket: "red", terminate: 1, transform: 0, scored: 2 }],
  completion: [{ survey: "IT Health Survey", complete: 4, partial: 1, missing: 3 }],
  overridden: 1,
};

describe("AI narrative prompts", () => {
  it("grounds the model: only-provided-figures rule plus the full data bundle", () => {
    for (const p of [buildLandscapePrompt(bundle), buildBriefPrompt(bundle)]) {
      expect(p.system).toMatch(/ONLY the figures provided/);
      expect(p.system).toMatch(/never drive a disposition/);
      expect(p.user).toContain(JSON.stringify(bundle));
      expect(p.user).toContain("Acme");
    }
  });
});
