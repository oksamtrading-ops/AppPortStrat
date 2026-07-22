import { notFound } from "next/navigation";
import Link from "next/link";
import { requireEngagementContext } from "@/lib/auth/context";
import { formatMoney } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const SLUG_TO_TYPE: Record<string, "DEMOGRAPHICS" | "IT_HEALTH" | "BUSINESS_VALUE" | "FINANCE"> = {
  demographics: "DEMOGRAPHICS",
  "it-health": "IT_HEALTH",
  "business-value": "BUSINESS_VALUE",
  finance: "FINANCE",
};

interface AnswerCell {
  isNA: boolean;
  numericValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
}

/** Human-readable value for one answer cell (— = unanswered). */
function fmt(a: AnswerCell | undefined, kind: string, currency: string): string {
  if (!a) return "—";
  if (a.isNA) return "N/A";
  switch (kind) {
    case "SCORE_1_5":
    case "NUMBER":
      return a.numericValue != null ? String(Math.round(a.numericValue * 10) / 10) : "—";
    case "CURRENCY":
      return a.numericValue != null ? formatMoney(a.numericValue, currency) : "—";
    case "BOOLEAN":
      return a.boolValue == null ? "—" : a.boolValue ? "Yes" : "No";
    default: // TEXT / DATE / OPTION
      return a.textValue ?? "—";
  }
}

