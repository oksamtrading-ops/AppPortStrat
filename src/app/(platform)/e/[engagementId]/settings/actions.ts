"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { adminDb } from "@/lib/db/admin";
import { writeAudit } from "@/lib/audit";

const schema = z.object({
  engagementId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  clientName: z.string().trim().min(1).max(200),
  currency: z.string().trim().length(3).toUpperCase(),
  fiscalYearConvention: z.string().trim().min(1).max(20),
});

/**
 * Edit engagement details (Lead-only). Engagement rows aren't reachable via
 * the scoped client by design — the Lead check authorizes this admin write.
 * In Clerk mode the engagement name mirrors the Clerk organization, so the
 * org is renamed FIRST (create-flow parity: if Clerk refuses, nothing moves).
 */
export async function updateEngagementSettings(formData: FormData) {
  const parsed = schema.parse({
    engagementId: formData.get("engagementId"),
    name: formData.get("name"),
    clientName: formData.get("clientName"),
    currency: formData.get("currency"),
    fiscalYearConvention: formData.get("fiscalYearConvention"),
  });
  const { ctx, db, session, engagement } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const before = {
    name: engagement.name,
    clientName: engagement.clientName,
    currency: engagement.currency,
    fiscalYearConvention: engagement.fiscalYearConvention,
  };
  const after = {
    name: parsed.name,
    clientName: parsed.clientName,
    currency: parsed.currency,
    fiscalYearConvention: parsed.fiscalYearConvention,
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return;

  if (session.mode === "clerk" && engagement.clerkOrgId && before.name !== after.name) {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    await client.organizations.updateOrganization(engagement.clerkOrgId, { name: after.name });
  }

  await adminDb().engagement.update({ where: { id: ctx.engagementId }, data: after });

  await writeAudit(db, ctx, {
    action: "engagement.settingsUpdate",
    entityType: "Engagement",
    entityId: ctx.engagementId,
    before,
    after,
  });
  revalidatePath(`/e/${ctx.engagementId}/settings`);
}

/** Per-engagement AI opt-in (v1 platform decision: key is platform-level). */
export async function updateAiEnabled(formData: FormData) {
  const engagementId = z.string().min(1).parse(formData.get("engagementId"));
  const enabled = formData.get("aiEnabled") === "on";
  const { ctx, db, engagement } = await requireEngagementContext(engagementId, "ENGAGEMENT_LEAD");
  if (engagement.aiEnabled === enabled) return;

  await adminDb().engagement.update({ where: { id: ctx.engagementId }, data: { aiEnabled: enabled } });
  await writeAudit(db, ctx, {
    action: "engagement.aiToggle",
    entityType: "Engagement",
    entityId: ctx.engagementId,
    before: { aiEnabled: engagement.aiEnabled },
    after: { aiEnabled: enabled },
  });
  revalidatePath(`/e/${ctx.engagementId}/settings`);
}
