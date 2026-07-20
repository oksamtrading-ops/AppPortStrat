"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { runQualityChecksAction } from "@/app/(platform)/e/[engagementId]/quality/ai-map-actions";
import type { QualityFinding } from "@/lib/ai/quality";

const SEVERITY_STYLE: Record<QualityFinding["severity"], string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-gray-100 text-gray-700",
};

/** AI anomaly scan over survey data — findings with cited evidence, no writes. */
export function AiQualityPanel({ engagementId }: { engagementId: string }) {
  const [isPending, startTransition] = useTransition();
  const [findings, setFindings] = useState<QualityFinding[] | null>(null);

  function run() {
    startTransition(async () => {
      const result = await runQualityChecksAction({ engagementId });
      if (!result.ok) return void toast.error(result.error);
      setFindings(result.findings);
      if (result.findings.length === 0) toast.success("No anomalies found");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" /> AI quality checks
        </CardTitle>
        <CardDescription>
          Anomalies the deterministic checks can&apos;t see: straight-lined surveys, scores contradicting comments,
          duplicate-looking applications. Findings only, each with its evidence — nothing is changed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" variant="outline" onClick={run} disabled={isPending}>
          {isPending ? "Scanning…" : findings ? "Re-run checks" : "Run AI checks"}
        </Button>
        {findings && findings.length > 0 ? (
          <div className="max-h-80 space-y-1.5 overflow-y-auto">
            {findings.map((f, i) => (
              <div key={i} className="rounded border px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
                  <span className="text-muted-foreground text-xs">{f.type}</span>
                  <span className="font-medium">{f.appName}</span>
                </div>
                <p className="mt-1">{f.finding}</p>
                <p className="text-muted-foreground mt-0.5 text-xs">Evidence: {f.evidence}</p>
              </div>
            ))}
          </div>
        ) : findings ? (
          <p className="text-muted-foreground text-sm">No anomalies found across the scanned survey data.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
