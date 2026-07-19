"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { validateAnswer, formatScore } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";
import { recomputeApplication } from "@/lib/recompute";
import { computeSurveyCompletion, rateLimit } from "@/lib/db/admin";
import type { EngagementContext, ScopedDb } from "@/lib/db/scoped";

// Free-text answers are bounded so a respondent cannot persist multi-MB blobs.
const rawValueSchema = z.union([z.number(), z.string().max(10_000), z.boolean(), z.null()]);

const saveSchema = z.object({
  engagementId: z.string().min(1),
  applicationId: z.string().min(1),
  templateId: z.string().min(1),
  questionId: z.string().min(1),
  /** null = clear the answer (unanswered = no row). "NA" = explicit N/A. */
  raw: rawValueSchema,
});

export type SaveAnswerResult =
  | {
      ok: true;
      completion: { answeredCount: number; applicableCount: number; fraction: number };
      scores: { bv: string; it: string } | null;
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";
    }
  | { ok: false; error: string };

/**
 * Autosave one answer. Assignment enforcement for Client Respondents comes
 * from the scoped client itself: the application read below carries their
 * assignment predicate, so an unassigned app resolves to null → error.
 */
/**
 * A Client Respondent may only write to the exact survey templates assigned to
 * them for an application. The scoped guard's assignment predicate is
 * app-level (`assignments: { some }`), which lets a respondent assigned ANY
 * template on an app reach OTHER templates on the same app — so the specific
 * (application, template, membership) assignment is verified here. Consultants
 * and Leads (workshop mode) are unrestricted. Returns true when allowed.
 */
async function respondentMayWriteTemplate(
  ctx: EngagementContext,
  db: ScopedDb,
  applicationId: string,
  templateId: string,
): Promise<boolean> {
  if (ctx.role !== "CLIENT_RESPONDENT") return true;
  const assignment = await db.surveyAssignment.findFirst({
    where: { applicationId, templateId, membershipId: ctx.membershipId },
    select: { id: true },
  });
  return assignment !== null;
}

