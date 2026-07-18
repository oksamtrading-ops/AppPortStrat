"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";

/**
 * Assign surveys (app × templates) to a Client Respondent. Response rows are
 * materialized eagerly so the respondent's first visit finds them.
 */
export async function assignSurveys(formData: FormData) {
  const parsed = z
    .object({
      engagementId: z.string().min(1),
      applicationId: z.string().min(1),
      membershipId: z.string().min(1),
      templateIds: z.array(z.string().min(1)).min(1),
    })
    .parse({
      engagementId: formData.get("engagementId"),
      applicationId: formData.get("applicationId"),
      membershipId: formData.get("membershipId"),
      templateIds: formData.getAll("templateIds").map(String),
    });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const [application, member, templates] = await Promise.all([
    db.application.findUnique({ where: { id: parsed.applicationId }, select: { id: true, name: true } }),
    db.membership.findUnique({ where: { id: parsed.membershipId }, select: { id: true, email: true, role: true } }),
    db.surveyTemplate.findMany({ where: { id: { in: parsed.templateIds } }, select: { id: true, type: true } }),
  ]);
  if (!application || !member || templates.length !== parsed.templateIds.length) {
    throw new Error("Unknown application, member, or survey");
  }
  if (member.role !== "CLIENT_RESPONDENT") {
    throw new Error("Surveys are assigned to Client Respondents");
  }

  for (const template of templates) {
    await db.surveyAssignment.upsert({
      where: {
        applicationId_templateId_membershipId: {
          applicationId: application.id,
          templateId: template.id,
          membershipId: member.id,
        },
      },
      create: {
        engagementId: ctx.engagementId,
        applicationId: application.id,
        templateId: template.id,
        membershipId: member.id,
      },
      update: {},
    });
    // Materialize the response row so the respondent's queue works immediately.
    await db.surveyResponse.upsert({
      where: { applicationId_templateId: { applicationId: application.id, templateId: template.id } },
      create: {
        engagementId: ctx.engagementId,
        applicationId: application.id,
        templateId: template.id,
        status: "NOT_STARTED",
      },
      update: {},
    });
  }

  await writeAudit(db, ctx, {
    action: "survey.assign",
    entityType: "SurveyAssignment",
    after: { application: application.name, member: member.email, surveys: templates.map((t) => t.type) },
  });
  revalidatePath(`/e/${ctx.engagementId}/surveys`);
}

export async function removeAssignment(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), assignmentId: z.string().min(1) })
    .parse({ engagementId: formData.get("engagementId"), assignmentId: formData.get("assignmentId") });
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  const assignment = await db.surveyAssignment.findUnique({
    where: { id: parsed.assignmentId },
    include: {
      application: { select: { name: true } },
      membership: { select: { email: true } },
      template: { select: { type: true } },
    },
  });
  if (!assignment) throw new Error("Unknown assignment");

  await db.surveyAssignment.delete({ where: { id: assignment.id } });
  await writeAudit(db, ctx, {
    action: "survey.unassign",
    entityType: "SurveyAssignment",
    entityId: assignment.id,
    before: {
      application: assignment.application.name,
      member: assignment.membership.email,
      survey: assignment.template.type,
    },
  });
  revalidatePath(`/e/${ctx.engagementId}/surveys`);
}
