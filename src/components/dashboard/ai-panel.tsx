"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateAiNarrative } from "@/app/(platform)/e/[engagementId]/dashboard/ai-actions";

/** AI narrative panel: outputs are clearly labeled drafts, never auto-saved. */
export function AiPanel({ engagementId }: { engagementId: string }) {
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<"landscape" | "brief" | null>(null);
  const [text, setText] = useState<string | null>(null);

  function run(k: "landscape" | "brief") {
    setKind(k);
    startTransition(async () => {
      const result = await generateAiNarrative({ engagementId, kind: k });
      if (result.ok) setText(result.text);
      else {
        setText(null);
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Sparkles className="size-4" /> AI narrative
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("landscape")}>
              {isPending && kind === "landscape" ? "Explaining…" : "Explain this landscape"}
            </Button>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => run("brief")}>
              {isPending && kind === "brief" ? "Writing…" : "Generate engagement brief"}
            </Button>
          </span>
        </CardTitle>
      </CardHeader>
      {text ? (
        <CardContent className="space-y-2">
          <div className="text-sm whitespace-pre-wrap">{text}</div>
          <div className="text-muted-foreground flex items-center justify-between border-t pt-2 text-xs">
            <span>AI-generated draft from this engagement&apos;s computed figures — review before sharing.</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
            >
              Copy
            </Button>
          </div>
        </CardContent>
      ) : (
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Plain-language explanation of the portfolio, or a one-page engagement brief — generated only from this
            engagement&apos;s computed figures.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
