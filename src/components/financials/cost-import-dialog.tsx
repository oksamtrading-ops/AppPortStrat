"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { importCostRecords } from "@/app/(platform)/e/[engagementId]/financials/actions";

export function ImportCostRecordsDialog({ engagementId }: { engagementId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      try {
        const result = await importCostRecords({ engagementId, text });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(`Imported ${result.imported} cost row(s)` + (result.skipped > 0 ? ` — ${result.skipped} skipped` : ""));
        setOpen(false);
        setText("");
        router.refresh();
      } catch {
        toast.error("Import failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Import cost data</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import fiscal-year cost data</DialogTitle>
          <DialogDescription>
            The Financial Data sheet&apos;s role: paste flat rows from Excel with a header. Columns: App (name or
            #), Fiscal Year, Version (Actual/Budget/Forecast), Category, Line Item, Amount. Rows referencing
            unknown applications are skipped and reported.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"App\tFiscal Year\tVersion\tCategory\tLine Item\tAmount\nPayroll Engine\tFY26\tActual\tInfrastructure\tMid-Range\t120000"}
          className="min-h-48 w-full rounded-md border bg-background p-2 font-mono text-xs"
        />
        <Button onClick={submit} disabled={isPending || text.trim() === ""}>
          {isPending ? "Importing…" : "Import"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
