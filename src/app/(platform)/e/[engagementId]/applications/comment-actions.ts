"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { resolveMentions } from "@/lib/comments";

/**
 * Collaboration C1/C3: threaded comments on applications AND capabilities.
 * - Lead/Consultant write; Client Viewers read shared (internal:false) only —
 *   enforced by the guard's row predicate + traversal restriction, not here.
 * - Respondents have no access (model not in their allowlist).
 * - internal defaults to TRUE (Deloitte-only) — sharing is the deliberate act.
 * - @mentions match member display names (longest-first) and create
 *   notifications; viewers are never notified about internal comments.
 * - A comment targets exactly ONE of application / capability (DB CHECK).
 */

const addSchema = z
  .object({
    engagementId: z.string().min(1),
    applicationId: z.string().min(1).nullable().optional(),
    capabilityNodeId: z.string().min(1).nullable().optional(),
    parentId: z.string().min(1).nullable(),
    body: z.string().trim().min(1).max(5000),
    internal: z.boolean(),
  })
  .refine((v) => Boolean(v.applicationId) !== Boolean(v.capabilityNodeId), {
    message: "Exactly one of applicationId / capabilityNodeId is required",
  });

export async function addComment(input: {
  engagementId: string;
  applicationId?: string | null;
  capabilityNodeId?: string | null;
  parentId: string | null;
  body: string;
  internal: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = addSchema.parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  try {
    // Resolve the target (application or capability) inside the tenant scope.
    let target: { kind: "application" | "capability"; id: string; name: string };
    if (parsed.applicationId) {
      const application = await db.application.findUnique({ where: { id: parsed.applicationId }, select: { id: true, name: true } });
      if (!application) return { ok: false, error: "Unknown application" };
      target = { kind: "application", id: application.id, name: application.name };
    } else {
      const node = await db.capabilityNode.findUnique({ where: { id: parsed.capabilityNodeId! }, select: { id: true, name: true } });
      if (!node) return { ok: false, error: "Unknown capability" };
      target = { kind: "capability", id: node.id, name: node.name };
    }

    if (parsed.parentId) {
      const parent = await db.comment.findUnique({ where: { id: parsed.parentId }, select: { id: true, parentId: true } });
      if (!parent) return { ok: false, error: "The comment you replied to no longer exists" };
      if (parent.parentId) parsed.parentId = parent.parentId; // one-level threads: replies attach to the root
    }

    const comment = await db.comment.create({
      data: {
        engagementId: ctx.engagementId,
        applicationId: target.kind === "application" ? target.id : null,
        capabilityNodeId: target.kind === "capability" ? target.id : null,
        authorMembershipId: ctx.membershipId,
        parentId: parsed.parentId,
        body: parsed.body,
        internal: parsed.internal,
      },
    });

    // Notifications: @mentions + reply-to-author. Never the actor; never a
    // viewer for an internal comment; respondents can't see comments at all.
    const members = await db.membership.findMany({ select: { id: true, displayName: true, role: true } });
    const eligible = (m: (typeof members)[number]) =>
      m.id !== ctx.membershipId &&
      m.role !== "CLIENT_RESPONDENT" &&
      !(parsed.internal && m.role === "CLIENT_VIEWER");

    const recipients = new Map<string, "mention" | "reply">();
    for (const id of resolveMentions({ body: parsed.body, members, actorMembershipId: ctx.membershipId, internal: parsed.internal })) {
      recipients.set(id, "mention");
    }
    if (parsed.parentId) {
      const root = await db.comment.findUnique({ where: { id: parsed.parentId }, select: { authorMembershipId: true } });
      const author = root && members.find((m) => m.id === root.authorMembershipId);
      if (author && eligible(author) && !recipients.has(author.id)) recipients.set(author.id, "reply");
    }
    if (recipients.size > 0) {
      await db.notification.createMany({
        data: [...recipients.entries()].map(([recipientMembershipId, kind]) => ({
          engagementId: ctx.engagementId,
          recipientMembershipId,
          kind,
          payload: {
            // applicationId stays for backward compatibility with stored rows;
            // the bell routes on whichever target id is present.
            applicationId: target.kind === "application" ? target.id : null,
            capabilityNodeId: target.kind === "capability" ? target.id : null,
            applicationName: target.name,
            actorDisplay: ctx.actorDisplay,
            snippet: parsed.body.slice(0, 140),
          },
        })),
      });
    }

    await writeAudit(db, ctx, {
      action: "comment.add",
      entityType: "Comment",
      entityId: comment.id,
      after: {
        applicationId: target.kind === "application" ? target.id : undefined,
        capabilityNodeId: target.kind === "capability" ? target.id : undefined,
        internal: parsed.internal,
        reply: Boolean(parsed.parentId),
        notified: recipients.size,
      },
    });
    revalidatePath(
      target.kind === "application"
        ? `/e/${ctx.engagementId}/applications/${target.id}/edit`
        : `/e/${ctx.engagementId}/capabilities/${target.id}`,
    );
    return { ok: true };
  } catch (err) {
    console.error("[aps] addComment failed:", err);
    return { ok: false, error: "Could not post the comment — try again" };
  }
}

export async function markNotificationsRead(input: { engagementId: string }): Promise<{ ok: boolean }> {
  const parsed = z.object({ engagementId: z.string().min(1) }).parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") return { ok: false }; // no bell for respondents
  try {
    // The guard injects recipientMembershipId = own membership on Notification writes.
    await db.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
  } catch {
    return { ok: false }; // e.g. archived engagement (read-only) — leave unread
  }
  revalidatePath(`/e/${ctx.engagementId}`, "layout");
  return { ok: true };
}
