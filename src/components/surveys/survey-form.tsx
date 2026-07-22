"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveAnswer, setSurveyStatus, setSurveyFinalized, type SaveAnswerResult } from "@/app/(platform)/e/[engagementId]/surveys/actions";

export interface SurveyQuestionView {
  id: string;
  code: string;
  section: string;
  text: string;
  description: string | null;
  answerKind: "SCORE_1_5" | "TEXT" | "NUMBER" | "CURRENCY" | "DATE" | "BOOLEAN" | "OPTION";
  anchors: Array<{ value: number; text: string }>;
  options: string[];
}

export interface AnswerView {
  isNA: boolean;
  numericValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
}

type SaveState = "idle" | "saving" | "saved" | "error";

export function SurveyForm({
  engagementId,
  applicationId,
  templateId,
  templateName,
  applicationName,
  isFinance,
  currency,
  questions,
  initialAnswers,
  initialStatus,
  initialCompletion,
  readOnly,
  finalized,
  canFinalize,
  reportHref,
}: {
  engagementId: string;
  applicationId: string;
  templateId: string;
  templateName: string;
  applicationName: string;
  isFinance: boolean;
  currency: string;
  questions: SurveyQuestionView[];
  initialAnswers: Record<string, AnswerView>;
  initialStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE";
  initialCompletion: { answeredCount: number; applicableCount: number };
  readOnly: boolean;
  /** The consensus layer's respondent-input lock (multi-respondent §6). */
  finalized: boolean;
  /** Lead/Consultant: may Finalize/Reopen the survey. */
  canFinalize: boolean;
  /** Lead/Consultant: link to the per-respondent breakdown report (§9). */
  reportHref?: string;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerView>>(initialAnswers);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [status, setStatus] = useState(initialStatus);
  const [isFinalized, setIsFinalized] = useState(finalized);
  const [completion, setCompletion] = useState(initialCompletion);
  const [scores, setScores] = useState<{ bv: string; it: string } | null>(null);
  const [, startTransition] = useTransition();

  const sections = useMemo(() => {
    const bySection = new Map<string, SurveyQuestionView[]>();
    for (const q of questions) {
      if (!bySection.has(q.section)) bySection.set(q.section, []);
      bySection.get(q.section)!.push(q);
    }
    return [...bySection.entries()];
  }, [questions]);

  function isAnswered(a: AnswerView | undefined): boolean {
    return Boolean(a && (a.isNA || a.numericValue !== null || (a.textValue !== null && a.textValue !== "") || a.boolValue !== null));
  }

  function save(question: SurveyQuestionView, raw: number | string | boolean | null, view: AnswerView | null) {
    if (readOnly) return;
    setAnswers((prev) => {
      const next = { ...prev };
      if (view === null) delete next[question.id];
      else next[question.id] = view;
      return next;
    });
    setSaveStates((s) => ({ ...s, [question.id]: "saving" }));
    startTransition(async () => {
      try {
        const result: SaveAnswerResult = await saveAnswer({
          engagementId,
          applicationId,
          templateId,
          questionId: question.id,
          raw,
        });
        if (!result.ok) {
          setSaveStates((s) => ({ ...s, [question.id]: "error" }));
          toast.error(result.error);
          return;
        }
        setSaveStates((s) => ({ ...s, [question.id]: "saved" }));
        setCompletion(result.completion);
        setStatus(result.status);
        if (result.scores) setScores(result.scores);
      } catch {
        setSaveStates((s) => ({ ...s, [question.id]: "error" }));
        toast.error("Autosave failed — your last change was not stored");
      }
    });
  }

  function markStatus(next: "IN_PROGRESS" | "COMPLETE") {
    startTransition(async () => {
      try {
        const result = await setSurveyStatus({ engagementId, applicationId, templateId, status: next });
        setStatus(result.status);
        toast.success(next === "COMPLETE" ? "Survey marked complete" : "Survey reopened");
      } catch {
        toast.error("Could not update the survey status");
      }
    });
  }

  function markFinalized(next: boolean) {
    startTransition(async () => {
      try {
        const result = await setSurveyFinalized({ engagementId, applicationId, templateId, finalized: next });
        setIsFinalized(result.finalized);
        if (result.finalized) setStatus("COMPLETE");
        toast.success(next ? "Survey finalized — respondent input is locked" : "Survey reopened for respondent input");
      } catch {
        toast.error("Could not update the finalization");
      }
    });
  }

  const financeTotals = useMemo(() => {
    if (!isFinance) return null;
    const bySection = new Map<string, number>();
    let grand = 0;
    const GRAND_SECTIONS = new Set([
      "Hardware / Infrastructure Costs",
      "Application Maintenance Costs",
      "Application Development Costs",
      "Commercial Software Costs",
    ]);
    for (const q of questions) {
      if (q.answerKind !== "CURRENCY") continue;
      const v = answers[q.id]?.numericValue ?? 0;
      bySection.set(q.section, (bySection.get(q.section) ?? 0) + v);
      if (GRAND_SECTIONS.has(q.section)) grand += v;
    }
    return { bySection, grand };
  }, [isFinance, questions, answers]);

  const pct = completion.applicableCount === 0 ? 0 : Math.round((completion.answeredCount / completion.applicableCount) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{templateName}</h1>
          <p className="text-muted-foreground text-sm">{applicationName}</p>
          {reportHref && canFinalize ? (
            <a href={reportHref} className="text-muted-foreground text-xs hover:underline">
              View respondent breakdown →
            </a>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {scores ? (
            <span className="text-muted-foreground text-sm tabular-nums">
              BV {scores.bv} · IT {scores.it}
            </span>
          ) : null}
          <Badge variant={status === "COMPLETE" ? "default" : "outline"}>
            {status === "NOT_STARTED" ? "Not started" : status === "IN_PROGRESS" ? "In progress" : "Complete"}
          </Badge>
          <span className="text-muted-foreground text-sm tabular-nums">
            {completion.answeredCount}/{completion.applicableCount} ({pct}%)
          </span>
          {isFinalized ? <Badge>Finalized</Badge> : null}
          {canFinalize ? (
            // Survey-level lock (multi-respondent §6) — replaces the manual
            // per-layer buttons for the team; auto-complete still runs.
            isFinalized ? (
              <Button size="sm" variant="outline" onClick={() => markFinalized(false)}>
                Reopen
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => markFinalized(true)}>
                Finalize
              </Button>
            )
          ) : !readOnly ? (
            status === "COMPLETE" ? (
              <Button size="sm" variant="outline" onClick={() => markStatus("IN_PROGRESS")}>
                Reopen
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => markStatus("COMPLETE")}>
                Mark complete now
              </Button>
            )
          ) : null}
        </div>
      </div>

      {isFinalized && !canFinalize ? (
        <p className="-mt-3 text-xs font-medium text-amber-700">
          This survey has been finalized by the engagement team — answers are locked. Ask the engagement lead to reopen
          it if something needs correcting.
        </p>
      ) : null}
      {!readOnly && status !== "COMPLETE" ? (
        <p className="text-muted-foreground -mt-3 text-xs">
          This survey completes automatically once every question has an answer or an explicit N/A.
          {canFinalize
            ? " “Finalize” locks respondent input and settles the record."
            : " Use “Mark complete now” only to finish while leaving some questions blank."}
        </p>
      ) : null}

      {sections.map(([section, sectionQuestions]) => {
        const answered = sectionQuestions.filter((q) => isAnswered(answers[q.id])).length;
        return (
          <Card key={section}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{section}</span>
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {answered}/{sectionQuestions.length}
                  {financeTotals?.bySection.has(section) && sectionQuestions.some((q) => q.answerKind === "CURRENCY")
                    ? ` · subtotal ${formatCurrency(financeTotals.bySection.get(section) ?? 0, currency)}`
                    : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {sectionQuestions.map((q) => (
                <QuestionRow
                  key={q.id}
                  question={q}
                  answer={answers[q.id]}
                  saveState={saveStates[q.id] ?? "idle"}
                  readOnly={readOnly}
                  currency={currency}
                  onSave={(raw, view) => save(q, raw, view)}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}

      {isFinance && financeTotals ? (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <span className="font-medium">Grand total (Hardware + Maintenance + Development + Software)</span>
            <span className="text-lg font-semibold tabular-nums">{formatCurrency(financeTotals.grand, currency)}</span>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function QuestionRow({
  question,
  answer,
  saveState,
  readOnly,
  currency,
  onSave,
}: {
  question: SurveyQuestionView;
  answer: AnswerView | undefined;
  saveState: SaveState;
  readOnly: boolean;
  currency: string;
  onSave: (raw: number | string | boolean | null, view: AnswerView | null) => void;
}) {
  const na = answer?.isNA === true;
  const base: AnswerView = { isNA: false, numericValue: null, textValue: null, boolValue: null };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{question.text}</div>
          {question.description ? <div className="text-muted-foreground text-xs">{question.description}</div> : null}
        </div>
        <SaveIndicator state={saveState} />
      </div>

      {question.answerKind === "SCORE_1_5" ? (
        <div className="grid grid-cols-1 gap-1 md:grid-cols-6">
          {[1, 2, 3, 4, 5].map((v) => {
            const anchor = question.anchors.find((a) => a.value === v)?.text;
            const selected = !na && answer?.numericValue === v;
            return (
              <button
                key={v}
                type="button"
                disabled={readOnly}
                onClick={() => onSave(v, { ...base, numericValue: v })}
                className={cn(
                  "rounded-md border p-2 text-left text-xs transition-colors",
                  selected ? "border-brand bg-brand/10 font-medium" : "hover:border-brand/50",
                  readOnly && "opacity-60",
                )}
              >
                <span className="font-semibold">{v}</span>
                {anchor ? <span className="text-muted-foreground mt-0.5 block">{anchor}</span> : null}
              </button>
            );
          })}
          <button
            type="button"
            disabled={readOnly}
            onClick={() => (na ? onSave(null, null) : onSave("NA", { ...base, isNA: true }))}
            className={cn(
              "rounded-md border p-2 text-left text-xs transition-colors",
              na ? "border-brand bg-secondary font-medium" : "hover:border-brand/50",
              readOnly && "opacity-60",
            )}
          >
            <span className="font-semibold">N/A</span>
            <span className="text-muted-foreground mt-0.5 block">Not applicable to this application</span>
          </button>
        </div>
      ) : null}

      {question.answerKind === "TEXT" ? (
        <Input
          defaultValue={answer?.textValue ?? ""}
          disabled={readOnly || na}
          placeholder={na ? "N/A" : undefined}
          onBlur={(e) => {
            const v = e.target.value.trim();
            const previous = answer?.textValue ?? "";
            if (v === previous) return;
            if (v === "") onSave(null, null);
            else onSave(v, { ...base, textValue: v });
          }}
          className="h-8"
        />
      ) : null}

      {question.answerKind === "NUMBER" || question.answerKind === "CURRENCY" ? (
        <div className="flex items-center gap-1">
          {question.answerKind === "CURRENCY" ? <span className="text-muted-foreground text-xs">{currency}</span> : null}
          <Input
            type="number"
            step="any"
            defaultValue={answer?.numericValue ?? ""}
            disabled={readOnly || na}
            onBlur={(e) => {
              const rawText = e.target.value.trim();
              const previous = answer?.numericValue;
              if (rawText === "" && previous == null) return;
              if (rawText === "") return onSave(null, null);
              const v = Number(rawText);
              if (v === previous) return;
              onSave(v, { ...base, numericValue: v });
            }}
            className="h-8 max-w-48"
          />
        </div>
      ) : null}

      {question.answerKind === "DATE" ? (
        <Input
          type="date"
          defaultValue={answer?.textValue ?? ""}
          disabled={readOnly || na}
          onChange={(e) => {
            const v = e.target.value;
            if (v) onSave(v, { ...base, textValue: v });
          }}
          className="h-8 max-w-48"
        />
      ) : null}

      {question.answerKind === "BOOLEAN" ? (
        <div className="flex gap-1">
          {[
            [true, "Yes"],
            [false, "No"],
          ].map(([value, label]) => {
            const selected = !na && answer?.boolValue === value;
            return (
              <Button
                key={String(value)}
                type="button"
                size="sm"
                variant={selected ? "default" : "outline"}
                disabled={readOnly}
                onClick={() => (selected ? onSave(null, null) : onSave(value as boolean, { ...base, boolValue: value as boolean }))}
                className="h-7 px-3 text-xs"
              >
                {label as string}
              </Button>
            );
          })}
        </div>
      ) : null}

      {question.answerKind === "OPTION" ? (
        <select
          defaultValue={answer?.textValue ?? ""}
          disabled={readOnly || na}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") onSave(null, null);
            else onSave(v, { ...base, textValue: v });
          }}
          className="h-8 w-full max-w-72 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">—</option>
          {question.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : null}

      {question.answerKind !== "SCORE_1_5" && !readOnly ? (
        <button
          type="button"
          onClick={() => (na ? onSave(null, null) : onSave("NA", { ...base, isNA: true }))}
          className={cn("text-xs underline-offset-2 hover:underline", na ? "text-foreground font-medium" : "text-muted-foreground")}
        >
          {na ? "N/A — click to clear" : "Mark N/A"}
        </button>
      ) : null}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span
      className={cn(
        "shrink-0 text-[10px]",
        state === "saving" && "text-muted-foreground",
        state === "saved" && "text-brand",
        state === "error" && "text-destructive",
      )}
    >
      {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Failed"}
    </span>
  );
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
