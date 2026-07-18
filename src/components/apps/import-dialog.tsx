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
import { importApplications } from "@/app/(platform)/e/[engagementId]/applications/actions";

export function ImportApplicationsDialog({ engagementId }: { engagementId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function submit() {
    startTransition(async () => {
      try {
        const result = await importApplications({ engagementId, text });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(
          `Imported ${result.created} application(s)` +
            (result.unmappedCapabilities > 0 ? ` — ${result.unmappedCapabilities} capability name(s) not found` : ""),
        );
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
        <Button variant="outline">Import</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import applications from Excel</DialogTitle>
          <DialogDescription>
            Copy rows from Excel (including a header row) and paste below. Recognized columns: Name, Acronym,
            Description, Type, L0/L1/L2 Capability, Business Function Detail, Target, Mission Critical, In
            Scope, Is Utilized, Is Replaced, In Flight, Comments. Capability names must already exist in the
            model — unknown names are reported, never invented.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Name\tAcronym\tL1\tL2\nPayroll Engine\tPAY\tHuman Resources\tPayroll"}
          className="min-h-48 w-full rounded-md border bg-background p-2 font-mono text-xs"
        />
        <Button onClick={submit} disabled={isPending || text.trim() === ""}>
          {isPending ? "Importing…" : "Import"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
