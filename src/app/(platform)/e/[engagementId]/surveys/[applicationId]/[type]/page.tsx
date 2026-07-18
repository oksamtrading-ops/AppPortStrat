import { notFound } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { SurveyForm, type AnswerView, type SurveyQuestionView } from "@/components/surveys/survey-form";

export const dynamic = "force-dynamic";

const SLUG_TO_TYPE: Record<string, "DEMOGRAPHICS" | "IT_HEALTH" | "BUSINESS_VALUE" | "FINANCE"> = {
  demographics: "DEMOGRAPHICS",
  "it-health": "IT_HEALTH",
  "business-value": "BUSINESS_VALUE",
  finance: "FINANCE",
};

export default async function SurveyFormPage({
  params,
}: {
  params: Promise<{ engagementId: string; applicationId: string; type: string }>;
}) {
  const { engagementId, applicationId, type } = await params;
  const templateType = SLUG_TO_TYPE[type];
  if (!templateType) notFound();

  const { ctx, db, engagement } = await requireEngagementContext(engagementId);

  const app = await db.application.findUnique({ where: { id: applicationId }, select: { id: true, name: true, appNumber: true } });
  if (!app) notFound();

  const template = await db.surveyTemplate.findFirst({
    where: { type: templateType },
    include: {
      questions: { orderBy: { orderIndex: "asc" }, include: { anchors: { orderBy: { value: "asc" } } } },
    },
  });
  if (!template || template.questions.length === 0) notFound();

  // Respondent: must be assigned this app+template (their app read passed the
  // assignment predicate for SOME template; verify this one specifically).
  if (ctx.role === "CLIENT_RESPONDENT") {
    const assignment = await db.surveyAssignment.findFirst({
      where: { applicationId: app.id, templateId: template.id },
    });
    if (!assignment) notFound();
  }

  const [response, optionLists] = await Promise.all([
    db.surveyResponse.findUnique({
      where: { applicationId_templateId: { applicationId: app.id, templateId: template.id } },
      include: { answers: true },
    }),
    db.optionList.findMany({ include: { items: { orderBy: { orderIndex: "asc" } } } }),
  ]);

  const optionsByKey = new Map(optionLists.map((l) => [l.key, l.items.map((i) => i.value)]));

  const questions: SurveyQuestionView[] = template.questions.map((q) => ({
    id: q.id,
    code: q.code,
    section: q.section,
    text: q.text,
    description: q.description,
    answerKind: q.answerKind as SurveyQuestionView["answerKind"],
    anchors: q.anchors.map((a) => ({ value: a.value, text: a.text })),
    options: q.optionListKey ? (optionsByKey.get(q.optionListKey) ?? []) : [],
  }));

  const initialAnswers: Record<string, AnswerView> = {};
  for (const a of response?.answers ?? []) {
    initialAnswers[a.questionId] = {
      isNA: a.isNA,
      numericValue: a.numericValue,
      textValue: a.textValue,
      boolValue: a.boolValue,
    };
  }

  // Initial completion — same admin-door computation the autosave returns
  // (respondents cannot read QuestionWeighting; only counts cross this line).
  const { computeSurveyCompletion } = await import("@/lib/db/admin");
  const { answeredCount, applicableCount } = await computeSurveyCompletion(
    ctx.engagementId,
    template.id,
    response?.id ?? null,
  );

  return (
    <SurveyForm
      engagementId={engagementId}
      applicationId={app.id}
      templateId={template.id}
      templateName={template.name}
      applicationName={`${app.name} (#${app.appNumber})`}
      isFinance={templateType === "FINANCE"}
      currency={engagement.currency}
      questions={questions}
      initialAnswers={initialAnswers}
      initialStatus={(response?.status ?? "NOT_STARTED") as "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE"}
      initialCompletion={{ answeredCount, applicableCount }}
      readOnly={ctx.readOnly || ctx.role === "CLIENT_VIEWER"}
    />
  );
}
