"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { parseCapabilityImport, UNASSIGNED } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";
import type { ScopedDb } from "@/lib/db/scoped";

async function findOrCreateNode(
  db: ScopedDb,
  engagementId: string,
  level: "L0" | "L1" | "L2",
  name: string,
  parentId: string | null,
): Promise<string> {
  const existing = await db.capabilityNode.findFirst({ where: { level, name, parentId } });
  if (existing) return existing.id;
  const created = await db.capabilityNode.create({
    data: { engagementId, level, name, parentId, isPlaceholder: name === UNASSIGNED },
  });
  return created.id;
}

export async function addCapabilityNode(formData: FormData) {
  const parsed = z
    .object({
      engagementId: z.string().min(1),
      parentId: z.string().optional(),
      name: z.string().trim().min(1).max(300),
    })
    .parse({
      engagementId: formData.get("engagementId"),
      parentId: formData.get("parentId") || undefined,
      name: formData.get("name"),
    });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  let level: "L0" | "L1" | "L2" = "L0";
  let parentId: string | null = null;
  if (parsed.parentId) {
    const parent = await db.capabilityNode.findUnique({ where: { id: parsed.parentId } });
    if (!parent) throw new Error("Unknown parent node");
    if (parent.level === "L2") throw new Error("L2 nodes cannot have children");
    level = parent.level === "L0" ? "L1" : "L2";
    parentId = parent.id;
  }

  await findOrCreateNode(db, ctx.engagementId, level, parsed.name, parentId);
  await writeAudit(db, ctx, {
    action: "capability.add",
    entityType: "CapabilityNode",
    after: { level, name: parsed.name },
  });
  revalidatePath(`/e/${ctx.engagementId}/capabilities`);
}

export async function renameCapabilityNode(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), nodeId: z.string().min(1), name: z.string().trim().min(1).max(300) })
    .parse({
      engagementId: formData.get("engagementId"),
      nodeId: formData.get("nodeId"),
      name: formData.get("name"),
    });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const node = await db.capabilityNode.findUnique({ where: { id: parsed.nodeId } });
  if (!node) throw new Error("Unknown node");

  await db.capabilityNode.update({ where: { id: node.id }, data: { name: parsed.name, isPlaceholder: false } });
  await writeAudit(db, ctx, {
    action: "capability.rename",
    entityType: "CapabilityNode",
    entityId: node.id,
    before: { name: node.name },
    after: { name: parsed.name },
  });
  revalidatePath(`/e/${ctx.engagementId}/capabilities`);
}

export async function deleteCapabilityNode(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), nodeId: z.string().min(1) })
    .parse({ engagementId: formData.get("engagementId"), nodeId: formData.get("nodeId") });
  // Deleting a capability cascades an entire L0/L1/L2 subtree — Lead-only,
  // consistent with deleteApplication (security review: was Consultant-gated).
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const node = await db.capabilityNode.findUnique({ where: { id: parsed.nodeId } });
  if (!node) throw new Error("Unknown node");

  // Refuse when the subtree is referenced by applications (DB RESTRICT backstops).
  const subtreeIds = [node.id];
  const l1s = await db.capabilityNode.findMany({ where: { parentId: node.id }, select: { id: true } });
  subtreeIds.push(...l1s.map((n) => n.id));
  if (l1s.length > 0) {
    const l2s = await db.capabilityNode.findMany({
      where: { parentId: { in: l1s.map((n) => n.id) } },
      select: { id: true },
    });
    subtreeIds.push(...l2s.map((n) => n.id));
  }
  const referencing = await db.application.count({ where: { capabilityNodeId: { in: subtreeIds } } });
  if (referencing > 0) {
    throw new Error(`Cannot delete: ${referencing} application(s) are mapped to this capability or its children`);
  }

  await db.capabilityNode.deleteMany({ where: { id: { in: subtreeIds } } });
  await writeAudit(db, ctx, {
    action: "capability.delete",
    entityType: "CapabilityNode",
    entityId: node.id,
    before: { level: node.level, name: node.name, subtreeSize: subtreeIds.length },
  });
  revalidatePath(`/e/${ctx.engagementId}/capabilities`);
}

/**
 * Drag-and-drop re-parenting: move an L2 under a different L1 (same-engagement
 * enforced by the scoped client + composite FK). Merges are refused — the
 * capability model stays deduplicated per parent.
 */
