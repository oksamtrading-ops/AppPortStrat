"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportApplicationsDialog } from "./import-dialog";
import { LegacyImportDialog } from "./legacy-import-dialog";

/**
 * Grouped toolbar for the portfolio grid: Export ▾ (CSV / XLSX) and
 * Import ▾ (paste / legacy workbook). The AI import keeps its own top-level
 * button (flagship feature, per Albert), and + Add stays primary.
 */
export function PortfolioToolbar({
  engagementId,
  showLegacy,
}: {
  engagementId: string;
  /** Legacy workbook import stays Lead-only and empty-portfolio-only. */
  showLegacy: boolean;
}) {
  const [dialog, setDialog] = useState<"paste" | "legacy" | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            Export <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={`/e/${engagementId}/applications/export`} download>
              Application list (CSV)
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/e/${engagementId}/export`} download>
              Full dataset (XLSX)
            </a>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            Import <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDialog("paste")}>Paste from Excel…</DropdownMenuItem>
          {showLegacy ? (
            <DropdownMenuItem onSelect={() => setDialog("legacy")}>Legacy workbook (.xlsm)…</DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ImportApplicationsDialog engagementId={engagementId} open={dialog === "paste"} onOpenChange={(o) => setDialog(o ? "paste" : null)} />
      {showLegacy ? (
        <LegacyImportDialog engagementId={engagementId} open={dialog === "legacy"} onOpenChange={(o) => setDialog(o ? "legacy" : null)} />
      ) : null}
    </>
  );
}
