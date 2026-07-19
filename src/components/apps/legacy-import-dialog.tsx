"use client";

import { useRef, useState, useTransition } from "react";
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
import { importLegacyWorkbook } from "@/app/(platform)/e/[engagementId]/applications/actions";

export function LegacyImportDialog({ engagementId }: { engagementId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.set("engagementId", engagementId);
    formData.set("file", file);
    startTransition(async () => {
      try {
        const result = await importLegacyWorkbook(formData);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        toast.success(
          `Imported ${result.applications} applications, ${result.capabilities} capability nodes, ${result.answers} answers, ${result.costRows} cost rows — portfolio scored`,
        );
        if (result.warnings.length > 0) toast.warning(result.warnings.join("; "));
        setOpen(false);
        router.refresh();
      } catch {
        toast.error("Import failed");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Import legacy workbook</Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import an APS v5.0 workbook</DialogTitle>
          <DialogDescription>
            Upload the original Excel tool (.xlsm). Applications, scope flags, the capability model, weighting
            importances, thresholds, survey answers, and fiscal-year cost data are migrated; cached values are
            read as-is and formulas are never evaluated. Only available while this engagement has no
            applications.
          </DialogDescription>
        </DialogHeader>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm" className="text-sm" />
        <Button onClick={submit} disabled={isPending}>
          {isPending ? "Importing…" : "Import workbook"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
