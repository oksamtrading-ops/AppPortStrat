"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { resolveFinalDisposition } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";
import { recomputeApplication } from "@/lib/recompute";
import { createApplicationWithNumber } from "@/lib/db/applications";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const applicationSchema = z.object({
  engagementId: z.string().min(1),
  applicationId: z.string().min(1).optional(), // absent = create
  name: z.string().trim().min(1).max(300),
  acronym: optionalText(50),
  description: optionalText(4000),
  applicationType: optionalText(200),
  businessFunctionDetail: optionalText(1000),
  target: optionalText(500),
  meetsFutureState: z.enum(["YES", "NO", "PARTIAL"]).nullable().optional(),
  actionPlanAssignment: optionalText(200),
  actionPlanJustification: optionalText(2000),
  missionCritical: z.boolean(),
  comments: optionalText(4000),
  inScope: z.boolean(),
  isUtilized: z.boolean(),
  isReplaced: z.boolean(),
  inFlight: z.boolean(),
  capabilityNodeId: z.string().nullable().optional(),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;

export async function saveApplication(input: ApplicationInput) {
  const parsed = applicationSchema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  // Capability node must belong to this engagement (scoped read; the
  // composite DB FK backstops this).
  if (parsed.capabilityNodeId) {
    const node = await db.capabilityNode.findUnique({ where: { id: parsed.capabilityNodeId } });
    if (!node) throw new Error("Unknown capability node");
  }

  const { engagementId: _ignored, applicationId, ...fields } = parsed;
  void _ignored;
  const data = { ...fields, meetsFutureState: parsed.meetsFutureState ?? null, capabilityNodeId: parsed.capabilityNodeId ?? null };

  let id: string;
  if (applicationId) {
    const before = await db.application.findUnique({ where: { id: applicationId } });
    if (!before) throw new Error("Unknown application");
    await db.application.update({ where: { id: applicationId }, data });
    await writeAudit(db, ctx, {
      action: "application.update",
      entityType: "Application",
      entityId: applicationId,
      before: {
        name: before.name,
        inScope: before.inScope,
        isUtilized: before.isUtilized,
        isReplaced: before.isReplaced,
        inFlight: before.inFlight,
        missionCritical: before.missionCritical,
        capabilityNodeId: before.capabilityNodeId,
      },
      after: data,
    });
    id = applicationId;
  } else {
    const created = await createApplicationWithNumber(db, ctx.engagementId, data);
    await writeAudit(db, ctx, {
      action: "application.create",
      entityType: "Application",
      entityId: created.id,
      after: { name: data.name, appNumber: created.appNumber },
    });
    id = created.id;
  }

  // Scope flags feed the filter cascade — keep this app's result fresh.
  await recomputeApplication(ctx, db, engagement, id);
  revalidatePath(`/e/${ctx.engagementId}/applications`);
  redirect(`/e/${ctx.engagementId}/applications`);
}

export async function deleteApplication(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), applicationId: z.string().min(1) })
    .parse({ engagementId: formData.get("engagementId"), applicationId: formData.get("applicationId") });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const app = await db.application.findUnique({ where: { id: parsed.applicationId } });
  if (!app) throw new Error("Unknown application");

  await db.application.delete({ where: { id: app.id } });
  await writeAudit(db, ctx, {
    action: "application.delete",
    entityType: "Application",
    entityId: app.id,
    before: { name: app.name, appNumber: app.appNumber },
  });
  revalidatePath(`/e/${ctx.engagementId}/applications`);
}

/**
 * Paste-import applications from Excel (TSV with a header row, mirroring the
 * export columns). Capability names resolve against the EXISTING model only —
 * the workbook's dropdowns never invented capabilities, so unknown names are
 * reported, not created. Caps: 2,000 rows per paste.
 */
