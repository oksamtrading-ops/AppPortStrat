import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * DB half of golden test 14 + recompute safety net (review finding H2):
 * an Engagement Lead's override and justification SURVIVE a full portfolio
 * recompute, and recompute is idempotent. Runs only when DATABASE_URL points
 * at a real Postgres (skipped otherwise — the pure halves are covered in
 * disposition.golden.test.ts and snapshot.test.ts).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

// Hosted Postgres over the network — generous timeouts.
const SLOW = 120_000;

describe.skipIf(!hasDb)("override persistence through recompute (integration)", () => {
  // Imports are lazy so the suite loads without a DATABASE_URL.
  let cleanup: (() => Promise<void>) | null = null;
  let engagementId: string;
  let applicationId: string;
  let ctx: import("../scoped").EngagementContext;
  let db: import("../scoped").ScopedDb;
  let engagementShape: { strictWorkbookScoring: boolean };

  beforeAll(async () => {
    const { getRawPrisma } = await import("../prisma");
    const { createEngagementWithConfig } = await import("../provision");
    const { getScopedDb } = await import("../scoped");
    const raw = getRawPrisma();

    const engagement = await createEngagementWithConfig({
      name: `__test_override_${Date.now()}`,
      clientName: "Test",
      source: { kind: "defaults", preset: "APS50" },
    });
    engagementId = engagement.id;
    engagementShape = { strictWorkbookScoring: engagement.strictWorkbookScoring };

    const membership = await raw.membership.create({
      data: {
        engagementId,
        clerkUserId: `test:lead:${Date.now()}`,
        email: `lead+${Date.now()}@test.local`,
        role: "ENGAGEMENT_LEAD",
      },
    });
    ctx = {
      engagementId,
      membershipId: membership.id,
      role: "ENGAGEMENT_LEAD",
      readOnly: false,
      clerkUserId: membership.clerkUserId!,
      actorDisplay: "Test Lead",
    };
    db = getScopedDb(ctx);

    const app = await raw.application.create({
      data: { engagementId, appNumber: 1, name: "Test App" },
    });
    applicationId = app.id;

    // Answer every weighted question with 4s (KEEP_AS_IS at default thresholds).
    const templates = await raw.surveyTemplate.findMany({
      where: { engagementId, type: { in: ["IT_HEALTH", "BUSINESS_VALUE"] } },
      include: { questions: true },
    });
    for (const template of templates) {
      const response = await raw.surveyResponse.create({
        data: { engagementId, applicationId, templateId: template.id, status: "COMPLETE" },
      });
      await raw.answer.createMany({
        data: template.questions.map((q) => ({
          engagementId,
          responseId: response.id,
          questionId: q.id,
          numericValue: 4,
        })),
      });
    }

    cleanup = async () => {
      await raw.engagement.delete({ where: { id: engagementId } });
    };
  }, SLOW);

  afterAll(async () => {
    await cleanup?.();
  }, SLOW);

  it("stores both computed and override values; override survives threshold change + recompute", async () => {
    const { recomputeEngagement } = await import("@/lib/recompute");

    await recomputeEngagement(ctx, db, engagementShape);
    const computed = await db.dispositionResult.findFirst({ where: { applicationId } });
    expect(computed?.computedDisposition).toBe("KEEP_AS_IS");

    // Lead override with justification (golden test 14).
    await db.dispositionOverride.create({
      data: {
        engagementId,
        applicationId,
        disposition: "TERMINATE",
        justification: "Strategic exit",
        authorId: ctx.membershipId,
      },
    });

    // Threshold change forces a full recompute.
    await db.thresholdConfig.upsert({
      where: { engagementId },
      create: { engagementId, optBv: 4.5, urgBv: 2, optIt: 4.5, urgIt: 2 },
      update: { optBv: 4.5, optIt: 4.5 },
    });
    await recomputeEngagement(ctx, db, engagementShape);

    const result = await db.dispositionResult.findFirst({ where: { applicationId } });
    const override = await db.dispositionOverride.findFirst({ where: { applicationId } });
    expect(result?.computedDisposition).toBe("TERMINATE"); // 4.0 < 4.5 both axes now
    expect(override?.disposition).toBe("TERMINATE"); // authored row untouched
    expect(override?.justification).toBe("Strategic exit");
    // The filter cascade saw the final (overridden) disposition.
    expect(result?.filterHit).toBe("TERMINATE");
  }, SLOW);

  it("recompute is idempotent", async () => {
    const { recomputeEngagement } = await import("@/lib/recompute");
    await recomputeEngagement(ctx, db, engagementShape);
    const first = await db.dispositionResult.findFirst({ where: { applicationId } });
    await recomputeEngagement(ctx, db, engagementShape);
    const second = await db.dispositionResult.findFirst({ where: { applicationId } });
    expect(second?.itScore).toBe(first?.itScore);
    expect(second?.bvScore).toBe(first?.bvScore);
    expect(second?.computedDisposition).toBe(first?.computedDisposition);
    expect(second?.filterHit).toBe(first?.filterHit);
  }, SLOW);
});
