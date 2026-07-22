import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Multi-respondent guard rules (MULTI-RESPONDENT-SURVEYS.md §7), proven against
 * the live DB through role-scoped clients:
 *  - a respondent reaches ONLY their own RESPONDENT-layer response/answers —
 *    never another respondent's, never the consensus (even with explicit filters);
 *  - a respondent's response CREATE is stamped with their own layer identity
 *    regardless of what the caller passes;
 *  - a Client Viewer reads the CONSENSUS layer only (sign-off S3);
 *  - the engagement team reads every layer.
 * Skipped without a DB.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const SLOW = 120_000;

describe.skipIf(!hasDb)("multi-respondent survey layer isolation (integration)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let dbA: import("../scoped").ScopedDb;
  let dbViewer: import("../scoped").ScopedDb;
  let dbLead: import("../scoped").ScopedDb;
  let applicationId: string;
  let templateId: string;
  let responseA: string;
  let responseB: string;
  let consensusId: string;
  let membershipAId: string;

  beforeAll(async () => {
    const { getRawPrisma } = await import("../prisma");
    const { createEngagementWithConfig } = await import("../provision");
    const { getScopedDb } = await import("../scoped");
    const raw = getRawPrisma();
    const stamp = Date.now();

    const engagement = await createEngagementWithConfig({
      name: `__multires_${stamp}`,
      clientName: "Test",
      source: { kind: "defaults", preset: "NEUTRAL" },
    });
    const mk = (role: "ENGAGEMENT_LEAD" | "CLIENT_RESPONDENT" | "CLIENT_VIEWER", tag: string) =>
      raw.membership.create({
        data: { engagementId: engagement.id, clerkUserId: `test:${tag}:${stamp}`, email: `${tag}+${stamp}@t.local`, role },
      });
    const [lead, respA, respB, viewer] = await Promise.all([mk("ENGAGEMENT_LEAD", "lead"), mk("CLIENT_RESPONDENT", "ra"), mk("CLIENT_RESPONDENT", "rb"), mk("CLIENT_VIEWER", "v")]);
    membershipAId = respA.id;

    const app = await raw.application.create({ data: { engagementId: engagement.id, appNumber: 1, name: "App" } });
    applicationId = app.id;
    const template = await raw.surveyTemplate.findFirstOrThrow({ where: { engagementId: engagement.id, type: "IT_HEALTH" } });
    templateId = template.id;

    // Both respondents assigned; one response per layer.
    for (const m of [respA, respB]) {
      await raw.surveyAssignment.create({
        data: { engagementId: engagement.id, applicationId, templateId, membershipId: m.id },
      });
    }
    const mkResp = (kind: "CONSENSUS" | "RESPONDENT", membershipId: string | null) =>
      raw.surveyResponse.create({
        data: { engagementId: engagement.id, applicationId, templateId, kind, respondentMembershipId: membershipId, status: "IN_PROGRESS" },
      });
    responseA = (await mkResp("RESPONDENT", respA.id)).id;
    responseB = (await mkResp("RESPONDENT", respB.id)).id;
    consensusId = (await mkResp("CONSENSUS", null)).id;

    const scoped = (m: { id: string; clerkUserId: string | null }, role: "ENGAGEMENT_LEAD" | "CLIENT_RESPONDENT" | "CLIENT_VIEWER") =>
      getScopedDb({ engagementId: engagement.id, membershipId: m.id, role, readOnly: false, clerkUserId: m.clerkUserId!, actorDisplay: role });
    dbA = scoped(respA, "CLIENT_RESPONDENT");
    dbViewer = scoped(viewer, "CLIENT_VIEWER");
    dbLead = scoped(lead, "ENGAGEMENT_LEAD");

    cleanup = async () => {
      await raw.engagement.delete({ where: { id: engagement.id } });
    };
  }, SLOW);

  afterAll(async () => {
    await cleanup?.();
  }, SLOW);

  it("respondent sees exactly their own response", async () => {
    const rows = await dbA.surveyResponse.findMany({ where: { applicationId, templateId }, select: { id: true } });
    expect(rows.map((r) => r.id)).toEqual([responseA]);
  }, SLOW);

  it("respondent cannot reach the consensus or another respondent's row, even asking explicitly", async () => {
    expect(await dbA.surveyResponse.findFirst({ where: { id: consensusId } })).toBeNull();
    expect(await dbA.surveyResponse.findFirst({ where: { id: responseB } })).toBeNull();
    expect(await dbA.surveyResponse.findFirst({ where: { applicationId, templateId, kind: "CONSENSUS" } })).toBeNull();
  }, SLOW);

  it("respondent creates are stamped with their own layer identity (hostile data ignored)", async () => {
    const raw = (await import("../prisma")).getRawPrisma();
    const template2 = await raw.surveyTemplate.findFirstOrThrow({
      where: { engagementId: (await raw.application.findUniqueOrThrow({ where: { id: applicationId } })).engagementId, type: "BUSINESS_VALUE" },
    });
    await raw.surveyAssignment.create({
      data: { engagementId: template2.engagementId, applicationId, templateId: template2.id, membershipId: membershipAId },
    });
    const created = await dbA.surveyResponse.create({
      // Hostile caller claims the consensus layer — the guard must overwrite both fields.
      data: { engagementId: template2.engagementId, applicationId, templateId: template2.id, kind: "CONSENSUS", status: "IN_PROGRESS" } as never,
      select: { kind: true, respondentMembershipId: true },
    });
    expect(created.kind).toBe("RESPONDENT");
    expect(created.respondentMembershipId).toBe(membershipAId);
  }, SLOW);

  it("viewer reads the consensus layer only (S3)", async () => {
    const rows = await dbViewer.surveyResponse.findMany({ where: { applicationId, templateId }, select: { id: true } });
    expect(rows.map((r) => r.id)).toEqual([consensusId]);
  }, SLOW);

  it("the engagement team reads every layer", async () => {
    const rows = await dbLead.surveyResponse.findMany({ where: { applicationId, templateId }, select: { id: true } });
    expect(rows.map((r) => r.id).sort()).toEqual([responseA, responseB, consensusId].sort());
  }, SLOW);
});
