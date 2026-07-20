"use client";

import { useEffect, useState, useTransition } from "react";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateAiNarrative } from "@/app/(platform)/e/[engagementId]/dashboard/ai-actions";

/**
 * The shared AI surface: a NON-MODAL right slide-over (no backdrop — the
 * dashboard stays scrollable so narratives can be verified against the live
 * charts). Trigger renders inline in the header; the panel is fixed. Output
 * is a labeled draft, kept in state across close/reopen within the visit.
 */
export function AiPanel({ engagementId }: { engagementId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<"landscape" | "brief" | null>(null);
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function run(k: "landscape" | "brief") {
    setKind(k);
    startTransition(async () => {
      const result = await generateAiNarrative({ engagementId, kind: k });
      if (result.ok) setText(result.text);
      else toast.error(result.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium"
      >
        <Sparkles className="size-4" /> AI narrative
      </button>

      <aside
        role="complementary"
        aria-label="AI narrative"
        aria-hidden={!open}
        className={`fixed top-12 right-0 z-40 flex h-[calc(100vh-3rem)] w-full flex-col border-l bg-background shadow-xl transition-transform duration-200 sm:w-[420px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4" /> AI narrative
          </span>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setOpen(false)} aria-label="Close panel">
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex gap-2 border-b px-4 py-3">
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("landscape")}>
            {isPending && kind === "landscape" ? "Explaining…" : "Explain this landscape"}
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("brief")}>
            {isPending && kind === "brief" ? "Writing…" : "Engagement brief"}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {text ? (
            <div className="text-sm whitespace-pre-wrap">{text}</div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Plain-language explanation of the portfolio, or a one-page engagement brief — generated only from this
              engagement&apos;s computed figures. The dashboard stays usable while you read.
            </p>
          )}
        </div>

        {text ? (
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-4 py-2 text-xs">
            <span>AI-generated draft — review before sharing.</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
            >
              Copy
            </Button>
          </div>
        ) : null}
      </aside>
    </>
  );
}
