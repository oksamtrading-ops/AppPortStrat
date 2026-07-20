"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";

/** Follow-up tasks (Lead/Consultant; viewers denied at the guard). */

const createSchema = z.object({
  engagementId: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  applicationId: z.string().min(1).nullable(),
  assigneeMembershipId: z.string().min(1).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export async function createTask(formData: FormData) {
  const parsed = createSchema.parse({
    engagementId: formData.get("engagementId"),
    title: formData.get("title"),
    applicationId: formData.get("applicationId") || null,
    assigneeMembershipId: formData.get("assigneeMembershipId") || null,
    dueDate: formData.get("dueDate") || null,
  });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const app = parsed.applicationId
    ? await db.application.findUnique({ where: { id: parsed.applicationId }, select: { id: true, name: true } })
    : null;

  const task = await db.task.create({
    data: {
      engagementId: ctx.engagementId,
      title: parsed.title,
      applicationId: app?.id ?? null,
      assigneeMembershipId: parsed.assigneeMembershipId,
      createdByMembershipId: ctx.membershipId,
      dueDate: parsed.dueDate ? new Date(`${parsed.dueDate}T00:00:00Z`) : null,
    },
  });

  if (parsed.assigneeMembershipId && parsed.assigneeMembershipId !== ctx.membershipId) {
    const assignee = await db.membership.findUnique({
      where: { id: parsed.assigneeMembershipId },
      select: { role: true },
    });
    if (assignee && assignee.role !== "CLIENT_RESPONDENT" && assignee.role !== "CLIENT_VIEWER") {
      await db.notification.create({
        data: {
          engagementId: ctx.engagementId,
          recipientMembershipId: parsed.assigneeMembershipId,
          kind: "task",
          payload: {
            applicationId: app?.id ?? "",
            applicationName: app?.name ?? "this engagement",
            actorDisplay: ctx.actorDisplay,
            snippet: parsed.title.slice(0, 140),
          },
        },
      });
    }
  }

  await writeAudit(db, ctx, {
    action: "task.create",
    entityType: "Task",
    entityId: task.id,
    after: { title: parsed.title, applicationId: app?.id ?? null, assigned: Boolean(parsed.assigneeMembershipId) },
  });
  revalidatePath(`/e/${ctx.engagementId}/tasks`);
}

export async function toggleTask(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), taskId: z.string().min(1) })
    .parse({ engagementId: formData.get("engagementId"), taskId: formData.get("taskId") });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const task = await db.task.findUnique({ where: { id: parsed.taskId }, select: { id: true, status: true } });
  if (!task) return;
  const done = task.status === "OPEN";
  await db.task.update({
    where: { id: task.id },
    data: { status: done ? "DONE" : "OPEN", completedAt: done ? new Date() : null },
  });
  await writeAudit(db, ctx, {
    action: done ? "task.complete" : "task.reopen",
    entityType: "Task",
    entityId: task.id,
    after: {},
  });
  revalidatePath(`/e/${ctx.engagementId}/tasks`);
}
