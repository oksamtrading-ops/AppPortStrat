import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { DISPOSITION_LABELS, FILTER_LABELS, formatScore, computeColumnStats } from "@/lib/methodology";
import type { Disposition, FilterHit } from "@/lib/methodology";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill, CountChip, type PillColor } from "@/components/ui/pill";
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
import { AiImportDialog } from "@/components/apps/ai-import-dialog";
import { PortfolioToolbar } from "@/components/apps/portfolio-toolbar";
import { MatrixView, type MatrixApp } from "@/components/apps/matrix-view";
import { deleteApplication } from "./actions";

export const dynamic = "force-dynamic";

interface GridFilters {
  q?: string;
  disposition?: string;
  scope?: string;
  view?: string;
  /** Capability drill-through (heat-map cell click): node id, subtree included. */
  cap?: string;
}

const DISPOSITION_COLOR: Record<Disposition, PillColor> = {
  KEEP_AS_IS: "green",
  RETOOL: "blue",
  REDESIGN: "amber",
  TERMINATE: "red",
  UNKNOWN: "gray",
};

const FILTER_COLOR: Record<FilterHit, PillColor> = {
  OUT_OF_SCOPE: "gray",
  NO_LONGER_UTILIZED: "gray",
  TERMINATE: "red",
  REPLACED: "amber",
  IN_FLIGHT: "blue",
};

