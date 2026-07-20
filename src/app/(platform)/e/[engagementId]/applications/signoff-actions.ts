"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import type { Disposition } from "@/lib/methodology";

/**
 * Collaboration C3: disposition sign-off — the Lead records that the client
 * agreed to an application's FINAL disposition (typically after a workshop).
 * The agreed value is SNAPSHOTTED; if a later recompute or override changes
 * the live disposition, the UI shows the sign-off as stale instead of silently
 * rewriting what was agreed. Lead-only, audited both ways.
 */

const recordSchema = z.object({
  engagementId: z.string().min(1),
  applicationId: z.string().min(1),
  note: z.string().trim().max(2000).optional(),
});

export async function recordSignOff(
  input: z.infer<typeof recordSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = recordSchema.parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  try {
    const app = await db.application.findUnique({
      where: { id: parsed.applicationId },
      select: {
        id: true,
        name: true,
        result: { select: { computedDisposition: true } },
        override: { select: { disposition: true } },
        signOff: { select: { disposition: true } },
      },
    });
    if (!app) return { ok: false, error: "Unknown application" };

    const final = ((app.override?.disposition as Disposition | undefined) ??
      (app.result?.computedDisposition as Disposition | undefined) ??
      "UNKNOWN") as Disposition;
    if (final === "UNKNOWN") {
      return { ok: false, error: "This application has no disposition yet — there is nothing to sign off" };
    }

    await db.dispositionSignOff.upsert({
      where: { applicationId_engagementId: { applicationId: app.id, engagementId: ctx.engagementId } },
      create: {
        engagementId: ctx.engagementId,
        applicationId: app.id,
        disposition: final,
        signedByMembershipId: ctx.membershipId,
        note: parsed.note || null,
      },
      update: {
        disposition: final,
        signedByMembershipId: ctx.membershipId,
        note: parsed.note || null,
        createdAt: new Date(), // re-signing refreshes the agreement date
      },
    });
    await writeAudit(db, ctx, {
      action: "disposition.signoff.record",
      entityType: "Application",
      entityId: app.id,
      before: app.signOff ? { disposition: app.signOff.disposition } : null,
      after: { disposition: final, note: parsed.note || undefined },
    });
    revalidatePath(`/e/${ctx.engagementId}/applications`);
    revalidatePath(`/e/${ctx.engagementId}/applications/${app.id}/edit`);
    return { ok: true };
  } catch (err) {
    console.error("[aps] recordSignOff failed:", err);
    return { ok: false, error: "Could not record the sign-off — try again" };
  }
}

export async function revokeSignOff(input: {
  engagementId: string;
  applicationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.object({ engagementId: z.string().min(1), applicationId: z.string().min(1) }).parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  try {
    const existing = await db.dispositionSignOff.findUnique({
      where: { applicationId_engagementId: { applicationId: parsed.applicationId, engagementId: ctx.engagementId } },
      select: { id: true, disposition: true },
    });
    if (!existing) return { ok: false, error: "No sign-off to revoke" };

    await db.dispositionSignOff.delete({ where: { id: existing.id } });
    await writeAudit(db, ctx, {
      action: "disposition.signoff.revoke",
      entityType: "Application",
      entityId: parsed.applicationId,
      before: { disposition: existing.disposition },
    });
    revalidatePath(`/e/${ctx.engagementId}/applications`);
    revalidatePath(`/e/${ctx.engagementId}/applications/${parsed.applicationId}/edit`);
    return { ok: true };
  } catch (err) {
    console.error("[aps] revokeSignOff failed:", err);
    return { ok: false, error: "Could not revoke the sign-off — try again" };
  }
}
