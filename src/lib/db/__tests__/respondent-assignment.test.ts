import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Security review F1: a Client Respondent may only write to the exact survey
 * templates assigned to them. The guard's assignment predicate is app-level
 * (`assignments: { some }`), so a respondent assigned ONE template on an app
 * can reach the app for ANY template — the action must verify the specific
 * (application, template, membership) assignment. This test proves that
 * discriminating query behaves correctly under a real respondent-scoped client
 * (i.e. `respondentMayWriteTemplate`'s core lookup). Skipped without a DB.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const SLOW = 120_000;

describe.skipIf(!hasDb)("respondent template-assignment discrimination (integration)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let respondentDb: import("../scoped").ScopedDb;
  let applicationId: string;
  let assignedTemplateId: string;
  let unassignedTemplateId: string;

  beforeAll(async () => {
    const { getRawPrisma } = await import("../prisma");
    const { createEngagementWithConfig } = await import("../provision");
    const { getScopedDb } = await import("../scoped");
    const raw = getRawPrisma();

    const engagement = await createEngagementWithConfig({
      name: `__f1_${Date.now()}`,
      clientName: "Test",
      source: { kind: "defaults", preset: "NEUTRAL" },
    });
    const membership = await raw.membership.create({
      data: { engagementId: engagement.id, clerkUserId: `test:resp:${Date.now()}`, email: `r+${Date.now()}@t.local`, role: "CLIENT_RESPONDENT" },
    });
    const app = await raw.application.create({ data: { engagementId: engagement.id, appNumber: 1, name: "App" } });
    applicationId = app.id;

    const templates = await raw.surveyTemplate.findMany({
      where: { engagementId: engagement.id, type: { in: ["IT_HEALTH", "BUSINESS_VALUE"] } },
      orderBy: { type: "asc" },
    });
    assignedTemplateId = templates[0].id;
    unassignedTemplateId = templates[1].id;

    // Assign ONLY the first template to the respondent.
    await raw.surveyAssignment.create({
      data: { engagementId: engagement.id, applicationId: app.id, templateId: assignedTemplateId, membershipId: membership.id },
    });

    respondentDb = getScopedDb({
      engagementId: engagement.id,
      membershipId: membership.id,
      role: "CLIENT_RESPONDENT",
      readOnly: false,
      clerkUserId: membership.clerkUserId!,
      actorDisplay: "R",
    });
    cleanup = async () => {
      await raw.engagement.delete({ where: { id: engagement.id } });
    };
  }, SLOW);

  afterAll(async () => {
    await cleanup?.();
  }, SLOW);

  it("finds the assignment for the assigned template", async () => {
    const found = await respondentDb.surveyAssignment.findFirst({
      where: { applicationId, templateId: assignedTemplateId },
      select: { id: true },
    });
    expect(found).not.toBeNull();
  }, SLOW);

  it("does NOT find an assignment for a different template on the same app", async () => {
    const found = await respondentDb.surveyAssignment.findFirst({
      where: { applicationId, templateId: unassignedTemplateId },
      select: { id: true },
    });
    expect(found).toBeNull();
  }, SLOW);
});
