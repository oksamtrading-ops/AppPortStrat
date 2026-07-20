"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  acceptAiImportAction,
  extractPortfolioAction,
} from "@/app/(platform)/e/[engagementId]/applications/ai-import-actions";
import type { ExtractedApplication, ExtractionSource } from "@/lib/ai/extract";

interface ReviewRow extends ExtractedApplication {
  accepted: boolean;
}

/**
 * AI import: source in (diagram image, PDF, or pasted text) → extraction →
 * staging review grid. Nothing imports until rows are explicitly accepted;
 * confidence gates the defaults (≥90 pre-checked, 60–89 checked but flagged,
 * <60 unchecked).
 */
export function AiImportDialog({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState<string | null>(null);

  function reset() {
    setRows(null);
    setNotes(null);
    setText("");
    setFile(null);
  }

  async function buildSource(): Promise<ExtractionSource | { error: string }> {
    if (file) {
      if (file.size > 11_000_000) return { error: "File is too large (11MB max)" };
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const dataBase64 = btoa(bin);
      if (file.type === "application/pdf") return { kind: "pdf", dataBase64 };
      if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
        return { kind: "image", mediaType: file.type as "image/png", dataBase64 };
      }
      return { error: "Unsupported file type — use PNG, JPEG, WebP, GIF, or PDF" };
    }
    if (text.trim()) return { kind: "text", text };
    return { error: "Paste text or choose a file first" };
  }

  function extract() {
    startTransition(async () => {
      const source = await buildSource();
      if ("error" in source) return void toast.error(source.error);
      const result = await extractPortfolioAction({ engagementId, source });
      if (!result.ok) return void toast.error(result.error);
      if (result.result.applications.length === 0) {
        return void toast.error("No applications found in the source" + (result.result.notes ? ` — ${result.result.notes}` : ""));
      }
      setRows(result.result.applications.map((a) => ({ ...a, accepted: a.confidence >= 60 })));
      setNotes(result.result.notes);
    });
  }

  function accept() {
    const chosen = (rows ?? []).filter((r) => r.accepted);
    if (chosen.length === 0) return void toast.error("No rows selected");
    startTransition(async () => {
      const result = await acceptAiImportAction({
        engagementId,
        rows: chosen.map((r) => ({
          name: r.name,
          description: r.description,
          capabilityName: r.suggestedCapability,
          capabilityExists: r.capabilityExists,
        })),
      });
      if (!result.ok) return void toast.error(result.error);
      toast.success(
        `Imported ${result.created} application${result.created === 1 ? "" : "s"}` +
          (result.newCapabilities > 0 ? ` · ${result.newCapabilities} new capabilit${result.newCapabilities === 1 ? "y" : "ies"} under “AI Imported (review)”` : ""),
      );
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  const update = (i: number, patch: Partial<ReviewRow>) =>
    setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), !o && reset())}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Sparkles className="size-4" /> AI import
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI import</DialogTitle>
          <DialogDescription>
            {rows
              ? "Review before anything is imported: uncheck wrong rows, fix names, then accept. Hover a row for its source evidence."
              : "Upload an architecture diagram (PNG/JPEG/WebP/GIF), a PDF, or paste any text — the AI proposes applications with capability suggestions and confidence. Nothing imports without your review."}
          </DialogDescription>
        </DialogHeader>

        {!rows ? (
          <div className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="size-4" /> Choose a file…
              </Button>
              {file ? (
                <span className="flex items-center gap-1.5 text-sm">
                  {file.name}
                  <button
                    type="button"
                    aria-label="Clear file"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              ) : (
                <span className="text-muted-foreground text-sm">PNG, JPEG, WebP, GIF, or PDF — up to 11MB</span>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="…or paste text here (wiki export, inventory list, meeting notes)"
              className="min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs"
            />
            <Button onClick={extract} disabled={isPending}>
              {isPending ? "Extracting…" : "Extract applications"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {notes ? <p className="text-muted-foreground text-xs">AI notes: {notes}</p> : null}
            <div className="max-h-[45vh] space-y-1 overflow-y-auto">
              {rows.map((r, i) => (
                <div key={i} title={r.evidence ? `Evidence: ${r.evidence}` : undefined} className="flex items-center gap-2 rounded border px-2 py-1.5">
                  <input type="checkbox" checked={r.accepted} onChange={(e) => update(i, { accepted: e.target.checked })} />
                  <Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} className="h-7 flex-1 text-sm" />
                  <span className="text-muted-foreground w-44 truncate text-xs" title={r.suggestedCapability ?? undefined}>
                    {r.suggestedCapability ?? "—"}
                    {r.suggestedCapability && !r.capabilityExists ? <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">new</span> : null}
                  </span>
                  <span
                    className={`w-12 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium tabular-nums ${
                      r.confidence >= 90 ? "bg-green-100 text-green-800" : r.confidence >= 60 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"
                    }`}
                    title={r.confidence >= 90 ? "High confidence" : r.confidence >= 60 ? "Medium — review" : "Low — unchecked by default"}
                  >
                    {r.confidence}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={reset} disabled={isPending}>
                ← Different source
              </Button>
              <Button onClick={accept} disabled={isPending}>
                {isPending ? "Importing…" : `Accept ${rows.filter((r) => r.accepted).length} row(s)`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
