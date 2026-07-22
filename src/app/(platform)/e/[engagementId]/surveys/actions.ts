"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { validateAnswer, formatScore } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";
import { recomputeApplication } from "@/lib/recompute";
import { computeSurveyCompletion, getSurveyFinalization, rateLimit } from "@/lib/db/admin";
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

/**
 * Resolve (creating if missing) the response row the CALLER writes to
 * (multi-respondent §3): respondents own their RESPONDENT-layer row — the
 * guard scopes their reads to it and stamps kind/respondentMembershipId onto
 * their creates; Lead/Consultant workshop mode writes the CONSENSUS layer.
 * Respondent writes are rejected while the survey is finalized (§6).
 */
async function resolveWritableResponse(
  ctx: EngagementContext,
  db: ScopedDb,
  applicationId: string,
  templateId: string,
): Promise<{ ok: true; response: { id: string; status: string } } | { ok: false; error: string }> {
  const isRespondent = ctx.role === "CLIENT_RESPONDENT";
  if (isRespondent && (await getSurveyFinalization(ctx.engagementId, applicationId, templateId))) {
    return { ok: false, error: "This survey has been finalized — ask the engagement lead to reopen it" };
  }
  const layerWhere = isRespondent
    ? { applicationId, templateId } // guard injects kind=RESPONDENT + own membership
    : { applicationId, templateId, kind: "CONSENSUS" as const };
  let response = await db.surveyResponse.findFirst({ where: layerWhere, select: { id: true, status: true } });
  if (!response) {
    response = await db.surveyResponse.create({
      data: {
        engagementId: ctx.engagementId,
        applicationId,
        templateId,
        status: "IN_PROGRESS",
        updatedById: ctx.membershipId,
        // Guard stamps kind=RESPONDENT + respondentMembershipId for respondents.
        ...(isRespondent ? {} : { kind: "CONSENSUS" as const }),
      },
      select: { id: true, status: true },
    });
  }
  return { ok: true, response };
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

  // Layer-aware find-or-create (respondents pre-verified by the scoped
  // application read above; finalized surveys reject respondent writes).
  const resolved = await resolveWritableResponse(ctx, db, application.id, parsed.templateId);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const response = resolved.response;

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

  // Auto-status: a survey is COMPLETE the moment every applicable question is
  // addressed — a value OR an explicit N/A (blanks still block, so skipping is
  // a deliberate N/A, not an ambiguous empty). Adding answers never reopens a
  // survey (so a manual "done with blanks" completion survives edits); only
  // CLEARING an answer that drops it below fully-addressed auto-reopens it.
  const current = (await db.surveyResponse.findUnique({ where: { id: response.id }, select: { status: true } }))?.status ?? "IN_PROGRESS";
  const fullyAddressed = completion.applicableCount > 0 && completion.addressedCount >= completion.applicableCount;
  let nextStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" = current;
  if (fullyAddressed && current !== "COMPLETE") nextStatus = "COMPLETE";
  else if (parsed.raw === null && !fullyAddressed && current === "COMPLETE") nextStatus = "IN_PROGRESS";
  if (nextStatus !== current) {
    await db.surveyResponse.update({ where: { id: response.id }, data: { status: nextStatus, updatedById: ctx.membershipId } });
    await writeAudit(db, ctx, {
      action: "survey.status.auto",
      entityType: "SurveyResponse",
      entityId: response.id,
      after: { status: nextStatus, reason: nextStatus === "COMPLETE" ? "all-questions-addressed" : "answer-cleared" },
    });
  }

  return { ok: true, completion, scores, status: nextStatus };
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

  const resolved = await resolveWritableResponse(ctx, db, application.id, parsed.templateId);
  if (!resolved.ok) throw new Error(resolved.error);
  await db.surveyResponse.update({
    where: { id: resolved.response.id },
    data: { status: parsed.status, updatedById: ctx.membershipId },
  });
  await writeAudit(db, ctx, {
    action: "survey.status",
    entityType: "SurveyResponse",
    entityId: resolved.response.id,
    after: { status: parsed.status },
  });
  return { ok: true as const, status: parsed.status };
}

const finalizeSchema = z.object({
  engagementId: z.string().min(1),
  applicationId: z.string().min(1),
  templateId: z.string().min(1),
  finalized: z.boolean(),
});

/**
 * Finalize / Reopen an app+survey (multi-respondent §6, Lead/Consultant only).
 * Finalize upserts the CONSENSUS row (even with zero answers — it is the lock
 * anchor), stamps finalizedAt, and marks it COMPLETE; while set, every
 * respondent write is rejected. Reopen clears the lock.
 */
export async function setSurveyFinalized(input: z.infer<typeof finalizeSchema>) {
  const parsed = finalizeSchema.parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId);
  if (ctx.role !== "ENGAGEMENT_LEAD" && ctx.role !== "CONSULTANT") {
    throw new Error("Only the engagement team can finalize surveys");
  }

  const application = await db.application.findUnique({ where: { id: parsed.applicationId }, select: { id: true } });
  if (!application) throw new Error("Not available");

  let consensus = await db.surveyResponse.findFirst({
    where: { applicationId: application.id, templateId: parsed.templateId, kind: "CONSENSUS" },
    select: { id: true },
  });
  if (!consensus) {
    consensus = await db.surveyResponse.create({
      data: {
        engagementId: ctx.engagementId,
        applicationId: application.id,
        templateId: parsed.templateId,
        kind: "CONSENSUS",
        status: "NOT_STARTED",
        updatedById: ctx.membershipId,
      },
      select: { id: true },
    });
  }
  await db.surveyResponse.update({
    where: { id: consensus.id },
    data: parsed.finalized
      ? { finalizedAt: new Date(), status: "COMPLETE", updatedById: ctx.membershipId }
      : { finalizedAt: null, updatedById: ctx.membershipId },
  });
  await writeAudit(db, ctx, {
    action: parsed.finalized ? "survey.finalize" : "survey.reopen",
    entityType: "SurveyResponse",
    entityId: consensus.id,
    after: { applicationId: application.id, templateId: parsed.templateId },
  });
  return { ok: true as const, finalized: parsed.finalized };
}