export default async function ApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<GridFilters>;
}) {
  const { engagementId } = await params;
  const filters = await searchParams;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [all, thresholds] = await Promise.all([
    db.application.findMany({
      orderBy: { appNumber: "asc" },
      include: {
        result: true,
        override: true,
        responses: { select: { status: true } },
        _count: { select: { commentThreads: true } },
      },
    }),
    db.thresholdConfig.findFirst(),
  ]);
  const urgBv = thresholds?.urgBv ?? THRESHOLD_DEFAULTS.urgBv;
  const optBv = thresholds?.optBv ?? THRESHOLD_DEFAULTS.optBv;
  const urgIt = thresholds?.urgIt ?? THRESHOLD_DEFAULTS.urgIt;
  const optIt = thresholds?.optIt ?? THRESHOLD_DEFAULTS.optIt;

  // Capability drill-through: the node and its whole subtree.
  let capFilter: { name: string; ids: Set<string> } | null = null;
  if (filters.cap) {
    const nodes = await db.capabilityNode.findMany({ select: { id: true, parentId: true, name: true } });
    const root = nodes.find((n) => n.id === filters.cap);
    if (root) {
      const ids = new Set([root.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of nodes) {
          if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
            ids.add(n.id);
            grew = true;
          }
        }
      }
      capFilter = { name: root.name, ids };
    }
  }

  const q = (filters.q ?? "").trim().toLowerCase();
  const applications = all.filter((app) => {
    if (capFilter && (!app.capabilityNodeId || !capFilter.ids.has(app.capabilityNodeId))) return false;
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

  const bvStats = computeColumnStats(applications.map((a) => (a.result?.bvScore ? a.result.bvScore : null)));
  const itStats = computeColumnStats(applications.map((a) => (a.result?.itScore ? a.result.itScore : null)));

  const canEdit = (ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT") && !ctx.readOnly;
  const isLead = ctx.role === "ENGAGEMENT_LEAD" && !ctx.readOnly;
  const view = filters.view === "matrix" ? "matrix" : "table";

  const filterQuery = new URLSearchParams(
    Object.entries({ q: filters.q, disposition: filters.disposition, scope: filters.scope }).filter(
      (entry): entry is [string, string] => Boolean(entry[1]),
    ),
  );

  const matrixApps: MatrixApp[] = applications.map((app) => {
    const computed = (app.result?.computedDisposition ?? "UNKNOWN") as Disposition;
    return {
      id: app.id,
      name: app.name,
      acronym: app.acronym,
      bv: app.result?.bvScore ?? 0,
      it: app.result?.itScore ?? 0,
      disposition: (app.override?.disposition as Disposition | undefined) ?? computed,
    };
  });

  return (
    <div className="space-y-5">
      {/* Header row: title + count, view toggle, actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Application Portfolio</h1>
          <p className="text-muted-foreground text-sm">
            {all.length} application{all.length === 1 ? "" : "s"} catalogued
            {applications.length !== all.length ? ` · ${applications.length} shown` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-secondary flex rounded-lg p-0.5">
            {(
              [
                ["table", "Table"],
                ["matrix", "Matrix"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`?${new URLSearchParams([...filterQuery.entries(), ...(key === "matrix" ? [["view", "matrix"] as [string, string]] : [])])}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  view === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </div>
          {canEdit ? (
            <>
              <PortfolioToolbar engagementId={engagementId} showLegacy={all.length === 0 && isLead} />
              {engagement.aiEnabled ? <AiImportDialog engagementId={engagementId} /> : null}
              <Button asChild>
                <Link href={`/e/${engagementId}/applications/new`}>+ Add</Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Search + filters */}
      <form method="get" className="flex flex-wrap items-center gap-2">
        {view === "matrix" ? <input type="hidden" name="view" value="matrix" /> : null}
        <Input name="q" placeholder="Search…" defaultValue={filters.q ?? ""} className="h-9 w-64 rounded-lg" />
        <select
          name="disposition"
          defaultValue={filters.disposition ?? ""}
          className="h-9 rounded-lg border bg-background px-2 text-sm"
        >
          <option value="">All dispositions</option>
          {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map((d) => (
            <option key={d} value={d}>
              {DISPOSITION_LABELS[d]}
            </option>
          ))}
        </select>
        <select name="scope" defaultValue={filters.scope ?? ""} className="h-9 rounded-lg border bg-background px-2 text-sm">
          <option value="">All scope states</option>
          <option value="in">In scope</option>
          <option value="out">Out of scope</option>
          <option value="candidates">Analysis candidates</option>
        </select>
        <Button type="submit" size="sm" variant="outline" className="h-9">
          Apply
        </Button>
        {capFilter ? (
          <span className="flex items-center gap-1">
            <Pill color="brand">Capability: {capFilter.name}</Pill>
            <Link href={`/e/${engagementId}/applications`} className="text-muted-foreground text-xs hover:underline">
              clear
            </Link>
          </span>
        ) : null}
      </form>

      {view === "matrix" ? (
        <MatrixView apps={matrixApps} optBv={optBv} optIt={optIt} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-12">#</TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">BV</TableHead>
                <TableHead className="text-right">IT</TableHead>
                <TableHead>Disposition</TableHead>
                <TableHead className="text-center">Surveys</TableHead>
                {canEdit ? <TableHead>Flags</TableHead> : null}
                {canEdit ? <TableHead /> : null}
              </TableRow>
              <TableRow className="bg-secondary/40 text-[11px] hover:bg-secondary/40">
                <TableHead />
                <TableHead
                  className="text-muted-foreground font-normal"
                  title="Score statistics over the currently filtered rows — the workbook's Refresh Statistics, computed live. Hover any value for its meaning."
                >
                  min · max · mean · median · mode · n
                </TableHead>
                <TableHead />
                <TableHead className="text-muted-foreground text-right font-normal tabular-nums">
                  <StatsLine stats={bvStats} kind="Business Value" />
                </TableHead>
                <TableHead className="text-muted-foreground text-right font-normal tabular-nums">
                  <StatsLine stats={itStats} kind="IT Health" />
                </TableHead>
                <TableHead colSpan={canEdit ? 4 : 2} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((app) => {
                const result = app.result;
                const computed = (result?.computedDisposition ?? "UNKNOWN") as Disposition;
                const finalDisposition = (app.override?.disposition as Disposition | undefined) ?? computed;
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
                      {canEdit && app._count.commentThreads > 0 ? (
                        <span
                          className="text-muted-foreground ml-1.5 text-xs tabular-nums"
                          title={`${app._count.commentThreads} comment(s)`}
                        >
                          💬{app._count.commentThreads}
                        </span>
                      ) : null}
                      <div className="text-muted-foreground text-xs">
                        {app.acronym}
                        {app.missionCritical ? (app.acronym ? " · " : "") + "Mission critical" : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {result?.filterHit ? (
                        <Pill color={FILTER_COLOR[result.filterHit as FilterHit]}>
                          {FILTER_LABELS[result.filterHit as FilterHit]}
                        </Pill>
                      ) : result?.analysisCandidate ? (
                        <Pill color="green">Active</Pill>
                      ) : (
                        <Pill color="gray">Unscored</Pill>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell score={result?.bvScore ?? null} partial={result?.bvPartial ?? false} urgent={urgBv} optimum={optBv} />
                    </TableCell>
                    <TableCell className="text-right">
                      <ScoreCell score={result?.itScore ?? null} partial={result?.itPartial ?? false} urgent={urgIt} optimum={optIt} />
                    </TableCell>
                    <TableCell>
                      <Pill
                        color={DISPOSITION_COLOR[finalDisposition]}
                        title={app.override ? `Override — computed ${DISPOSITION_LABELS[computed]}: ${app.override.justification}` : undefined}
                      >
                        {DISPOSITION_LABELS[finalDisposition]}
                        {app.override ? " *" : ""}
                      </Pill>
                    </TableCell>
                    <TableCell className="text-center">
                      <Link href={`/e/${engagementId}/surveys/${app.id}`}>
                        <CountChip title="Completed surveys">{complete}/4</CountChip>
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
      )}
    </div>
  );
}

/** Numeric score with a threshold-band dot: red < urgent, amber < optimum, green ≥ optimum. */
function ScoreCell({
  score,
  partial,
  urgent,
  optimum,
}: {
  score: number | null;
  partial: boolean;
  urgent: number;
  optimum: number;
}) {
  const value = score && score > 0 ? score : null;
  const band =
    value === null ? "bg-muted-foreground/30" : value < urgent ? "bg-red-600" : value < optimum ? "bg-amber-500" : "bg-green-600";
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className={cn("h-2 w-2 rounded-full", band)} />
      {formatScore(value)}
      {partial ? <span title="Computed from a partial survey">⚠</span> : null}
    </span>
  );
}

/** Each figure carries its own tooltip so the unlabeled row stays readable. */
function StatsLine({ stats, kind }: { stats: ReturnType<typeof computeColumnStats>; kind: string }) {
  if (stats.count === 0) return <>—</>;
  const f = (v: number | null) => (v === null ? "N/A" : v.toFixed(1));
  const cells: [string, string, string][] = [
    [f(stats.min), "min", `Lowest ${kind} score in the filtered rows`],
    [f(stats.max), "max", `Highest ${kind} score in the filtered rows`],
    [f(stats.mean), "mean", `Average ${kind} score (unweighted) across the filtered rows`],
    [f(stats.median), "median", `Middle ${kind} score — far from the mean means a skewed distribution`],
    [f(stats.mode), "mode", `Most frequent ${kind} score — N/A when no value repeats`],
    [String(stats.count), "n", `Applications with a ${kind} score in the current filter`],
  ];
  return (
    <>
      {cells.map(([value, label, help], i) => (
        <span key={label} className="cursor-help" title={`${label}: ${help}`}>
          {i > 0 ? " · " : ""}
          {value}
        </span>
      ))}
    </>
  );
}
