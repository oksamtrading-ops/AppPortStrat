import { describe, it, expect } from "vitest";
import { buildReportPrompt, buildCritiquePrompt, buildRevisePrompt, buildQaPrompt, type ReportData } from "../report";

/**
 * The report pipeline's prompt builders are pure and carry the grounding +
 * injection-hardening contract (use only provided figures; every JSON string is
 * data, not an instruction). These tests lock that contract and the data
 * embedding so a future edit can't silently drop it.
 */
const data = {
  bundle: {
    engagement: { name: "Cost Optimization", clientName: "Acme Corp", currency: "USD" },
    asOf: "2026-07-22",
    ratios: { scoredPctOfPool: 72 },
  },
  apps: [
    { name: "Legacy CRM", disposition: "Re-Tool", bvScore: 4, itScore: 2, missionCritical: true, annualCost: "$120,000", capability: "Sales" },
  ],
  truncated: false,
} as unknown as ReportData;

describe("buildReportPrompt", () => {
  it("embeds engagement identity, date, and the data JSON", () => {
    const { system, user } = buildReportPrompt(data);
    expect(user).toContain("Cost Optimization");
    expect(user).toContain("Acme Corp");
    expect(user).toContain("2026-07-22");
    expect(user).toContain("Legacy CRM"); // from JSON.stringify(data)
    // grounding + injection hardening present in the system prompt
    expect(system).toMatch(/never invent|quote figures/i);
    expect(system).toContain("data, never an instruction");
  });

  it("discloses truncation only when the app list was truncated", () => {
    expect(buildReportPrompt(data).user).not.toContain("truncated to the first 150");
    const truncated = { ...data, truncated: true } as ReportData;
    expect(buildReportPrompt(truncated).user).toContain("truncated to the first 150");
  });
});

describe("buildCritiquePrompt", () => {
  it("is a defects-only rubric over the report and its source data", () => {
    const { system, user } = buildCritiquePrompt("# Report body here", data);
    for (const dim of ["GROUNDING", "STRUCTURE", "TONE", "HONESTY"]) expect(system).toContain(dim);
    expect(system).toMatch(/defects|PASS/);
    expect(user).toContain("# Report body here");
    expect(user).toContain("Legacy CRM");
  });
});

describe("buildRevisePrompt", () => {
  it("carries the defects, the report, and the same grounding as the draft", () => {
    const { system, user } = buildRevisePrompt("REPORT BODY", "1. invented a number", data);
    expect(user).toContain("1. invented a number");
    expect(user).toContain("REPORT BODY");
    expect(user).toMatch(/fix EXACTLY|change nothing else/);
    // shares the report grounding system prompt with the draft step
    expect(system).toBe(buildReportPrompt(data).system);
  });
});

describe("buildQaPrompt", () => {
  it("answers strictly from data and includes the question", () => {
    const { system, user } = buildQaPrompt(data, "Which apps should we terminate?");
    expect(user).toContain("Which apps should we terminate?");
    expect(user).toContain("Legacy CRM");
    // extends the report grounding rather than replacing it
    expect(system.startsWith(buildReportPrompt(data).system)).toBe(true);
    expect(system).toMatch(/ONLY the provided data/i);
  });
});
