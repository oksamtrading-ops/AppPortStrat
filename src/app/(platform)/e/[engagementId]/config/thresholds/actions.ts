"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { validateHeatThresholds } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";
import { recomputeEngagement } from "@/lib/recompute";
import { adminDb, rateLimit } from "@/lib/db/admin";

const step01 = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .transform((v) => Math.round(v * 10) / 10); // the workbook's 0.1-step spin buttons

const schema = z.object({
  engagementId: z.string().min(1),
  optBv: step01(0, 5),
  urgBv: step01(0, 5),
  optIt: step01(0, 5),
  urgIt: step01(0, 5),
  heatT1: z.number().min(0).max(1),
  heatT2: z.number().min(0).max(1),
  strictWorkbookScoring: z.boolean(),
});

export async function updateThresholds(input: z.infer<typeof schema>) {
  const parsed = schema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  // Each save triggers a full engagement recompute; throttle bursts (generous
  // for interactive editing, but caps a save-spam recompute-DoS).
  if (!(await rateLimit(`recompute:${ctx.membershipId}`, 30, 60)).allowed) {
    throw new Error("Too many configuration changes in a short time — wait a moment and try again.");
  }

  validateHeatThresholds({ t1: parsed.heatT1, t2: parsed.heatT2 });

  const before = await db.thresholdConfig.findFirst();

  await db.thresholdConfig.upsert({
    where: { engagementId: ctx.engagementId },
    create: {
      engagementId: ctx.engagementId,
      optBv: parsed.optBv,
      urgBv: parsed.urgBv,
      optIt: parsed.optIt,
      urgIt: parsed.urgIt,
      heatT1: parsed.heatT1,
      heatT2: parsed.heatT2,
    },
    update: {
      optBv: parsed.optBv,
      urgBv: parsed.urgBv,
      optIt: parsed.optIt,
      urgIt: parsed.urgIt,
      heatT1: parsed.heatT1,
      heatT2: parsed.heatT2,
    },
  });

  // strictWorkbookScoring lives on Engagement (not reachable via the scoped
  // client by design); the Lead check above authorizes this admin write.
  if (engagement.strictWorkbookScoring !== parsed.strictWorkbookScoring) {
    await adminDb().engagement.update({
      where: { id: ctx.engagementId },
      data: { strictWorkbookScoring: parsed.strictWorkbookScoring },
    });
  }

  const stats = await recomputeEngagement(ctx, db, { strictWorkbookScoring: parsed.strictWorkbookScoring });

  await writeAudit(db, ctx, {
    action: "threshold.update",
    entityType: "ThresholdConfig",
    before: before
      ? {
          optBv: before.optBv,
          urgBv: before.urgBv,
          optIt: before.optIt,
          urgIt: before.urgIt,
          heatT1: before.heatT1,
          heatT2: before.heatT2,
          strictWorkbookScoring: engagement.strictWorkbookScoring,
        }
      : null,
    after: {
      optBv: parsed.optBv,
      urgBv: parsed.urgBv,
      optIt: parsed.optIt,
      urgIt: parsed.urgIt,
      heatT1: parsed.heatT1,
      heatT2: parsed.heatT2,
      strictWorkbookScoring: parsed.strictWorkbookScoring,
    },
  });

  return { ok: true as const, ...stats };
}
