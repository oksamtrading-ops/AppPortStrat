import { describe, it, expect } from "vitest";
import { guardArgs, TenancyViolationError, type GuardContext } from "../guard";

/**
 * Golden test 26 as a matrix: cross-engagement access is rejected AT THE
 * ACCESS LAYER (pure guard — no database required), plus the role-aware
 * scoping the spec demands (Respondent assignment predicate, Viewer and
 * archived write-deny, append-only audit, default-deny operations).
 */

function ctx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    engagementId: "eng_B",
    membershipId: "mem_1",
    role: "CONSULTANT",
    readOnly: false,
    ...overrides,
  };
}

describe("tenancy guard — golden test 26 matrix", () => {
  it("a query explicitly targeting engagement A under a context for B is rejected, not filtered", () => {
    expect(() => guardArgs("Application", "findMany", { where: { engagementId: "eng_A" } }, ctx())).toThrow(
      TenancyViolationError,
    );
  });

  it("a plain findMany is scoped to the context engagement", () => {
    const args = guardArgs("Application", "findMany", {}, ctx());
    expect(JSON.stringify(args.where)).toContain('"engagementId":"eng_B"');
  });

  it("a foreign engagementId hidden deep in the args tree is rejected", () => {
    expect(() =>
      guardArgs(
        "Answer",
        "create",
        { data: { responseId: "r1", questionId: "q1", response: { connect: { engagementId: "eng_A" } } } },
        ctx(),
      ),
    ).toThrow(TenancyViolationError);
  });

  it("a nested engagement connect to a foreign engagement is rejected", () => {
    expect(() =>
      guardArgs("Application", "create", { data: { name: "X", engagement: { connect: { id: "eng_A" } } } }, ctx()),
    ).toThrow(TenancyViolationError);
  });

  it("create stamps the context engagementId onto the row", () => {
    const args = guardArgs("Application", "create", { data: { name: "X", appNumber: 1 } }, ctx());
    expect((args.data as Record<string, unknown>).engagementId).toBe("eng_B");
  });

  it("createMany stamps every row", () => {
    const args = guardArgs("Application", "createMany", { data: [{ name: "A" }, { name: "B" }] }, ctx());
    for (const row of args.data as Array<Record<string, unknown>>) {
      expect(row.engagementId).toBe("eng_B");
    }
  });

  it("findUnique/update/delete get engagementId as a sibling unique filter", () => {
    for (const op of ["findUnique", "update", "delete"]) {
      const args = guardArgs("Application", op, { where: { id: "app_1" } }, ctx());
      expect((args.where as Record<string, unknown>).engagementId).toBe("eng_B");
    }
  });

  it("upsert scopes both the where and the create payload", () => {
    const args = guardArgs(
      "ThresholdConfig",
      "upsert",
      { where: { engagementId: "eng_B" }, create: { optBv: 3 }, update: { optBv: 3.5 } },
      ctx(),
    );
    expect((args.create as Record<string, unknown>).engagementId).toBe("eng_B");
  });

  it("default-deny: unknown or raw operation shapes are rejected", () => {
    expect(() => guardArgs("Application", "findRaw", {}, ctx())).toThrow(TenancyViolationError);
    expect(() => guardArgs("Application", "aggregateRaw", {}, ctx())).toThrow(TenancyViolationError);
    expect(() => guardArgs("Application", "somethingNew", {}, ctx())).toThrow(TenancyViolationError);
  });

  it("Engagement and question-bank models are unreachable through the scoped client", () => {
    for (const model of ["Engagement", "BankTemplate", "BankQuestion", "BankAnchor"]) {
      expect(() => guardArgs(model, "findMany", {}, ctx())).toThrow(TenancyViolationError);
    }
  });

  it("AuditEvent is append-only: create allowed, update/delete rejected", () => {
    expect(() => guardArgs("AuditEvent", "create", { data: { action: "x" } }, ctx())).not.toThrow();
    for (const op of ["update", "updateMany", "delete", "deleteMany", "upsert"]) {
      expect(() => guardArgs("AuditEvent", op, { where: { id: "a1" } }, ctx())).toThrow(TenancyViolationError);
    }
  });
});

describe("role-aware scoping (spec §2)", () => {
  const respondent = ctx({ role: "CLIENT_RESPONDENT", membershipId: "mem_r" });
  const viewer = ctx({ role: "CLIENT_VIEWER" });

  it("respondent reads of applications carry the assignment predicate", () => {
    const args = guardArgs("Application", "findMany", {}, respondent);
    expect(JSON.stringify(args.where)).toContain('"membershipId":"mem_r"');
  });

  it("respondent reads of answers are confined to assigned applications", () => {
    const args = guardArgs("Answer", "findMany", {}, respondent);
    expect(JSON.stringify(args.where)).toContain('"membershipId":"mem_r"');
  });

  it("respondent cannot read weightings, thresholds, results, costs, memberships, or the audit log", () => {
    for (const model of [
      "QuestionWeighting",
      "ThresholdConfig",
      "DispositionResult",
      "DispositionOverride",
      "CostRecord",
      "Membership",
      "AuditEvent",
    ]) {
      expect(() => guardArgs(model, "findMany", {}, respondent)).toThrow(TenancyViolationError);
    }
  });

  it("respondent can write answers and survey status, nothing else", () => {
    expect(() =>
      guardArgs("Answer", "upsert", { where: { id: "ans1" }, create: {}, update: {} }, respondent),
    ).not.toThrow();
    expect(() => guardArgs("SurveyResponse", "update", { where: { id: "r1" }, data: {} }, respondent)).not.toThrow();
    expect(() => guardArgs("Application", "update", { where: { id: "a1" }, data: {} }, respondent)).toThrow(
      TenancyViolationError,
    );
    expect(() => guardArgs("SurveyQuestion", "update", { where: { id: "q1" }, data: {} }, respondent)).toThrow(
      TenancyViolationError,
    );
  });

  it("respondent unique-where writes carry the assignment predicate", () => {
    const args = guardArgs("Answer", "update", { where: { id: "ans1" }, data: { numericValue: 4 } }, respondent);
    expect(JSON.stringify(args.where)).toContain('"membershipId":"mem_r"');
  });

  it("client viewer is read-only across every model", () => {
    expect(() => guardArgs("Application", "findMany", {}, viewer)).not.toThrow();
    for (const op of ["create", "update", "updateMany", "delete", "deleteMany", "upsert"]) {
      expect(() => guardArgs("Application", op, { where: { id: "a1" }, data: {} }, viewer)).toThrow(
        TenancyViolationError,
      );
    }
  });

  it("archived engagements are read-only for every role", () => {
    const archivedLead = ctx({ role: "ENGAGEMENT_LEAD", readOnly: true });
    expect(() => guardArgs("Application", "findMany", {}, archivedLead)).not.toThrow();
    expect(() => guardArgs("Application", "update", { where: { id: "a1" }, data: {} }, archivedLead)).toThrow(
      TenancyViolationError,
    );
  });
});
