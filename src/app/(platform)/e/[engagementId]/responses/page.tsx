import { notFound } from "next/navigation";
import Link from "next/link";
import { requireEngagementContext } from "@/lib/auth/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ResponsesTable, type AnswerCell, type RespondentColumn } from "@/components/surveys/responses-table";

export const dynamic = "force-dynamic";

/**
 * Survey Responses report — the cross-app, filterable view of the scored
 * surveys (MULTI-RESPONDENT-SURVEYS.md §9 follow-up). Pick a scored survey (IT
 * Health or Business Value — the multi-rater ones; Demographics/Finance are
 * single-response facts and excluded) and an application; see every
 * respondent's answers beside the average, consensus, and final. Lead/Consultant
 * only (S3). Reuses the per-app breakdown's ResponsesTable.
 */
export default async function SurveyResponsesReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<{ survey?: string; app?: string }>;
}) {
  const { engagementId } = await params;
  const sp = await searchParams;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId);
  if (ctx.role !== "ENGAGEMENT_LEAD" && ctx.role !== "CONSULTANT") notFound();

  const surveySlug = sp.survey === "business-value" ? "business-value" : "it-health";
  const templateType = surveySlug === "business-value" ? "BUSINESS_VALUE" : "IT_HEALTH";

  const [template, apps] = await Promise.all([
    db.surveyTemplate.findFirst({
      where: { type: templateType },
      include: { questions: { orderBy: { orderIndex: "asc" }, select: { id: true, section: true, text: true, answerKind: true, scoreFamily: true } } },
    }),
    db.application.findMany({ orderBy: { appNumber: "asc" }, select: { id: true, name: true, appNumber: true } }),
  ]);
  if (!template) notFound();

  const selectedAppId = sp.app && apps.some((a) => a.id === sp.app) ? sp.app : apps[0]?.id;
  const selectedApp = apps.find((a) => a.id === selectedAppId) ?? null;

  let respondents: RespondentColumn[] = [];
  let consensusByQuestion = new Map<string, AnswerCell>();
  let finalized = false;
  if (selectedApp) {
    const responses = await db.surveyResponse.findMany({
      where: { applicationId: selectedApp.id, templateId: template.id },
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
    finalized = consensus?.finalizedAt != null;
    respondents = responses
      .filter((r) => r.kind === "RESPONDENT")
      .map((r) => ({
        label: r.respondent?.displayName ?? r.respondent?.email ?? "Respondent",
        status: r.status,
        updatedAt: r.updatedAt,
        byQuestion: new Map<string, AnswerCell>(r.answers.map((a) => [a.questionId, a])),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    consensusByQuestion = new Map<string, AnswerCell>((consensus?.answers ?? []).map((a) => [a.questionId, a]));
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Survey responses</h1>
        <p className="text-muted-foreground text-sm">
          Compare every respondent&apos;s answers with the average for a scored survey. Diverging questions are
          highlighted. Demographics &amp; Finance are single-response and not shown here.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <div className="bg-secondary flex rounded-lg p-0.5">
          {(
            [
              ["it-health", "IT Health"],
              ["business-value", "Business Value"],
            ] as const
          ).map(([slug, label]) => (
            <Link
              key={slug}
              href={`?${new URLSearchParams({ survey: slug, ...(selectedAppId ? { app: selectedAppId } : {}) })}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                surveySlug === slug ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
        <input type="hidden" name="survey" value={surveySlug} />
        <select name="app" defaultValue={selectedAppId ?? ""} className="h-9 rounded-lg border bg-background px-2 text-sm">
          {apps.map((a) => (
            <option key={a.id} value={a.id}>
              #{a.appNumber} — {a.name}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline" className="h-9">
          Apply
        </Button>
        {selectedApp ? (
          <span className="text-muted-foreground text-sm">
            {template.name} · {selectedApp.name}
            {finalized ? " · finalized" : ""}
          </span>
        ) : null}
      </form>

      {!selectedApp ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">No applications yet.</CardContent>
        </Card>
      ) : respondents.length === 0 && consensusByQuestion.size === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-8 text-center text-sm">
            No responses recorded for this survey yet.
          </CardContent>
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