export async function importApplications(input: { engagementId: string; text: string }) {
  const parsed = z
    .object({ engagementId: z.string().min(1), text: z.string().min(1).max(2_000_000) })
    .parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const { parseTsvWithHeader, parseBooleanCell } = await import("@/lib/tabular");
  const { records, unknownColumns } = parseTsvWithHeader(parsed.text, {
    name: ["name", "applicationname", "application"],
    acronym: ["acronym"],
    description: ["description", "applicationdescription"],
    applicationType: ["type", "applicationtype"],
    l0: ["l0", "l0capability"],
    l1: ["l1", "l1capability"],
    l2: ["l2", "l2capability"],
    businessFunctionDetail: ["businessfunctiondetail"],
    target: ["target"],
    missionCritical: ["missioncritical", "missioncriticalperdeloitte"],
    inScope: ["inscope"],
    isUtilized: ["isutilized", "utilized"],
    isReplaced: ["isreplaced", "replaced"],
    inFlight: ["inflight", "indev"],
    comments: ["comments", "overallcomments"],
  });
  if (records.length === 0) return { ok: false as const, error: "No data rows found — paste with a header row" };
  if (records.length > 2000) return { ok: false as const, error: "Paste is limited to 2,000 rows at a time" };

  const nodes = await db.capabilityNode.findMany({ select: { id: true, parentId: true, level: true, name: true } });
  const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();
  const resolveCapability = (l0?: string, l1?: string, l2?: string): string | null => {
    const l0Node = l0 ? nodes.find((n) => n.level === "L0" && norm(n.name) === norm(l0)) : undefined;
    const l1Node = l1
      ? nodes.find((n) => n.level === "L1" && norm(n.name) === norm(l1) && (!l0Node || n.parentId === l0Node.id))
      : undefined;
    const l2Node = l2
      ? nodes.find((n) => n.level === "L2" && norm(n.name) === norm(l2) && (!l1Node || n.parentId === l1Node.id))
      : undefined;
    return l2Node?.id ?? l1Node?.id ?? l0Node?.id ?? null;
  };

  let created = 0;
  let unmappedCapabilities = 0;
  const errors: string[] = [];
  for (const record of records) {
    if (!record.name) {
      errors.push("Row skipped: missing name");
      continue;
    }
    const capabilityNodeId = resolveCapability(record.l0, record.l1, record.l2);
    if ((record.l0 || record.l1 || record.l2) && !capabilityNodeId) unmappedCapabilities += 1;
    await createApplicationWithNumber(db, ctx.engagementId, {
      name: record.name,
      acronym: record.acronym ?? null,
      description: record.description ?? null,
      applicationType: record.applicationType ?? null,
      businessFunctionDetail: record.businessFunctionDetail ?? null,
      target: record.target ?? null,
      comments: record.comments ?? null,
      missionCritical: parseBooleanCell(record.missionCritical, false),
      inScope: parseBooleanCell(record.inScope, true),
      isUtilized: parseBooleanCell(record.isUtilized, true),
      isReplaced: parseBooleanCell(record.isReplaced, false),
      inFlight: parseBooleanCell(record.inFlight, false),
      capabilityNodeId,
    });
    created += 1;
  }

  const { recomputeEngagement } = await import("@/lib/recompute");
  await recomputeEngagement(ctx, db, engagement);
  await writeAudit(db, ctx, {
    action: "import.applications",
    entityType: "Application",
    after: { created, unmappedCapabilities, unknownColumns },
  });
  revalidatePath(`/e/${ctx.engagementId}/applications`);
  return { ok: true as const, created, unmappedCapabilities, skipped: errors.length };
}

const FLAGS = ["inScope", "isUtilized", "isReplaced", "inFlight", "missionCritical"] as const;

export async function toggleApplicationFlag(input: {
  engagementId: string;
  applicationId: string;
  flag: (typeof FLAGS)[number];
  value: boolean;
}) {
  const parsed = z
    .object({
      engagementId: z.string().min(1),
      applicationId: z.string().min(1),
      flag: z.enum(FLAGS),
      value: z.boolean(),
    })
    .parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const app = await db.application.findUnique({ where: { id: parsed.applicationId } });
  if (!app) throw new Error("Unknown application");

  await db.application.update({ where: { id: app.id }, data: { [parsed.flag]: parsed.value } });
  await writeAudit(db, ctx, {
    action: "application.flag",
    entityType: "Application",
    entityId: app.id,
    before: { [parsed.flag]: app[parsed.flag] },
    after: { [parsed.flag]: parsed.value },
  });
  await recomputeApplication(ctx, db, engagement, app.id);
  revalidatePath(`/e/${ctx.engagementId}/applications`);
  return { ok: true as const };
}

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
