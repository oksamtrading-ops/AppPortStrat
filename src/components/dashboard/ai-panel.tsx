"use client";

import { useEffect, useState, useTransition } from "react";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { askPortfolioAction, generateAiNarrative, generateAiReport } from "@/app/(platform)/e/[engagementId]/dashboard/ai-actions";

type Kind = "landscape" | "brief" | "report" | "qa";
type RefineInstruction = "tighten it" | "make it more formal" | "make it shorter";

/**
 * The shared AI surface: a NON-MODAL right slide-over (no backdrop — the
 * dashboard stays scrollable so narratives can be verified against the live
 * charts). Output is a labeled draft, kept in state across close/reopen
 * within the visit. The report runs the draft→critique→revise pipeline.
 */
export function AiPanel({ engagementId }: { engagementId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [textKind, setTextKind] = useState<Kind | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const [question, setQuestion] = useState("");

  function run(k: Kind) {
    setKind(k);
    startTransition(async () => {
      const result =
        k === "report"
          ? await generateAiReport({ engagementId })
          : k === "qa"
            ? await askPortfolioAction({ engagementId, question })
            : await generateAiNarrative({ engagementId, kind: k });
      if (result.ok) {
        setText(result.text);
        setTextKind(k);
      } else toast.error(result.error);
    });
  }

  function refine(instruction: RefineInstruction) {
    if (!text || (textKind !== "landscape" && textKind !== "brief")) return;
    setKind(textKind);
    startTransition(async () => {
      const result = await generateAiNarrative({ engagementId, kind: textKind, refine: { previousText: text, instruction } });
      if (result.ok) setText(result.text);
      else toast.error(result.error);
    });
  }

  function download() {
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "final-report.md";
    a.click();
    URL.revokeObjectURL(url);
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

        <div className="flex flex-wrap gap-2 border-b px-4 py-3">
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("landscape")}>
            {isPending && kind === "landscape" ? "Explaining…" : "Explain this landscape"}
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("brief")}>
            {isPending && kind === "brief" ? "Writing…" : "Engagement brief"}
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("report")}>
            {isPending && kind === "report" ? "Drafting, reviewing, revising…" : "Final report"}
          </Button>
        </div>

        <form
          className="flex gap-2 border-b px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim().length >= 3) run("qa");
          }}
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this portfolio…"
            className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
            maxLength={500}
          />
          <Button size="sm" variant="outline" type="submit" disabled={isPending || question.trim().length < 3}>
            {isPending && kind === "qa" ? "Answering…" : "Ask"}
          </Button>
        </form>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {text ? (
            <div className="text-sm whitespace-pre-wrap">{text}</div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Plain-language explanation, a one-page brief, or the full final report (drafted, quality-reviewed
              against a rubric, then revised) — generated only from this engagement&apos;s computed figures. The
              report takes about a minute.
            </p>
          )}
        </div>

        {text ? (
          <div className="space-y-2 border-t px-4 py-2">
            {textKind === "landscape" || textKind === "brief" ? (
              <div className="flex gap-1.5">
                {(["tighten it", "make it more formal", "make it shorter"] as const).map((ins) => (
                  <Button key={ins} size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={isPending} onClick={() => refine(ins)}>
                    {ins === "tighten it" ? "Tighten" : ins === "make it more formal" ? "More formal" : "Shorter"}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
              <span>AI-generated draft — review before sharing.</span>
              <span className="flex shrink-0 gap-1">
                {textKind === "report" ? (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={download}>
                    Download .md
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
                >
                  Copy
                </Button>
              </span>
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
}