export async function saveAnswer(input: z.infer<typeof saveSchema>): Promise<SaveAnswerResult> {
  const parsed = saveSchema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId);

  // Every scored answer save triggers a recompute; throttle per member so a
  // single client cannot drive sustained DB write load (300 saves / minute is
  // far above real autosave cadence).
  const limit = await rateLimit(`answer:${ctx.membershipId}`, 300, 60);
  if (!limit.allowed) return { ok: false, error: "You're saving too fast — please pause a moment and try again" };

  const [application, question] = await Promise.all([
    db.application.findUnique({ where: { id: parsed.applicationId }, select: { id: true } }),
    db.surveyQuestion.findUnique({ where: { id: parsed.questionId }, select: { id: true, templateId: true, answerKind: true, scoreFamily: true, optionListKey: true, code: true, text: true } }),
  ]);
  if (!application || !question || question.templateId !== parsed.templateId) {
    return { ok: false, error: "Not available" };
  }
  if (!(await respondentMayWriteTemplate(ctx, db, application.id, parsed.templateId))) {
    return { ok: false, error: "This survey is not assigned to you" };
  }

  // OPTION questions validate against the engagement's option list.
  let allowedOptions: string[] | undefined;
  if (question.answerKind === "OPTION" && question.optionListKey) {
    const list = await db.optionList.findUnique({
      where: { engagementId_key: { engagementId: ctx.engagementId, key: question.optionListKey } },
      include: { items: true },
    });
    allowedOptions = list?.items.map((i) => i.value);
  }

  // Find or create the response row (respondents pre-verified by the scoped
  // application read above).
  let response = await db.surveyResponse.findUnique({
    where: { applicationId_templateId: { applicationId: application.id, templateId: parsed.templateId } },
  });
  if (!response) {
    response = await db.surveyResponse.create({
      data: {
        engagementId: ctx.engagementId,
        applicationId: application.id,
        templateId: parsed.templateId,
        status: "IN_PROGRESS",
        updatedById: ctx.membershipId,
      },
    });
  }

  if (parsed.raw === null) {
    // Clear → unanswered = no row (quirk #3 semantics).
    await db.answer.deleteMany({ where: { responseId: response.id, questionId: question.id } });
  } else {
    const validated = validateAnswer(
      { answerKind: question.answerKind as never, allowedOptions },
      typeof parsed.raw === "string" && parsed.raw !== "NA" && question.answerKind === "SCORE_1_5"
        ? Number(parsed.raw)
        : parsed.raw,
    );
    if (!validated.ok) return { ok: false, error: validated.error };
    const v = validated.value;
    await db.answer.upsert({
      where: { responseId_questionId: { responseId: response.id, questionId: question.id } },
      create: {
        engagementId: ctx.engagementId,
        responseId: response.id,
        questionId: question.id,
        isNA: v.isNA,
        numericValue: v.numericValue ?? null,
        textValue: v.textValue ?? null,
        boolValue: v.boolValue ?? null,
      },
      update: {
        isNA: v.isNA,
        numericValue: v.numericValue ?? null,
        textValue: v.textValue ?? null,
        boolValue: v.boolValue ?? null,
      },
    });
  }

  if (response.status === "NOT_STARTED") {
    await db.surveyResponse.update({ where: { id: response.id }, data: { status: "IN_PROGRESS", updatedById: ctx.membershipId } });
  } else {
    await db.surveyResponse.update({ where: { id: response.id }, data: { updatedById: ctx.membershipId } });
  }

  await writeAudit(db, ctx, {
    action: "survey.answer",
    entityType: "Answer",
    entityId: `${response.id}:${question.code}`,
    after: { question: question.code, value: parsed.raw },
  });

  // Scored families change this app's scores/disposition.
  let scores: { bv: string; it: string } | null = null;
  if (question.scoreFamily !== "NONE") {
    await recomputeApplication(ctx, db, engagement, application.id);
    // Live score readback is consultant-facing; respondents cannot (and
    // should not) read disposition results.
    if (ctx.role !== "CLIENT_RESPONDENT") {
      const result = await db.dispositionResult.findFirst({ where: { applicationId: application.id } });
      scores = { bv: formatScore(result?.bvScore ?? null), it: formatScore(result?.itScore ?? null) };
    }
  }

  const completion = await computeSurveyCompletion(ctx.engagementId, parsed.templateId, response.id);
  const fresh = await db.surveyResponse.findUnique({ where: { id: response.id }, select: { status: true } });

  return { ok: true, completion, scores, status: (fresh?.status ?? "IN_PROGRESS") as never };
}

export async function setSurveyStatus(input: {
  engagementId: string;
  applicationId: string;
  templateId: string;
  status: "IN_PROGRESS" | "COMPLETE";
}) {
  const parsed = z
    .object({
      engagementId: z.string().min(1),
      applicationId: z.string().min(1),
      templateId: z.string().min(1),
      status: z.enum(["IN_PROGRESS", "COMPLETE"]),
    })
    .parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId);

  const application = await db.application.findUnique({ where: { id: parsed.applicationId }, select: { id: true } });
  if (!application) throw new Error("Not available");
  if (!(await respondentMayWriteTemplate(ctx, db, application.id, parsed.templateId))) {
    throw new Error("This survey is not assigned to you");
  }

  const response = await db.surveyResponse.upsert({
    where: { applicationId_templateId: { applicationId: application.id, templateId: parsed.templateId } },
    create: {
      engagementId: ctx.engagementId,
      applicationId: application.id,
      templateId: parsed.templateId,
      status: parsed.status,
      updatedById: ctx.membershipId,
    },
    update: { status: parsed.status, updatedById: ctx.membershipId },
  });
  await writeAudit(db, ctx, {
    action: "survey.status",
    entityType: "SurveyResponse",
    entityId: response.id,
    after: { status: parsed.status },
  });
  return { ok: true as const, status: parsed.status };
}
