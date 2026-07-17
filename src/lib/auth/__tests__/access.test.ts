import { describe, it, expect } from "vitest";
import { evaluateAccess, type AccessInput } from "../access";

/** Table-driven (role, engagement status, target) → allow/deny/readOnly. */

function clerkInput(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    mode: "clerk",
    engagement: { clerkOrgId: "org_1", status: "ACTIVE" },
    activeOrgId: "org_1",
    clerkOrgRole: "org:consultant",
    membershipRole: null,
    ...overrides,
  };
}

function devInput(overrides: Partial<AccessInput> = {}): AccessInput {
  return {
    mode: "dev",
    engagement: { clerkOrgId: null, status: "ACTIVE" },
    activeOrgId: null,
    clerkOrgRole: null,
    membershipRole: "CONSULTANT",
    ...overrides,
  };
}

describe("engagement access decision", () => {
  it("clerk mode: happy path maps the org role from verified claims", () => {
    const d = evaluateAccess(clerkInput());
    expect(d).toEqual({ ok: true, role: "CONSULTANT", readOnly: false });
  });

  it("clerk mode: engagement without a bound Clerk org is a HARD deny (never skip)", () => {
    expect(evaluateAccess(clerkInput({ engagement: { clerkOrgId: null, status: "ACTIVE" } })).ok).toBe(false);
  });

  it("clerk mode: active org mismatch → deny", () => {
    expect(evaluateAccess(clerkInput({ activeOrgId: "org_OTHER" })).ok).toBe(false);
    expect(evaluateAccess(clerkInput({ activeOrgId: null })).ok).toBe(false);
  });

  it("clerk mode: unmapped org role (incl. Clerk default org:member) → deny", () => {
    expect(evaluateAccess(clerkInput({ clerkOrgRole: "org:member" })).ok).toBe(false);
    expect(evaluateAccess(clerkInput({ clerkOrgRole: null })).ok).toBe(false);
  });

  it("clerk mode: the local membership row is never the role authority", () => {
    // Even if a (stale/forged) local row says LEAD, claims say consultant.
    const d = evaluateAccess(clerkInput({ membershipRole: "ENGAGEMENT_LEAD" }));
    expect(d).toEqual({ ok: true, role: "CONSULTANT", readOnly: false });
  });

  it("dev mode: membership row is the role authority; no membership → deny", () => {
    expect(evaluateAccess(devInput())).toEqual({ ok: true, role: "CONSULTANT", readOnly: false });
    expect(evaluateAccess(devInput({ membershipRole: null })).ok).toBe(false);
  });

  it("missing engagement → deny", () => {
    expect(evaluateAccess(clerkInput({ engagement: null })).ok).toBe(false);
  });

  it("archived and pending-purge engagements yield read-only contexts", () => {
    expect(evaluateAccess(devInput({ engagement: { clerkOrgId: null, status: "ARCHIVED" } }))).toEqual({
      ok: true,
      role: "CONSULTANT",
      readOnly: true,
    });
    expect(evaluateAccess(devInput({ engagement: { clerkOrgId: null, status: "PENDING_PURGE" } }))).toEqual({
      ok: true,
      role: "CONSULTANT",
      readOnly: true,
    });
  });

  it("minRole gate: consultant cannot pass an ENGAGEMENT_LEAD requirement", () => {
    expect(evaluateAccess(devInput({ minRole: "ENGAGEMENT_LEAD" })).ok).toBe(false);
    expect(evaluateAccess(devInput({ membershipRole: "ENGAGEMENT_LEAD", minRole: "ENGAGEMENT_LEAD" })).ok).toBe(true);
    expect(evaluateAccess(devInput({ membershipRole: "CLIENT_VIEWER", minRole: "CLIENT_RESPONDENT" })).ok).toBe(false);
  });
});
