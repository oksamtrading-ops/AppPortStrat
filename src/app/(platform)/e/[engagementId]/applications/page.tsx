import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { DISPOSITION_LABELS, FILTER_LABELS, formatScore, computeColumnStats } from "@/lib/methodology";
import type { Disposition, FilterHit } from "@/lib/methodology";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OverrideEditor } from "./override-editor";
import { FlagToggles } from "@/components/apps/flag-toggles";
import { deleteApplication } from "./actions";

export const dynamic = "force-dynamic";

interface GridFilters {
  q?: string;
  disposition?: string;
  scope?: string;
}

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<GridFilters>;
}) {
  const { engagementId } = await params;
  const filters = await searchParams;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const all = await db.application.findMany({
    orderBy: { appNumber: "asc" },
    include: {
      result: true,
      override: true,
      responses: { select: { status: true, template: { select: { type: true } } } },
    },
  });

  const q = (filters.q ?? "").trim().toLowerCase();
  const applications = all.filter((app) => {
    if (q && !`${app.name} ${app.acronym ?? ""}`.toLowerCase().includes(q)) return false;
    if (filters.disposition) {
      const computed = (app.result?.computedDisposition ?? "UNKNOWN") as Disposition;
      const finalDisposition = (app.override?.disposition as Disposition | undefined) ?? computed;
      if (finalDisposition !== filters.disposition) return false;
    }
    if (filters.scope === "in" && !app.inScope) return false;
    if (filters.scope === "out" && app.inScope) return false;
    if (filters.scope === "candidates" && !app.result?.analysisCandidate) return false;
    return true;
  });

  // Live column statistics on the FILTERED set (replaces RefreshStatistics_MDV).
  const bvStats = computeColumnStats(applications.map((a) => (a.result?.bvScore ? a.result.bvScore : null)));
  const itStats = computeColumnStats(applications.map((a) => (a.result?.itScore ? a.result.itScore : null)));

  const canEdit = (ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT") && !ctx.readOnly;
  const isLead = ctx.role === "ENGAGEMENT_LEAD" && !ctx.readOnly;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Application inventory</h1>
          <p className="text-muted-foreground text-sm">
            {applications.length} of {all.length} applications shown.
          </p>
        </div>
        {canEdit ? (
          <Button asChild>
            <Link href={`/e/${engagementId}/applications/new`}>Add application</Link>
          </Button>
        ) : null}
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <Input name="q" placeholder="Search name or acronym…" defaultValue={filters.q ?? ""} className="h-8 w-56" />
        </div>
        <select
          name="disposition"
          defaultValue={filters.disposition ?? ""}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">All dispositions</option>
          {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map((d) => (
            <option key={d} value={d}>
              {DISPOSITION_LABELS[d]}
            </option>
          ))}
        </select>
        <select name="scope" defaultValue={filters.scope ?? ""} className="h-8 rounded-md border bg-background px-2 text-sm">
          <option value="">All scope states</option>
          <option value="in">In scope</option>
          <option value="out">Out of scope</option>
          <option value="candidates">Analysis candidates</option>
        </select>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">BV score</TableHead>
            <TableHead className="text-right">IT score</TableHead>
            <TableHead>Disposition</TableHead>
            <TableHead>Filter status</TableHead>
            <TableHead>Surveys</TableHead>
            {canEdit ? <TableHead>Flags</TableHead> : null}
            {canEdit ? <TableHead /> : null}
          </TableRow>
          {/* Statistics band over the filtered set (inventory §3.4) */}
          <TableRow className="bg-secondary/50 text-xs">
            <TableHead />
            <TableHead className="text-muted-foreground">
              min · max · mean · median · mode · n
            </TableHead>
            <TableHead className="text-muted-foreground text-right tabular-nums">
              {statsLine(bvStats)}
            </TableHead>
            <TableHead className="text-muted-foreground text-right tabular-nums">
              {statsLine(itStats)}
            </TableHead>
            <TableHead colSpan={canEdit ? 5 : 3} />
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
            const complete = app.responses.filter((r) => r.status === "COMPLETE").length;
            return (
              <TableRow key={app.id}>
                <TableCell className="text-muted-foreground tabular-nums">{app.appNumber}</TableCell>
                <TableCell>
                  {canEdit ? (
                    <Link href={`/e/${engagementId}/applications/${app.id}/edit`} className="font-medium hover:underline">
                      {app.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{app.name}</span>
                  )}
                  {app.acronym ? <span className="text-muted-foreground ml-1 text-xs">({app.acronym})</span> : null}
                  {app.missionCritical ? (
                    <Badge variant="outline" className="ml-1 px-1 text-[10px]">
                      MC
                    </Badge>
                  ) : null}
                </TableCell>
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
                      (override)
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{statusLabel}</TableCell>
                <TableCell>
                  <Link href={`/e/${engagementId}/surveys/${app.id}`} className="text-sm hover:underline">
                    {complete}/4 complete
                  </Link>
                </TableCell>
                {canEdit ? (
                  <TableCell>
                    <FlagToggles
                      engagementId={engagementId}
                      applicationId={app.id}
                      disabled={!canEdit}
                      values={{
                        inScope: app.inScope,
                        isUtilized: app.isUtilized,
                        isReplaced: app.isReplaced,
                        inFlight: app.inFlight,
                      }}
                    />
                  </TableCell>
                ) : null}
                {canEdit ? (
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {isLead ? (
                        <OverrideEditor
                          engagementId={engagementId}
                          applicationId={app.id}
                          current={
                            app.override
                              ? { disposition: app.override.disposition, justification: app.override.justification }
                              : null
                          }
                        />
                      ) : null}
                      {isLead ? (
                        <form action={deleteApplication}>
                          <input type="hidden" name="engagementId" value={engagementId} />
                          <input type="hidden" name="applicationId" value={app.id} />
                          <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground h-6 px-2 text-xs">
                            Delete
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function statsLine(s: ReturnType<typeof computeColumnStats>): string {
  if (s.count === 0) return "—";
  const f = (v: number | null) => (v === null ? "N/A" : v.toFixed(1));
  return `${f(s.min)} · ${f(s.max)} · ${f(s.mean)} · ${f(s.median)} · ${f(s.mode)} · ${s.count}`;
}
