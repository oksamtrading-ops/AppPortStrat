"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { resolveFinalDisposition } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";
import { recomputeApplication } from "@/lib/recompute";

const schema = z.object({
  engagementId: z.string().min(1),
  applicationId: z.string().min(1),
  disposition: z.enum(["REDESIGN", "KEEP_AS_IS", "TERMINATE", "RETOOL"]).nullable(),
  justification: z.string().trim().max(2000).optional(),
});

/**
 * Set or clear an Engagement Lead's disposition override (quirk #8; golden
 * test 14). Both computed and override values are stored — the override lives
 * in its own table so recomputes can never destroy it.
 */
export async function setDispositionOverride(input: z.infer<typeof schema>) {
  const parsed = schema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const application = await db.application.findUnique({
    where: { id: parsed.applicationId },
    include: { override: true },
  });
  if (!application) throw new Error("Unknown application");

  if (parsed.disposition === null) {
    if (application.override) {
      await db.dispositionOverride.delete({ where: { id: application.override.id } });
      await writeAudit(db, ctx, {
        action: "disposition.override.clear",
        entityType: "Application",
        entityId: application.id,
        before: { disposition: application.override.disposition, justification: application.override.justification },
      });
    }
  } else {
    // Pure-engine validation: 4R values only, justification required.
    resolveFinalDisposition("UNKNOWN", {
      disposition: parsed.disposition,
      justification: parsed.justification ?? "",
    });
    await db.dispositionOverride.upsert({
      where: { applicationId_engagementId: { applicationId: application.id, engagementId: ctx.engagementId } },
      create: {
        engagementId: ctx.engagementId,
        applicationId: application.id,
        disposition: parsed.disposition,
        justification: parsed.justification ?? "",
        authorId: ctx.membershipId,
      },
      update: {
        disposition: parsed.disposition,
        justification: parsed.justification ?? "",
        authorId: ctx.membershipId,
      },
    });
    await writeAudit(db, ctx, {
      action: "disposition.override.set",
      entityType: "Application",
      entityId: application.id,
      before: application.override
        ? { disposition: application.override.disposition, justification: application.override.justification }
        : null,
      after: { disposition: parsed.disposition, justification: parsed.justification },
    });
  }

  // The final disposition feeds the filter cascade — recompute this app.
  await recomputeApplication(ctx, db, engagement, application.id);
  revalidatePath(`/e/${ctx.engagementId}/applications`);
  return { ok: true as const };
}
