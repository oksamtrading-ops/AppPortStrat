import { notFound } from "next/navigation";
import Link from "next/link";
import { requireEngagementContext } from "@/lib/auth/context";
import { Card, CardContent } from "@/components/ui/card";
import { ResponsesTable, type AnswerCell } from "@/components/surveys/responses-table";

export const dynamic = "force-dynamic";

const SLUG_TO_TYPE: Record<string, "DEMOGRAPHICS" | "IT_HEALTH" | "BUSINESS_VALUE" | "FINANCE"> = {
  demographics: "DEMOGRAPHICS",
  "it-health": "IT_HEALTH",
  "business-value": "BUSINESS_VALUE",
  finance: "FINANCE",
};

/**
 * Per-respondent breakdown for ONE application + survey (MULTI-RESPONDENT-SURVEYS
 * .md §9), Lead/Consultant only (S3). The cross-app filterable version lives at
 * /e/[id]/responses; both render the shared ResponsesTable.
 */
export default async function ResponsesReportPage({
  params,
}: {
  params: Promise<{ engagementId: string; applicationId: string; type: string }>;
}) {
  const { engagementId, applicationId, type } = await params;
  const templateType = SLUG_TO_TYPE[type];
  if (!templateType) notFound();

  const { ctx, db, engagement } = await requireEngagementContext(engagementId);
  if (ctx.role !== "ENGAGEMENT_LEAD" && ctx.role !== "CONSULTANT") notFound();

  const app = await db.application.findUnique({ where: { id: applicationId }, select: { id: true, name: true, appNumber: true } });
  if (!app) notFound();

  const template = await db.surveyTemplate.findFirst({
    where: { type: templateType },
    include: { questions: { orderBy: { orderIndex: "asc" }, select: { id: true, section: true, text: true, answerKind: true, scoreFamily: true } } },
  });
  if (!template || template.questions.length === 0) notFound();

  const responses = await db.surveyResponse.findMany({
    where: { applicationId: app.id, templateId: template.id },
    select: {
      kind: true,
      status: true,
      updatedAt: true,
      finalizedAt: true,
      respondent: { select: { displayName: true, email: true } },
      answers: { select: { questionId: true, isNA: true, numericValue: true, textValue: true, boolValue: true, updatedAt: true } },
    },
  });

  const consensus = responses.find((r) => r.kind === "CONSENSUS") ?? null;
  const respondents = responses
    .filter((r) => r.kind === "RESPONDENT")
    .map((r) => ({
      label: r.respondent?.displayName ?? r.respondent?.email ?? "Respondent",
      status: r.status,
      updatedAt: r.updatedAt,
      byQuestion: new Map<string, AnswerCell>(r.answers.map((a) => [a.questionId, a])),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const consensusByQuestion = new Map<string, AnswerCell>((consensus?.answers ?? []).map((a) => [a.questionId, a]));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{template.name} — respondent breakdown</h1>
          <p className="text-muted-foreground text-sm">
            {app.name} (#{app.appNumber}){consensus?.finalizedAt ? " · finalized" : ""}
          </p>
        </div>
        <Link href={`/e/${engagementId}/surveys/${app.id}/${type}`} className="text-muted-foreground text-sm hover:underline">
          ← Back to survey
        </Link>
      </div>

      {respondents.length === 0 && !consensus ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">No responses recorded for this survey yet.</CardContent>
        </Card>
      ) : (
        <ResponsesTable
          questions={template.questions}
          respondents={respondents}
          consensusByQuestion={consensusByQuestion}
          currency={engagement.currency}
        />
      )}
    </div>
  );
}
