"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { pasteCapabilities } from "@/app/(platform)/e/[engagementId]/capabilities/actions";

export function ImportCapabilitiesDialog({ engagementId }: { engagementId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import capabilities</DialogTitle>
          <DialogDescription>
            Paste a three-column table (L0, L1, L2 — straight from Excel), or a capability export from an
            enterprise architecture tool (CSV/TSV with “Level 1/2/3” columns, or “Name” + “Parent” columns — levels deeper
            than three are skipped). Blank L0/L1 cells become explicit “Unassigned” placeholders. Merging is
            additive and deduplicated; nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        <form action={pasteCapabilities} onSubmit={() => setOpen(false)} className="space-y-2">
          <input type="hidden" name="engagementId" value={engagementId} />
          <textarea
            name="text"
            required
            placeholder={"Operations\tFinance\tGeneral Ledger\nOperations\tFinance\tAccounts Payable"}
            className="min-h-48 w-full rounded-md border bg-background p-2 font-mono text-xs"
          />
          <Button type="submit">Merge into model</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
