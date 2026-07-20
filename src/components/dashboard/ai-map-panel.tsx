"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acceptMappingsAction,
  suggestMappingsAction,
} from "@/app/(platform)/e/[engagementId]/quality/ai-map-actions";
import type { MappingSuggestion } from "@/lib/ai/capability-map";

type Row = MappingSuggestion & { applicationId: string; accepted: boolean };

/** AI capability-mapping suggestions for unmapped in-scope apps — per-row accept. */
export function AiMapPanel({ engagementId, unmappedCount }: { engagementId: string; unmappedCount: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [rows, setRows] = useState<Row[] | null>(null);

  function suggest() {
    startTransition(async () => {
      const result = await suggestMappingsAction({ engagementId });
      if (!result.ok) return void toast.error(result.error);
      setRows(result.suggestions.map((s) => ({ ...s, accepted: Boolean(s.capability) && s.confidence >= 60 })));
    });
  }

  function accept() {
    const chosen = (rows ?? []).filter((r) => r.accepted && r.capability);
    if (chosen.length === 0) return void toast.error("No rows selected");
    startTransition(async () => {
      const result = await acceptMappingsAction({
        engagementId,
        rows: chosen.map((r) => ({ applicationId: r.applicationId, capability: r.capability! })),
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(`Mapped ${result.mapped} application${result.mapped === 1 ? "" : "s"}`);
      setRows(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" /> AI capability mapping
        </CardTitle>
        <CardDescription>
          {unmappedCount} in-scope application{unmappedCount === 1 ? " has" : "s have"} no capability — excluded from the
          heat map. Suggestions come only from this engagement&apos;s own tree; nothing is written until you accept.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rows ? (
          <Button size="sm" variant="outline" onClick={suggest} disabled={isPending}>
            {isPending ? "Suggesting…" : "Suggest mappings"}
          </Button>
        ) : (
          <>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {rows.map((r, i) => (
                <div key={r.applicationId} title={r.rationale} className="flex items-center gap-2 rounded border px-2 py-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={r.accepted}
                    disabled={!r.capability}
                    onChange={(e) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, accepted: e.target.checked } : x)))}
                  />
                  <span className="flex-1 truncate font-medium">{r.appName}</span>
                  <span className="text-muted-foreground w-48 truncate text-xs">{r.capability ?? "no fit found"}</span>
                  <span
                    className={`w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium tabular-nums ${
                      r.confidence >= 90 ? "bg-green-100 text-green-800" : r.confidence >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {r.confidence}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Hover a row for the AI&apos;s rationale.</span>
              <Button size="sm" onClick={accept} disabled={isPending}>
                {isPending ? "Mapping…" : `Accept ${rows.filter((r) => r.accepted).length} mapping(s)`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
