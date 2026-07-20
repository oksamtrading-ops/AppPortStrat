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

  it("respondent can write answers and survey responses (status/first-answer), nothing else", () => {
    expect(() =>
      guardArgs("Answer", "upsert", { where: { id: "ans1" }, create: {}, update: {} }, respondent),
    ).not.toThrow();
    expect(() => guardArgs("SurveyResponse", "update", { where: { id: "r1" }, data: {} }, respondent)).not.toThrow();
    expect(() => guardArgs("SurveyResponse", "create", { data: {} }, respondent)).not.toThrow();
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

describe("F2: respondent include/select cannot traverse into denied models", () => {
  const respondent = ctx({ role: "CLIENT_RESPONDENT", membershipId: "mem_r" });

  it("rejects including a denied relation (scores, overrides, costs)", () => {
    expect(() => guardArgs("Application", "findMany", { include: { result: true } }, respondent)).toThrow(
      TenancyViolationError,
    );
    expect(() => guardArgs("Application", "findMany", { include: { override: true } }, respondent)).toThrow(
      TenancyViolationError,
    );
    expect(() => guardArgs("Application", "findMany", { include: { costRecords: true } }, respondent)).toThrow(
      TenancyViolationError,
    );
  });

  it("rejects reaching other members via SurveyAssignment.membership", () => {
    expect(() => guardArgs("SurveyAssignment", "findMany", { include: { membership: true } }, respondent)).toThrow(
      TenancyViolationError,
    );
  });

  it("allows the relations respondents legitimately traverse", () => {
    expect(() =>
      guardArgs("SurveyAssignment", "findMany", { include: { application: true, template: true } }, respondent),
    ).not.toThrow();
    expect(() => guardArgs("SurveyResponse", "findUnique", { where: { id: "r" }, include: { answers: true } }, respondent)).not.toThrow();
    expect(() =>
      guardArgs("SurveyTemplate", "findFirst", { include: { questions: { include: { anchors: true } } } }, respondent),
    ).not.toThrow();
    expect(() => guardArgs("OptionList", "findMany", { include: { items: true } }, respondent)).not.toThrow();
  });

  it("recurses: a denied model nested under an allowed include is rejected", () => {
    expect(() =>
      guardArgs(
        "Application",
        "findMany",
        { include: { responses: { include: { application: { include: { result: true } } } } } },
        respondent,
      ),
    ).toThrow(TenancyViolationError);
  });

  it("nested relation SELECT is checked; scalar select and _count are fine", () => {
    expect(() => guardArgs("Application", "findMany", { select: { id: true, name: true } }, respondent)).not.toThrow();
    expect(() => guardArgs("Application", "findMany", { select: { _count: true } }, respondent)).not.toThrow();
    expect(() => guardArgs("Application", "findMany", { select: { result: { select: { bvScore: true } } } }, respondent)).toThrow(
      TenancyViolationError,
    );
    expect(() =>
      guardArgs("SurveyResponse", "findMany", { select: { id: true, answers: { select: { numericValue: true } } } }, respondent),
    ).not.toThrow();
  });

  it("unknown/unmapped relation is denied (default-deny)", () => {
    expect(() => guardArgs("Application", "findMany", { include: { madeUpRelation: true } }, respondent)).toThrow(
      TenancyViolationError,
    );
  });

  it("does not restrict includes for non-respondent roles", () => {
    const consultant = ctx({ role: "CONSULTANT" });
    expect(() => guardArgs("Application", "findMany", { include: { result: true, costRecords: true } }, consultant)).not.toThrow();
  });
});

describe("Collaboration C1: comment visibility and notification privacy", () => {
  const base = { engagementId: "eng1", membershipId: "mem1", readOnly: false } as const;
  const lead = { ...base, role: "ENGAGEMENT_LEAD" as const };
  const viewer = { ...base, role: "CLIENT_VIEWER" as const };
  const respondent = { ...base, role: "CLIENT_RESPONDENT" as const };

  it("injects internal:false for Client Viewer comment reads; not for leads", () => {
    const v = guardArgs("Comment", "findMany", { where: { applicationId: "a1" } }, viewer);
    expect(JSON.stringify(v.where)).toContain('"internal":false');
    const l = guardArgs("Comment", "findMany", { where: { applicationId: "a1" } }, lead);
    expect(JSON.stringify(l.where)).not.toContain('"internal"');
  });

  it("restricts Notification reads/updates to the caller's own rows, any role", () => {
    for (const ctx of [lead, viewer]) {
      const r = guardArgs("Notification", "findMany", {}, ctx);
      expect(JSON.stringify(r.where)).toContain('"recipientMembershipId":"mem1"');
    }
    const u = guardArgs("Notification", "updateMany", { where: { readAt: null }, data: { readAt: new Date() } }, lead);
    expect(JSON.stringify(u.where)).toContain('"recipientMembershipId":"mem1"');
  });

  it("allows creating notifications FOR OTHER members (mentions)", () => {
    const c = guardArgs("Notification", "createMany", { data: [{ recipientMembershipId: "mem2", kind: "mention", payload: {} }] }, lead);
    expect(JSON.stringify(c.data)).toContain('"recipientMembershipId":"mem2"');
  });

  it("denies traversal into Notification for everyone, and into Comment for viewers", () => {
    expect(() => guardArgs("Membership", "findMany", { include: { notifications: true } }, lead)).toThrow(/top-level/);
    expect(() => guardArgs("Application", "findMany", { include: { commentThreads: true } }, viewer)).toThrow(/top-level/);
    // Leads may traverse comments (no row rule applies to them).
    expect(() => guardArgs("Application", "findMany", { include: { commentThreads: true } }, lead)).not.toThrow();
    // _count stays allowed for viewers (aggregate only, no row data).
    expect(() => guardArgs("Application", "findMany", { select: { name: true, _count: { select: { commentThreads: true } } } }, viewer)).not.toThrow();
  });

  it("denies respondents any comment/notification access", () => {
    expect(() => guardArgs("Comment", "findMany", {}, respondent)).toThrow(/cannot access/);
    expect(() => guardArgs("Notification", "findMany", {}, respondent)).toThrow(/cannot access/);
  });

  it("denies Client Viewers reading AuditEvent (payloads carry emails/justifications)", () => {
    expect(() => guardArgs("AuditEvent", "findMany", {}, viewer)).toThrow(/cannot access/);
    // Consultants/leads still read it (their audit + activity pages).
    expect(() => guardArgs("AuditEvent", "findMany", {}, lead)).not.toThrow();
  });

  // ── C3: capability comments + disposition sign-off ──

  it("applies the viewer comment rules to capability comments too", () => {
    // Row predicate on top-level reads targeting a capability thread.
    const v = guardArgs("Comment", "findMany", { where: { capabilityNodeId: "cap1" } }, viewer);
    expect(JSON.stringify(v.where)).toContain('"internal":false');
    // Traversal via CapabilityNode.commentThreads is denied for viewers, open for leads.
    expect(() => guardArgs("CapabilityNode", "findMany", { include: { commentThreads: true } }, viewer)).toThrow(/top-level/);
    expect(() => guardArgs("CapabilityNode", "findMany", { include: { commentThreads: true } }, lead)).not.toThrow();
  });

  it("scopes DispositionSignOff like any tenant model; viewers read-only; respondents denied", () => {
    const r = guardArgs("DispositionSignOff", "findMany", {}, viewer);
    expect(JSON.stringify(r.where)).toContain('"engagementId":"eng1"');
    expect(() =>
      guardArgs("DispositionSignOff", "create", { data: { applicationId: "a1", disposition: "TERMINATE", signedByMembershipId: "mem1" } }, viewer),
    ).toThrow(/read-only/);
    expect(() => guardArgs("DispositionSignOff", "findMany", {}, respondent)).toThrow(/cannot access/);
    // Lead upsert keyed on the composite unique gets the tenancy scope spread in.
    const u = guardArgs(
      "DispositionSignOff",
      "upsert",
      {
        where: { applicationId_engagementId: { applicationId: "a1", engagementId: "eng1" } },
        create: { applicationId: "a1", disposition: "TERMINATE", signedByMembershipId: "mem1" },
        update: { disposition: "TERMINATE" },
      },
      lead,
    );
    expect(JSON.stringify(u.create)).toContain('"engagementId":"eng1"');
    // Foreign-engagement selector is rejected outright.
    expect(() =>
      guardArgs(
        "DispositionSignOff",
        "findUnique",
        { where: { applicationId_engagementId: { applicationId: "a1", engagementId: "OTHER" } } },
        lead,
      ),
    ).toThrow(/Foreign engagementId/);
  });
});
