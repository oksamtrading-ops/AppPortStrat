import { describe, it, expect } from "vitest";
import { sanitizeExtraction, sanitizeMappings, confidenceTier, sanitizeFindings, toQualityAppData, type RawQualityApp } from "../sanitize";

/**
 * AI tool-call output is UNTRUSTED (a prompt-injected or confused model can emit
 * anything). These sanitizers are the boundary before the review grids, so they
 * must coerce types, clamp lengths/ranges, drop nameless rows, and cap counts.
 */

describe("sanitizeExtraction", () => {
  it("drops rows with a missing / non-string / blank name", () => {
    const r = sanitizeExtraction({
      applications: [
        { name: "Real App", confidence: 80, evidence: "box 1" },
        { name: "   ", confidence: 90 }, // whitespace-only
        { confidence: 90 }, // no name
        { name: 42, confidence: 90 }, // non-string name
        { name: "Another", confidence: 50 },
      ],
    });
    expect(r.applications.map((a) => a.name)).toEqual(["Real App", "Another"]);
  });

  it("caps at 500 applications", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ name: `App ${i}`, confidence: 100 }));
    expect(sanitizeExtraction({ applications: many }).applications).toHaveLength(500);
  });

  it("clamps confidence to an integer in [0, 100]; junk becomes 0", () => {
    const r = sanitizeExtraction({
      applications: [
        { name: "a", confidence: 150 },
        { name: "b", confidence: -20 },
        { name: "c", confidence: 87.6 },
        { name: "d", confidence: "not a number" },
        { name: "e" }, // missing
      ],
    });
    expect(r.applications.map((a) => a.confidence)).toEqual([100, 0, 88, 0, 0]);
  });

  it("trims + length-clamps strings and coerces capabilityExists", () => {
    const r = sanitizeExtraction({
      applications: [
        {
          name: `  ${"N".repeat(400)}  `,
          description: "D".repeat(2000),
          suggestedCapability: "C".repeat(500),
          evidence: "E".repeat(1000),
          capabilityExists: 1, // truthy non-boolean
          confidence: 70,
        },
      ],
    });
    const a = r.applications[0];
    expect(a.name).toHaveLength(300); // trimmed then sliced
    expect(a.description).toHaveLength(1000);
    expect(a.suggestedCapability).toHaveLength(200);
    expect(a.evidence).toHaveLength(500);
    expect(a.capabilityExists).toBe(true);
  });

  it("nulls optional fields when absent and handles notes", () => {
    const r = sanitizeExtraction({ applications: [{ name: "x", confidence: 10 }], notes: "N".repeat(3000) });
    expect(r.applications[0].description).toBeNull();
    expect(r.applications[0].suggestedCapability).toBeNull();
    expect(r.notes).toHaveLength(2000);

    expect(sanitizeExtraction({}).applications).toEqual([]);
    expect(sanitizeExtraction({}).notes).toBeNull();
  });
});

describe("sanitizeMappings", () => {
  it("drops non-string appName rows and caps at 200", () => {
    const rows = [
      { appName: "A", capability: "Finance", confidence: 90, rationale: "fits" },
      { capability: "X", confidence: 90 }, // no appName
      ...Array.from({ length: 300 }, (_, i) => ({ appName: `A${i}`, confidence: 50 })),
    ];
    const out = sanitizeMappings(rows);
    expect(out).toHaveLength(200);
    expect(out[0]).toMatchObject({ appName: "A", capability: "Finance", confidence: 90, rationale: "fits" });
  });

  it("keeps capability null when nothing fits and clamps confidence", () => {
    const out = sanitizeMappings([
      { appName: "A", capability: null, confidence: 999, rationale: "" },
      { appName: "B", capability: "", confidence: 40, rationale: "y" }, // empty string -> null
    ]);
    expect(out[0].capability).toBeNull();
    expect(out[0].confidence).toBe(100);
    expect(out[1].capability).toBeNull();
    expect(out[1].confidence).toBe(40);
  });
});

