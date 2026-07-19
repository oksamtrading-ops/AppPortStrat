"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { adminDb } from "@/lib/db/admin";
import { createEngagementWithConfig } from "@/lib/db/provision";

const PURGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  clientName: z.string().trim().min(1).max(200),
  currency: z.string().trim().length(3).toUpperCase().default("USD"),
  fiscalYearConvention: z.string().trim().min(1).max(20).default("FY"),
  source: z.enum(["defaults", "aps50", "clone"]),
  sourceEngagementId: z.string().optional(),
});

export async function createEngagementAction(formData: FormData) {
  const session = await requirePlatformAdmin();
  const parsed = createSchema.parse({
    name: formData.get("name"),
    clientName: formData.get("clientName"),
    currency: formData.get("currency") || "USD",
    fiscalYearConvention: formData.get("fiscalYearConvention") || "FY",
    source: formData.get("source"),
    sourceEngagementId: formData.get("sourceEngagementId") || undefined,
  });

  // In Clerk mode the engagement is bound to a new Clerk organization;
  // roll the org back if the local create fails.
  let clerkOrgId: string | null = null;
  if (session.mode === "clerk") {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const org = await client.organizations.createOrganization({
      name: parsed.name,
      createdBy: session.userId,
    });
    clerkOrgId = org.id;
  }

  let engagement;
  try {
    engagement = await createEngagementWithConfig({
      name: parsed.name,
      clientName: parsed.clientName,
      currency: parsed.currency,
      fiscalYearConvention: parsed.fiscalYearConvention,
      clerkOrgId,
      source:
        parsed.source === "clone"
          ? { kind: "clone", sourceEngagementId: z.string().min(1).parse(parsed.sourceEngagementId) }
          : { kind: "defaults", preset: parsed.source === "aps50" ? "APS50" : "NEUTRAL" },
    });
  } catch (err) {
    if (clerkOrgId) {
      const { clerkClient } = await import("@clerk/nextjs/server");
      const client = await clerkClient();
      await client.organizations.deleteOrganization(clerkOrgId).catch(() => undefined);
    }
    throw err;
  }

  await audit(engagement.id, session.userId, session.displayName, "engagement.create", {
    name: parsed.name,
    clientName: parsed.clientName,
    source: parsed.source,
  });
  revalidatePath("/admin/engagements");
  redirect("/admin/engagements");
}

const idSchema = z.object({ engagementId: z.string().min(1) });

export async function setEngagementStatusAction(formData: FormData) {
  const session = await requirePlatformAdmin();
  const { engagementId } = idSchema.parse({ engagementId: formData.get("engagementId") });
  const transition = z.enum(["archive", "reactivate", "schedulePurge", "cancelPurge"]).parse(formData.get("transition"));

  const db = adminDb();
  const engagement = await db.engagement.findUnique({ where: { id: engagementId } });
  if (!engagement) throw new Error("Engagement not found");

  if (transition === "archive") {
    await db.engagement.update({ where: { id: engagementId }, data: { status: "ARCHIVED", purgeScheduledAt: null } });
  } else if (transition === "reactivate") {
    await db.engagement.update({ where: { id: engagementId }, data: { status: "ACTIVE", purgeScheduledAt: null } });
  } else if (transition === "schedulePurge") {
    // Two-phase purge: read-only grace period. The destructive final step
    // ships with the full-dataset export (Phase 5) so the exit-path export
    // always precedes deletion; earliest execution is purgeScheduledAt + 7 days.
    await db.engagement.update({
      where: { id: engagementId },
      data: { status: "PENDING_PURGE", purgeScheduledAt: new Date(Date.now() + PURGE_GRACE_MS) },
    });
  } else {
    await db.engagement.update({
      where: { id: engagementId },
      data: { status: engagement.status === "PENDING_PURGE" ? "ARCHIVED" : engagement.status, purgeScheduledAt: null },
    });
  }

  await audit(engagementId, session.userId, session.displayName, `engagement.${transition}`, {
    from: engagement.status,
  });
  revalidatePath("/admin/engagements");
}

const confirmPurgeSchema = z.object({
  engagementId: z.string().min(1),
  confirmName: z.string().min(1),
  exportAcknowledged: z.literal("on", { message: "Download the final export and acknowledge it first" }),
});

/**
 * Final purge step (two-phase, APP-SPEC §4.1): only after the grace period,
 * only with the typed engagement name, and only after acknowledging the
 * final full-dataset export. Hard-deletes everything (cascade) and leaves a
 * tombstone that has no foreign keys — the one permanent record.
 */
export async function confirmPurgeAction(formData: FormData) {
  const session = await requirePlatformAdmin();
  const parsed = confirmPurgeSchema.parse({
    engagementId: formData.get("engagementId"),
    confirmName: formData.get("confirmName"),
    exportAcknowledged: formData.get("exportAcknowledged"),
  });

  const db = adminDb();
  const engagement = await db.engagement.findUnique({
    where: { id: parsed.engagementId },
    include: { _count: { select: { applications: true, memberships: true, answers: true, auditEvents: true } } },
  });
  if (!engagement) throw new Error("Engagement not found");
  if (engagement.status !== "PENDING_PURGE" || !engagement.purgeScheduledAt) {
    throw new Error("Purge has not been scheduled for this engagement");
  }
  if (engagement.purgeScheduledAt.getTime() > Date.now()) {
    throw new Error(`The grace period ends ${engagement.purgeScheduledAt.toISOString().slice(0, 10)} — purge is not yet eligible`);
  }
  if (parsed.confirmName.trim() !== engagement.name) {
    throw new Error("Typed name does not match the engagement");
  }

  await db.engagement.delete({ where: { id: engagement.id } }); // cascades everything
  await db.engagementTombstone.create({
    data: {
      engagementId: engagement.id,
      engagementName: engagement.name,
      clientName: engagement.clientName,
      deletedByUserId: session.userId,
      deletedByDisplay: session.displayName,
      counts: engagement._count,
    },
  });

  revalidatePath("/admin/engagements");
}

async function audit(
  engagementId: string,
  actorUserId: string,
  actorDisplay: string,
  action: string,
  after: Record<string, string | number | boolean | null | undefined>,
) {
  await adminDb().auditEvent.create({
    data: {
      engagementId,
      actorUserId,
      actorDisplay,
      action,
      entityType: "Engagement",
      entityId: engagementId,
      after: JSON.parse(JSON.stringify(after)),
    },
  });
}