export async function moveCapabilityNode(input: { engagementId: string; nodeId: string; newParentId: string }) {
  const parsed = z
    .object({ engagementId: z.string().min(1), nodeId: z.string().min(1), newParentId: z.string().min(1) })
    .parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const [node, newParent] = await Promise.all([
    db.capabilityNode.findUnique({ where: { id: parsed.nodeId } }),
    db.capabilityNode.findUnique({ where: { id: parsed.newParentId } }),
  ]);
  if (!node || !newParent) throw new Error("Unknown capability node");
  if (node.level !== "L2" || newParent.level !== "L1") {
    return { ok: false as const, error: "Only L2 capabilities can be moved, onto an L1" };
  }
  if (node.parentId === newParent.id) return { ok: true as const, moved: false };

  const duplicate = await db.capabilityNode.findFirst({
    where: { level: "L2", parentId: newParent.id, name: node.name },
  });
  if (duplicate) {
    return { ok: false as const, error: `"${node.name}" already exists under ${newParent.name}` };
  }

  const oldParent = node.parentId ? await db.capabilityNode.findUnique({ where: { id: node.parentId } }) : null;
  await db.capabilityNode.update({ where: { id: node.id }, data: { parentId: newParent.id } });
  await writeAudit(db, ctx, {
    action: "capability.move",
    entityType: "CapabilityNode",
    entityId: node.id,
    before: { parent: oldParent?.name ?? null },
    after: { parent: newParent.name, name: node.name },
  });
  revalidatePath(`/e/${ctx.engagementId}/capabilities`);
  return { ok: true as const, moved: true };
}

export async function pasteCapabilities(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), text: z.string().min(1).max(500_000) })
    .parse({ engagementId: formData.get("engagementId"), text: formData.get("text") });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const { tree, rowCount } = parseCapabilityImport(parsed.text);
  if (rowCount > 5000) throw new Error("Paste is limited to 5,000 rows at a time");
  let created = 0;

  for (const [l0Name, l1Map] of tree) {
    const l0Before = await db.capabilityNode.findFirst({ where: { level: "L0", name: l0Name, parentId: null } });
    const l0Id = l0Before?.id ?? (await findOrCreateNode(db, ctx.engagementId, "L0", l0Name, null));
    if (!l0Before) created += 1;

    for (const [l1Name, l2Set] of l1Map) {
      const l1Before = await db.capabilityNode.findFirst({ where: { level: "L1", name: l1Name, parentId: l0Id } });
      const l1Id = l1Before?.id ?? (await findOrCreateNode(db, ctx.engagementId, "L1", l1Name, l0Id));
      if (!l1Before) created += 1;

      for (const l2Name of l2Set) {
        const l2Before = await db.capabilityNode.findFirst({ where: { level: "L2", name: l2Name, parentId: l1Id } });
        if (!l2Before) {
          await findOrCreateNode(db, ctx.engagementId, "L2", l2Name, l1Id);
          created += 1;
        }
      }
    }
  }

  await writeAudit(db, ctx, {
    action: "capability.paste",
    entityType: "CapabilityNode",
    after: { pastedRows: rowCount, nodesCreated: created },
  });
  revalidatePath(`/e/${ctx.engagementId}/capabilities`);
}

export async function importLibraryAction(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), libraryId: z.string().min(1) })
    .parse({ engagementId: formData.get("engagementId"), libraryId: formData.get("libraryId") });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const { cloneLibraryIntoEngagement } = await import("@/lib/db/library");
  const { nodeCount } = await cloneLibraryIntoEngagement(ctx.engagementId, parsed.libraryId);

  await writeAudit(db, ctx, {
    action: "capability.libraryImport",
    entityType: "CapabilityNode",
    after: { libraryId: parsed.libraryId, nodeCount },
  });
  revalidatePath(`/e/${ctx.engagementId}/capabilities`);
}

export async function promoteLibraryAction(formData: FormData) {
  const parsed = z
    .object({
      engagementId: z.string().min(1),
      industry: z.string().trim().min(1).max(100),
      packName: z.string().trim().min(1).max(200),
      // The promoter must confirm the tree is shareable: capability names can
      // reveal client strategy, and the library is visible platform-wide.
      confidentialityConfirmed: z.literal("on", {
        message: "Confirm the capability names contain no client-confidential content",
      }),
    })
    .parse({
      engagementId: formData.get("engagementId"),
      industry: formData.get("industry"),
      packName: formData.get("packName"),
      confidentialityConfirmed: formData.get("confidentialityConfirmed"),
    });
  const { ctx, db, session } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const { promoteEngagementTreeToLibrary } = await import("@/lib/db/library");
  const library = await promoteEngagementTreeToLibrary(ctx.engagementId, {
    industry: parsed.industry,
    name: parsed.packName,
    createdBy: session.displayName,
  });

  await writeAudit(db, ctx, {
    action: "capability.libraryPromote",
    entityType: "CapabilityNode",
    after: { libraryId: library.id, industry: parsed.industry, packName: parsed.packName, version: library.version },
  });
  revalidatePath(`/e/${ctx.engagementId}/capabilities`);
}
