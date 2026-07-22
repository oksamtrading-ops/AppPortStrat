import { describe, it, expect } from "vitest";
import { deriveSurveyStatus, respondentCoverage, deriveStatusByKey, type SurveyLayerRow } from "../survey-status";

const R = (status: SurveyLayerRow["status"]): SurveyLayerRow => ({ kind: "RESPONDENT", status });
const C = (status: SurveyLayerRow["status"], finalized = false): SurveyLayerRow => ({ kind: "CONSENSUS", status, finalized });

describe("deriveSurveyStatus", () => {
  it("empty → NOT_STARTED", () => {
    expect(deriveSurveyStatus([])).toBe("NOT_STARTED");
  });

  it("finalized consensus → COMPLETE regardless of respondents", () => {
    expect(deriveSurveyStatus([C("IN_PROGRESS", true), R("NOT_STARTED")])).toBe("COMPLETE");
  });

  it("workshop: consensus COMPLETE → COMPLETE", () => {
    expect(deriveSurveyStatus([C("COMPLETE"), R("IN_PROGRESS")])).toBe("COMPLETE");
  });

  it("remote: all respondents COMPLETE → COMPLETE", () => {
    expect(deriveSurveyStatus([R("COMPLETE"), R("COMPLETE")])).toBe("COMPLETE");
  });

  it("remote: not everyone done → IN_PROGRESS (no premature complete)", () => {
    expect(deriveSurveyStatus([R("COMPLETE"), R("IN_PROGRESS")])).toBe("IN_PROGRESS");
    expect(deriveSurveyStatus([R("COMPLETE"), R("NOT_STARTED")])).toBe("IN_PROGRESS");
  });

  it("only NOT_STARTED rows → NOT_STARTED", () => {
    expect(deriveSurveyStatus([R("NOT_STARTED"), C("NOT_STARTED")])).toBe("NOT_STARTED");
  });

  it("workshop-only in progress → IN_PROGRESS", () => {
    expect(deriveSurveyStatus([C("IN_PROGRESS")])).toBe("IN_PROGRESS");
  });

  it("single legacy row behaves like the old one-response model", () => {
    // Migration reclassifies a lone response to one layer; derived status must
    // equal that row's status (COMPLETE consensus was also finalized → still COMPLETE).
    expect(deriveSurveyStatus([R("IN_PROGRESS")])).toBe("IN_PROGRESS");
    expect(deriveSurveyStatus([C("NOT_STARTED")])).toBe("NOT_STARTED");
  });
});

describe("respondentCoverage", () => {
  it("counts complete vs total respondents, ignoring consensus", () => {
    expect(respondentCoverage([C("COMPLETE"), R("COMPLETE"), R("IN_PROGRESS"), R("NOT_STARTED")])).toEqual({ complete: 1, total: 3 });
    expect(respondentCoverage([C("COMPLETE")])).toEqual({ complete: 0, total: 0 });
  });
});

describe("deriveStatusByKey", () => {
  it("groups by key and derives per group", () => {
    type Row = SurveyLayerRow & { app: string; tpl: string };
    const rows: Row[] = [
      { app: "a1", tpl: "IT", kind: "RESPONDENT", status: "COMPLETE" },
      { app: "a1", tpl: "IT", kind: "RESPONDENT", status: "COMPLETE" },
      { app: "a1", tpl: "BV", kind: "RESPONDENT", status: "IN_PROGRESS" },
      { app: "a2", tpl: "IT", kind: "CONSENSUS", status: "NOT_STARTED", finalized: true },
    ];
    const m = deriveStatusByKey(rows, (r) => `${r.app}:${r.tpl}`);
    expect(m.get("a1:IT")).toBe("COMPLETE");
    expect(m.get("a1:BV")).toBe("IN_PROGRESS");
    expect(m.get("a2:IT")).toBe("COMPLETE");
    expect(m.size).toBe(3);
  });
});
