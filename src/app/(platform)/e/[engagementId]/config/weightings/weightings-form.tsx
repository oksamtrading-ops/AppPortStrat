"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { deriveWeights, IMPORTANCE_LABELS, RATING_VALUES } from "@/lib/methodology";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { updateWeightings } from "./actions";

export interface WeightingRow {
  questionId: string;
  code: string;
  text: string;
  section: string;
  family: "BUSINESS" | "IT" | "IT_NON_REPORT";
  rating: number;
}

const FAMILY_TITLES: Record<WeightingRow["family"], string> = {
  BUSINESS: "Business Value (11 questions)",
  IT: "IT Health (24 questions)",
  IT_NON_REPORT: "Non-report IT questions (informational score only)",
};

export function WeightingsForm({
  engagementId,
  rows,
  aps50Codes,
  readOnly,
}: {
  engagementId: string;
  rows: WeightingRow[];
  aps50Codes: string[];
  readOnly: boolean;
}) {
  const [ratings, setRatings] = useState<Record<string, number>>(
    Object.fromEntries(rows.map((r) => [r.questionId, r.rating])),
  );
  const [isPending, startTransition] = useTransition();

  // Live derived weights via the SAME pure function the server uses.
  const weightsByQuestion = useMemo(() => {
    const out = new Map<string, number>();
    for (const family of ["BUSINESS", "IT", "IT_NON_REPORT"] as const) {
      const familyRows = rows.filter((r) => r.family === family);
      const derived = deriveWeights(new Map(familyRows.map((r) => [r.questionId, ratings[r.questionId] ?? 0])));
      for (const [questionId, w] of derived) out.set(questionId, w);
    }
    return out;
  }, [rows, ratings]);

  function applyPreset(preset: "NEUTRAL" | "APS50") {
    const next: Record<string, number> = {};
    for (const r of rows) {
      if (preset === "NEUTRAL") next[r.questionId] = 2;
      else next[r.questionId] = r.family === "IT_NON_REPORT" ? 2 : aps50Codes.includes(r.code) ? 5 : 0;
    }
    setRatings(next);
  }

  function save() {
    startTransition(async () => {
      try {
        const result = await updateWeightings({
          engagementId,
          ratings: rows.map((r) => ({ questionId: r.questionId, rating: ratings[r.questionId] ?? 0 })),
        });
        toast.success(
          `Saved ${result.changed} change${result.changed === 1 ? "" : "s"} — portfolio recomputed (${result.appCount} apps, ${result.durationMs}ms)`,
        );
      } catch {
        toast.error("Could not save weightings");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => applyPreset("NEUTRAL")} disabled={readOnly}>
          Reset all to “Normal”
        </Button>
        <Button variant="outline" size="sm" onClick={() => applyPreset("APS50")} disabled={readOnly}>
          Apply APS 5.0 sample config
        </Button>
        <div className="flex-1" />
        <Button onClick={save} disabled={isPending || readOnly}>
          {isPending ? "Saving + recomputing…" : "Save & recompute"}
        </Button>
      </div>

      {(["BUSINESS", "IT", "IT_NON_REPORT"] as const).map((family) => {
        const familyRows = rows.filter((r) => r.family === family);
        if (familyRows.length === 0) return null;
        const familySum = familyRows.reduce((acc, r) => acc + (weightsByQuestion.get(r.questionId) ?? 0), 0);
        const sections = [...new Set(familyRows.map((r) => r.section))];
        return (
          <div key={family}>
            <h2 className="mb-2 font-medium">{FAMILY_TITLES[family]}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Question</TableHead>
                  <TableHead className="w-48">Importance</TableHead>
                  <TableHead className="w-24 text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sections.map((section) => (
                  <SectionRows
                    key={section}
                    section={section}
                    rows={familyRows.filter((r) => r.section === section)}
                    ratings={ratings}
                    weights={weightsByQuestion}
                    disabled={readOnly}
                    onChange={(questionId, rating) => setRatings((prev) => ({ ...prev, [questionId]: rating }))}
                  />
                ))}
                <TableRow>
                  <TableCell className="font-medium">Family total</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-medium tabular-nums">
                    {(familySum * 100).toFixed(0)}%
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}

function SectionRows({
  section,
  rows,
  ratings,
  weights,
  disabled,
  onChange,
}: {
  section: string;
  rows: WeightingRow[];
  ratings: Record<string, number>;
  weights: Map<string, number>;
  disabled: boolean;
  onChange: (questionId: string, rating: number) => void;
}) {
  return (
    <>
      <TableRow className="bg-secondary/60 hover:bg-secondary/60">
        <TableCell colSpan={3} className="text-muted-foreground py-1 text-xs font-semibold uppercase tracking-wide">
          {section}
        </TableCell>
      </TableRow>
      {rows.map((row) => (
        <TableRow key={row.questionId}>
          <TableCell>{row.text}</TableCell>
          <TableCell>
            <select
              className="h-8 w-full rounded border bg-background px-1 text-sm"
              value={ratings[row.questionId] ?? 0}
              disabled={disabled}
              onChange={(e) => onChange(row.questionId, Number(e.target.value))}
              aria-label={`Importance for ${row.text}`}
            >
              {IMPORTANCE_LABELS.map((label) => (
                <option key={label} value={RATING_VALUES[label]}>
                  {label}
                </option>
              ))}
            </select>
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {((weights.get(row.questionId) ?? 0) * 100).toFixed(1)}%
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
