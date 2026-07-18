"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { validateAnswer, computeCompletion, formatScore } from "@/lib/methodology";
import type { AnswerValue } from "@/lib/methodology";
import { deriveWeights } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";
import { recomputeApplication } from "@/lib/recompute";
import type { ScopedDb } from "@/lib/db/scoped";
import type { EngagementContext } from "@/lib/db/scoped";

const rawValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);

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
export async function saveAnswer(input: z.infer<typeof saveSchema>): Promise<SaveAnswerResult> {
  const parsed = saveSchema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId);

  const [application, question] = await Promise.all([
    db.application.findUnique({ where: { id: parsed.applicationId }, select: { id: true } }),
    db.surveyQuestion.findUnique({ where: { id: parsed.questionId }, select: { id: true, templateId: true, answerKind: true, scoreFamily: true, optionListKey: true, code: true, text: true } }),
  ]);
  if (!application || !question || question.templateId !== parsed.templateId) {
    return { ok: false, error: "Not available" };
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
    const result = await db.dispositionResult.findFirst({ where: { applicationId: application.id } });
    scores = { bv: formatScore(result?.bvScore ?? null), it: formatScore(result?.itScore ?? null) };
  }

  const completion = await computeTemplateCompletion(db, ctx, parsed.templateId, response.id);
  const fresh = await db.surveyResponse.findUnique({ where: { id: response.id }, select: { status: true } });

  return { ok: true, completion, scores, status: (fresh?.status ?? "IN_PROGRESS") as never };
}

/** Workbook-exact completion for one response (inventory §3.2, no 2% floor). */
async function computeTemplateCompletion(db: ScopedDb, ctx: EngagementContext, templateId: string, responseId: string) {
  const [questions, weightings, answers] = await Promise.all([
    db.surveyQuestion.findMany({ where: { templateId }, select: { id: true, code: true, scoreFamily: true } }),
    db.questionWeighting.findMany({
      where: { question: { templateId } },
      select: { importanceRating: true, question: { select: { code: true, scoreFamily: true } } },
    }),
    db.answer.findMany({ where: { responseId }, select: { questionId: true, isNA: true, numericValue: true, textValue: true, boolValue: true } }),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const scored = questions.some((q) => q.scoreFamily !== "NONE");

  if (scored) {
    // IT/BV: applicable = weighted>0 questions + non-report; answered = numeric.
    const reportRatings = new Map(
      weightings.filter((w) => w.question.scoreFamily === "IT" || w.question.scoreFamily === "BUSINESS").map((w) => [w.question.code, w.importanceRating]),
    );
    const weights = deriveWeights(reportRatings);
    const answerMap = new Map<string, AnswerValue>();
    for (const a of answers) {
      const q = byId.get(a.questionId);
      if (!q) continue;
      if (a.isNA) answerMap.set(q.code, "NA");
      else if (a.numericValue !== null && a.numericValue >= 1 && a.numericValue <= 5) {
        answerMap.set(q.code, Math.round(a.numericValue) as 1 | 2 | 3 | 4 | 5);
      }
    }
    const nonReportCodes = questions.filter((q) => q.scoreFamily === "IT_NON_REPORT").map((q) => q.code);
    return computeCompletion({ weights, answers: answerMap, alwaysApplicableCodes: nonReportCodes });
  }

  // Demographics/Finance: applicable = every field; answered = any value (Excel COUNTA).
  const answeredCount = answers.filter((a) => a.isNA || a.numericValue !== null || a.textValue !== null || a.boolValue !== null).length;
  const applicableCount = questions.length;
  return { answeredCount, applicableCount, fraction: applicableCount === 0 ? 0 : answeredCount / applicableCount };
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