describe("confidenceTier", () => {
  it("gates at 90 (high) and 60 (medium)", () => {
    expect(confidenceTier(100)).toBe("high");
    expect(confidenceTier(90)).toBe("high");
    expect(confidenceTier(89)).toBe("medium");
    expect(confidenceTier(60)).toBe("medium");
    expect(confidenceTier(59)).toBe("low");
    expect(confidenceTier(0)).toBe("low");
  });
});

describe("sanitizeFindings", () => {
  const names = new Set(["Real App", "Other App"]);

  it("drops findings about apps not in the input (hallucination guard)", () => {
    const out = sanitizeFindings(
      [
        { type: "straight-lining", appName: "Real App", finding: "all 3s", evidence: "3,3,3", severity: "high" },
        { type: "contradiction", appName: "Ghost App", finding: "invented", evidence: "none", severity: "high" },
      ],
      names,
    );
    expect(out.map((f) => f.appName)).toEqual(["Real App"]);
  });

  it("discards findings with no finding text or no evidence", () => {
    const out = sanitizeFindings(
      [
        { type: "other", appName: "Real App", finding: "stated", evidence: "", severity: "low" },
        { type: "other", appName: "Real App", finding: "", evidence: "present", severity: "low" },
        { type: "other", appName: "Real App", finding: "kept", evidence: "here", severity: "low" },
      ],
      names,
    );
    expect(out).toHaveLength(1);
    expect(out[0].finding).toBe("kept");
  });

  it("coerces unknown type -> 'other' and unknown severity -> 'low', clamps length, caps at 100", () => {
    const one = sanitizeFindings(
      [{ type: "nonsense", appName: "Other App", finding: "F".repeat(600), evidence: "E", severity: "critical" }],
      names,
    );
    expect(one[0].type).toBe("other");
    expect(one[0].severity).toBe("low");
    expect(one[0].finding).toHaveLength(500);

    const many = Array.from({ length: 150 }, () => ({ type: "other", appName: "Real App", finding: "f", evidence: "e", severity: "low" }));
    expect(sanitizeFindings(many, names)).toHaveLength(100);
  });
});

describe("toQualityAppData", () => {
  const raw: RawQualityApp[] = [
    {
      name: "App One",
      description: "D".repeat(400),
      responses: [
        {
          template: { name: "IT Health" },
          answers: [
            { isNA: false, numericValue: 4, textValue: null, question: { answerKind: "SCORE_1_5" } },
            { isNA: true, numericValue: 5, textValue: null, question: { answerKind: "SCORE_1_5" } }, // N/A -> skipped
            { isNA: false, numericValue: null, textValue: null, question: { answerKind: "SCORE_1_5" } }, // null -> skipped
            { isNA: false, numericValue: null, textValue: "  needs work  ", question: { answerKind: "TEXT" } },
          ],
        },
        {
          template: { name: "Business Value" },
          answers: [{ isNA: false, numericValue: 2, textValue: null, question: { answerKind: "SCORE_1_5" } }],
        },
      ],
    },
  ];

  it("groups 1-5 scores by template, dropping N/A and null", () => {
    const out = toQualityAppData(raw);
    expect(out[0].scores).toEqual({ "IT Health": [4], "Business Value": [2] });
  });

  it("collects trimmed text comments and clamps the description", () => {
    const out = toQualityAppData(raw);
    expect(out[0].comments).toEqual(["needs work"]);
    expect(out[0].description).toHaveLength(300);
  });

  it("caps comments at 10", () => {
    const many: RawQualityApp[] = [
      {
        name: "Wordy",
        description: null,
        responses: [
          {
            template: { name: "IT Health" },
            answers: Array.from({ length: 15 }, (_, i) => ({
              isNA: false,
              numericValue: null,
              textValue: `comment ${i}`,
              question: { answerKind: "TEXT" },
            })),
          },
        ],
      },
    ];
    expect(toQualityAppData(many)[0].comments).toHaveLength(10);
  });
});