/**
 * Per-respondent survey report (MULTI-RESPONDENT-SURVEYS.md §9) — Lead/Consultant
 * only. Each question shows every respondent's answer, the average (scored) or
 * the settled value, the consensus, and the final value used by the scorer,
 * with divergence highlighted.
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
  // Client-staff answers are sensitive — the per-respondent breakdown is
  // engagement-team only (sign-off S3). Respondents/viewers never reach it.
  if (ctx.role !== "ENGAGEMENT_LEAD" && ctx.role !== "CONSULTANT") notFound();

  const app = await db.application.findUnique({ where: { id: applicationId }, select: { id: true, name: true, appNumber: true } });
  if (!app) notFound();

  const template = await db.surveyTemplate.findFirst({
    where: { type: templateType },
    include: { questions: { orderBy: { orderIndex: "asc" }, select: { id: true, code: true, section: true, text: true, answerKind: true, scoreFamily: true } } },
  });
  if (!template || template.questions.length === 0) notFound();

  const responses = await db.surveyResponse.findMany({
    where: { applicationId: app.id, templateId: template.id },
    select: {
      kind: true,
      status: true,
      updatedAt: true,
      finalizedAt: true,
      respondentMembershipId: true,
      respondent: { select: { displayName: true, email: true } },
      answers: { select: { questionId: true, isNA: true, numericValue: true, textValue: true, boolValue: true, updatedAt: true } },
    },
  });

  const currency = engagement.currency;
  const consensus = responses.find((r) => r.kind === "CONSENSUS") ?? null;
  const respondents = responses
    .filter((r) => r.kind === "RESPONDENT")
    .map((r) => ({
      label: r.respondent?.displayName ?? r.respondent?.email ?? "Respondent",
      status: r.status,
      updatedAt: r.updatedAt,
      byQuestion: new Map(r.answers.map((a) => [a.questionId, a])),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const consensusByQuestion = new Map((consensus?.answers ?? []).map((a) => [a.questionId, a]));

  // Group questions by section, preserving order.
  const sections: { section: string; questions: typeof template.questions }[] = [];
  for (const q of template.questions) {
    let s = sections.at(-1);
    if (!s || s.section !== q.section) sections.push((s = { section: q.section, questions: [] }));
    s.questions.push(q);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{template.name} — respondent breakdown</h1>
          <p className="text-muted-foreground text-sm">
            {app.name} (#{app.appNumber})
            {consensus?.finalizedAt ? " · finalized" : ""}
          </p>
        </div>
        <Link href={`/e/${engagementId}/surveys/${app.id}/${type}`} className="text-muted-foreground text-sm hover:underline">
          ← Back to survey
        </Link>
      </div>

      {respondents.length === 0 && !consensus ? (
        <p className="text-muted-foreground text-sm">No responses recorded for this survey yet.</p>
      ) : (
        <>
          <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
            {respondents.map((r) => (
              <span key={r.label} className="flex items-center gap-1">
                <Badge variant={r.status === "COMPLETE" ? "default" : "outline"}>{r.label}</Badge>
                <span className="tabular-nums">{formatDateTime(r.updatedAt)}</span>
              </span>
            ))}
            {respondents.length === 0 ? <span>No individual respondents — consensus/workshop only.</span> : null}
          </div>

          {sections.map(({ section, questions }) => (
            <Card key={section}>
              <CardHeader>
                <CardTitle className="text-base">{section}</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-48">Question</TableHead>
                      {respondents.map((r) => (
                        <TableHead key={r.label} className="text-center">{r.label}</TableHead>
                      ))}
                      {/* Average only meaningful for scored questions */}
                      <TableHead className="text-center">Average</TableHead>
                      <TableHead className="text-center">Consensus</TableHead>
                      <TableHead className="text-center font-semibold">Final</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questions.map((q) => {
                      const scored = q.scoreFamily !== "NONE";
                      // Respondent 1–5 answers → the average (matches the scorer's aggregation).
                      const respNums: number[] = [];
                      for (const r of respondents) {
                        const a = r.byQuestion.get(q.id);
                        if (q.answerKind === "SCORE_1_5" && a && !a.isNA && a.numericValue != null) respNums.push(a.numericValue);
                      }
                      const avg = respNums.length ? respNums.reduce((s, v) => s + v, 0) / respNums.length : null;
                      const cons = consensusByQuestion.get(q.id);
                      const consPresent = cons != null;
                      // Latest respondent answer by updatedAt (fact final = latest-wins, S1).
                      let latestFact: AnswerCell | undefined;
                      let latestAt = -Infinity;
                      for (const r of respondents) {
                        const a = r.byQuestion.get(q.id);
                        if (a && a.updatedAt.getTime() > latestAt) {
                          latestAt = a.updatedAt.getTime();
                          latestFact = a;
                        }
                      }
                      // Final = consensus ?? (scored: average; fact: latest respondent).
                      const finalText = consPresent
                        ? fmt(cons, q.answerKind, currency)
                        : scored
                          ? avg != null ? String(Math.round(avg * 10) / 10) : "—"
                          : fmt(latestFact, q.answerKind, currency);
                      // Divergence: scored spread ≥ 2, or consensus overriding the average.
                      const spread = respNums.length > 1 ? Math.max(...respNums) - Math.min(...respNums) : 0;
                      const diverges = scored && (spread >= 2 || (consPresent && avg != null && cons?.numericValue != null && Math.abs(cons.numericValue - avg) >= 1));
                      return (
                        <TableRow key={q.id} className={diverges ? "bg-amber-50" : undefined}>
                          <TableCell className="text-sm">
                            {q.text}
                            {diverges ? <span className="ml-1 text-amber-700" title="Respondents diverge / consensus overrides">⚠</span> : null}
                          </TableCell>
                          {respondents.map((r) => (
                            <TableCell key={r.label} className="text-center text-sm tabular-nums">
                              {fmt(r.byQuestion.get(q.id), q.answerKind, currency)}
                            </TableCell>
                          ))}
                          <TableCell className="text-center text-sm tabular-nums">
                            {scored && avg != null ? Math.round(avg * 10) / 10 : "—"}
                          </TableCell>
                          <TableCell className="text-center text-sm tabular-nums">{consPresent ? fmt(cons, q.answerKind, currency) : "—"}</TableCell>
                          <TableCell className="text-center text-sm font-medium tabular-nums">{finalText}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
