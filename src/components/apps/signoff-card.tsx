"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { recordSignOff, revokeSignOff } from "@/app/(platform)/e/[engagementId]/applications/signoff-actions";

export interface SignOffView {
  dispositionLabel: string; // the AGREED disposition (snapshot)
  signedByName: string;
  signedAt: string; // pre-formatted server-side
  note: string | null;
  /** True when the live final disposition no longer matches the agreed one. */
  stale: boolean;
}

/**
 * C3 disposition sign-off: the Lead records the client's agreement to the
 * current final disposition. Everyone sees the status; only Leads can record
 * or revoke. A stale banner appears when scores/overrides later change the
 * live disposition away from what was agreed.
 */
export function SignOffCard({
  engagementId,
  applicationId,
  currentDispositionLabel,
  hasDisposition,
  signOff,
  canSign,
}: {
  engagementId: string;
  applicationId: string;
  currentDispositionLabel: string;
  hasDisposition: boolean;
  signOff: SignOffView | null;
  canSign: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return void toast.error(result.error);
      toast.success(success);
      setNote("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CheckCircle2 className="size-4" /> Disposition sign-off
        </CardTitle>
        <CardDescription>
          Records the client&apos;s agreement to the final disposition. The agreed value is kept as-of the sign-off
          date — later score or override changes are flagged, never silently absorbed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {signOff ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                <CheckCircle2 className="size-3" /> Signed off: {signOff.dispositionLabel}
              </span>
              <span className="text-muted-foreground text-xs">
                by {signOff.signedByName} on {signOff.signedAt}
              </span>
            </div>
            {signOff.note ? <p className="text-muted-foreground text-sm whitespace-pre-wrap">{signOff.note}</p> : null}
            {signOff.stale ? (
              <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                The live disposition is now <strong>{currentDispositionLabel}</strong>, which differs from the agreed{" "}
                <strong>{signOff.dispositionLabel}</strong>. Review with the client and re-sign, or revoke.
              </p>
            ) : null}
            {canSign ? (
              <div className="flex gap-2">
                {signOff.stale ? (
                  <Button
                    size="sm"
                    disabled={isPending}
                    onClick={() => run(() => recordSignOff({ engagementId, applicationId }), "Sign-off refreshed")}
                  >
                    Re-sign at {currentDispositionLabel}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => run(() => revokeSignOff({ engagementId, applicationId }), "Sign-off revoked")}
                >
                  Revoke
                </Button>
              </div>
            ) : null}
          </div>
        ) : canSign ? (
          hasDisposition ? (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-14 w-full rounded-md border bg-background p-2 text-sm"
                placeholder="Optional note (e.g. agreed in the 20 Jul workshop)…"
                maxLength={2000}
              />
              <Button
                size="sm"
                disabled={isPending}
                onClick={() => run(() => recordSignOff({ engagementId, applicationId, note }), "Disposition signed off")}
              >
                {isPending ? "Recording…" : `Sign off ${currentDispositionLabel}`}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No disposition yet — score the application first.</p>
          )
        ) : (
          <p className="text-muted-foreground text-sm">Not signed off yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
