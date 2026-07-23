import { formatMoney } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from "@/components/ui/table";

/**
 * Shared per-respondent answer table (MULTI-RESPONDENT-SURVEYS.md §9), used by
 * both the per-app breakdown page and the standalone Survey Responses report.
 * One row per question (grouped by section); one column per respondent, plus
 * Average (scored), Consensus, and the Final value the scorer uses. Divergence
 * highlighted. Read-only; server-rendered.
 */
export interface AnswerCell {
  isNA: boolean;
  numericValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
  updatedAt?: Date;
}

export interface RespondentColumn {
  label: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";
  updatedAt: Date;
  byQuestion: Map<string, AnswerCell>;
}

export interface ReportQuestion {
  id: string;
  section: string;
  text: string;
  answerKind: string;
  scoreFamily: string;
}

/** Human-readable value for one answer cell (— = unanswered). */
export function formatAnswer(a: AnswerCell | undefined, kind: string, currency: string): string {
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
    default:
      return a.textValue ?? "—";
  }
}

export function ResponsesTable({
  questions,
  respondents,
  consensusByQuestion,
  currency,
}: {
  questions: ReportQuestion[];
  respondents: RespondentColumn[];
  consensusByQuestion: Map<string, AnswerCell>;
  currency: string;
}) {
  const sections: { section: string; questions: ReportQuestion[] }[] = [];
  for (const q of questions) {
    let s = sections.at(-1);
    if (!s || s.section !== q.section) sections.push((s = { section: q.section, questions: [] }));
    s.questions.push(q);
  }

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground flex flex-wrap gap-3 text-xs">
        {respondents.map((r) => (
          <span key={r.label} className="flex items-center gap-1">
            <Badge variant={r.status === "COMPLETE" ? "default" : "outline"}>{r.label}</Badge>
            <span className="tabular-nums">{formatDateTime(r.updatedAt)}</span>
          </span>
        ))}
        {respondents.length === 0 ? <span>No individual respondents — consensus/workshop only.</span> : null}
      </div>

      {sections.map(({ section, questions: sectionQuestions }) => (
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
                  <TableHead className="text-center">Average</TableHead>
                  <TableHead className="text-center">Consensus</TableHead>
                  <TableHead className="text-center font-semibold">Final</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectionQuestions.map((q) => {
                  const scored = q.scoreFamily !== "NONE";
                  const respNums: number[] = [];
                  for (const r of respondents) {
                    const a = r.byQuestion.get(q.id);
                    if (q.answerKind === "SCORE_1_5" && a && !a.isNA && a.numericValue != null) respNums.push(a.numericValue);
                  }
                  const avg = respNums.length ? respNums.reduce((s, v) => s + v, 0) / respNums.length : null;
                  const cons = consensusByQuestion.get(q.id);
                  const consPresent = cons != null;
                  let latestFact: AnswerCell | undefined;
                  let latestAt = -Infinity;
                  for (const r of respondents) {
                    const a = r.byQuestion.get(q.id);
                    if (a && (a.updatedAt?.getTime() ?? 0) > latestAt) {
                      latestAt = a.updatedAt?.getTime() ?? 0;
                      latestFact = a;
                    }
                  }
                  const finalText = consPresent
                    ? formatAnswer(cons, q.answerKind, currency)
                    : scored
                      ? avg != null ? String(Math.round(avg * 10) / 10) : "—"
                      : formatAnswer(latestFact, q.answerKind, currency);
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
                          {formatAnswer(r.byQuestion.get(q.id), q.answerKind, currency)}
                        </TableCell>
                      ))}
                      <TableCell className="text-center text-sm tabular-nums">
                        {scored && avg != null ? Math.round(avg * 10) / 10 : "—"}
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">{consPresent ? formatAnswer(cons, q.answerKind, currency) : "—"}</TableCell>
                      <TableCell className="text-center text-sm font-medium tabular-nums">{finalText}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
