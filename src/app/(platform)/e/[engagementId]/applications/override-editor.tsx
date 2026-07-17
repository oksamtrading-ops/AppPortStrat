"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DISPOSITION_LABELS } from "@/lib/methodology";
import { Button } from "@/components/ui/button";
import { setDispositionOverride } from "./actions";

const OVERRIDABLE = ["REDESIGN", "KEEP_AS_IS", "TERMINATE", "RETOOL"] as const;

export function OverrideEditor({
  engagementId,
  applicationId,
  current,
}: {
  engagementId: string;
  applicationId: string;
  current: { disposition: string; justification: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [disposition, setDisposition] = useState<string>(current?.disposition ?? "");
  const [justification, setJustification] = useState(current?.justification ?? "");
  const [isPending, startTransition] = useTransition();

  function save(clear: boolean) {
    startTransition(async () => {
      try {
        await setDispositionOverride({
          engagementId,
          applicationId,
          disposition: clear ? null : (disposition as (typeof OVERRIDABLE)[number]),
          justification,
        });
        toast.success(clear ? "Override cleared" : "Override saved");
        setOpen(false);
      } catch {
        toast.error(clear ? "Could not clear override" : "An override needs a 4R value and a justification");
      }
    });
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
        {current ? "Edit override" : "Override"}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded border bg-secondary/50 p-2">
      <select
        className="h-7 rounded border bg-background px-1 text-xs"
        value={disposition}
        onChange={(e) => setDisposition(e.target.value)}
        aria-label="Override disposition"
      >
        <option value="">Choose disposition…</option>
        {OVERRIDABLE.map((d) => (
          <option key={d} value={d}>
            {DISPOSITION_LABELS[d]}
          </option>
        ))}
      </select>
      <textarea
        className="min-h-14 rounded border bg-background p-1 text-xs"
        placeholder="Justification (required)"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <div className="flex gap-1">
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          disabled={isPending || !disposition || justification.trim().length === 0}
          onClick={() => save(false)}
        >
          Save
        </Button>
        {current ? (
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={isPending} onClick={() => save(true)}>
            Clear
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
