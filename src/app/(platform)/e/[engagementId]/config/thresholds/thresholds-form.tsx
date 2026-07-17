"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { updateThresholds } from "./actions";

export interface ThresholdValues {
  optBv: number;
  urgBv: number;
  optIt: number;
  urgIt: number;
  heatT1: number;
  heatT2: number;
  strictWorkbookScoring: boolean;
}

export function ThresholdsForm({
  engagementId,
  initial,
  readOnly,
}: {
  engagementId: string;
  initial: ThresholdValues;
  readOnly: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [isPending, startTransition] = useTransition();

  const heatInvalid = values.heatT2 <= values.heatT1;

  function set<K extends keyof ThresholdValues>(key: K, value: ThresholdValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      try {
        const result = await updateThresholds({ engagementId, ...values });
        toast.success(`Thresholds saved — portfolio recomputed (${result.appCount} apps, ${result.durationMs}ms)`);
      } catch {
        toast.error("Could not save thresholds");
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Disposition thresholds</CardTitle>
          <CardDescription>
            0–5 in 0.1 steps. A score exactly equal to an Optimum threshold counts as “high” (workbook-faithful
            ≥ boundary). Urgent thresholds drive alert counts only — never a fifth disposition.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <ScoreInput label="Optimum Business Value" value={values.optBv} onChange={(v) => set("optBv", v)} disabled={readOnly} />
          <ScoreInput label="Optimum IT Health" value={values.optIt} onChange={(v) => set("optIt", v)} disabled={readOnly} />
          <ScoreInput label="Urgent Business Value" value={values.urgBv} onChange={(v) => set("urgBv", v)} disabled={readOnly} />
          <ScoreInput label="Urgent IT Health" value={values.urgIt} onChange={(v) => set("urgIt", v)} disabled={readOnly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Heat map thresholds</CardTitle>
          <CardDescription>
            A capability cell turns red when strictly more than T₁ of its known-disposition apps are Terminate,
            yellow when Re-Tool/Re-Design exceed T₂ − T₁, green otherwise. Retain share is always derived as
            1 − T₂.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <PercentInput label="T₁ — Terminate share" value={values.heatT1} onChange={(v) => set("heatT1", v)} disabled={readOnly} />
          <PercentInput label="T₂ — Terminate + Re-Tool/Re-Design share" value={values.heatT2} onChange={(v) => set("heatT2", v)} disabled={readOnly} />
          <div className="space-y-1">
            <Label>Retain share (derived)</Label>
            <div className="flex h-9 items-center rounded-md border bg-secondary px-3 text-sm tabular-nums">
              {((1 - values.heatT2) * 100).toFixed(0)}%
            </div>
          </div>
          {heatInvalid ? (
            <p className="text-destructive col-span-full text-sm">
              The Re-Tool/Re-Design/Terminate share (T₂) must exceed the Terminate share (T₁).
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scoring mode</CardTitle>
        </CardHeader>
        <CardContent className="flex items-start gap-3">
          <Switch
            id="strict"
            checked={values.strictWorkbookScoring}
            onCheckedChange={(checked) => set("strictWorkbookScoring", checked)}
            disabled={readOnly}
          />
          <div>
            <Label htmlFor="strict">Strict workbook scoring (legacy)</Label>
            <p className="text-muted-foreground text-sm">
              Default (off): unanswered questions are excluded and the score renormalizes, with a
              partial-survey warning. Strict (on) replicates the original workbook exactly: unanswered
              questions silently deflate the score. Turn this on only if continuity with an in-flight APS 5.0
              workbook engagement is required.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={isPending || heatInvalid || readOnly}>
        {isPending ? "Saving + recomputing…" : "Save & recompute"}
      </Button>
    </div>
  );
}

function ScoreInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        max={5}
        step={0.1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function PercentInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
        />
        <span className="text-muted-foreground text-sm">%</span>
      </div>
    </div>
  );
}
