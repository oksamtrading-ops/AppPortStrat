import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { DISPOSITION_LABELS, FILTER_LABELS, formatScore } from "@/lib/methodology";
import type { Disposition, FilterHit } from "@/lib/methodology";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function ApplicationsPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const applications = await db.application.findMany({
    orderBy: { appNumber: "asc" },
    include: { result: true, override: true },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Application inventory</h1>
        <p className="text-muted-foreground text-sm">
          {applications.length} applications. The full master grid (inline editing, column statistics, filters)
          arrives in Phase 3.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Acronym</TableHead>
            <TableHead className="text-right">BV score</TableHead>
            <TableHead className="text-right">IT score</TableHead>
            <TableHead>Disposition</TableHead>
            <TableHead>Filter status</TableHead>
            <TableHead>Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.map((app) => {
            const result = app.result;
            const computed = (result?.computedDisposition ?? "UNKNOWN") as Disposition;
            const finalDisposition = (app.override?.disposition as Disposition | undefined) ?? computed;
            const statusLabel = result?.filterHit
              ? FILTER_LABELS[result.filterHit as FilterHit]
              : DISPOSITION_LABELS[finalDisposition];
            return (
              <TableRow key={app.id}>
                <TableCell className="text-muted-foreground tabular-nums">{app.appNumber}</TableCell>
                <TableCell className="font-medium">{app.name}</TableCell>
                <TableCell className="text-muted-foreground">{app.acronym}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatScore(result?.bvScore ?? null)}
                  {result?.bvPartial ? <span title="Computed from a partial survey"> ⚠</span> : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatScore(result?.itScore ?? null)}
                  {result?.itPartial ? <span title="Computed from a partial survey"> ⚠</span> : null}
                </TableCell>
                <TableCell>
                  <Badge variant={finalDisposition === "TERMINATE" ? "destructive" : "outline"}>
                    {DISPOSITION_LABELS[finalDisposition]}
                  </Badge>
                  {app.override ? (
                    <span className="text-muted-foreground ml-1 text-xs" title={app.override.justification}>
                      (override; computed {DISPOSITION_LABELS[computed]})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{statusLabel}</TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {[
                    !app.inScope && "Out of scope",
                    !app.isUtilized && "Not utilized",
                    app.isReplaced && "Replaced",
                    app.inFlight && "In flight",
                    app.missionCritical && "Mission critical",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
