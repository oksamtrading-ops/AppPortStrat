import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { DISPOSITION_LABELS } from "@/lib/methodology";
import type { Disposition } from "@/lib/methodology";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [totalApps, inScope, dispositionGroups, responseGroups, templates, inScopeResponses] = await Promise.all([
    db.application.count(),
    db.application.count({ where: { inScope: true } }),
    db.dispositionResult.groupBy({ by: ["computedDisposition"], _count: { _all: true } }),
    db.surveyResponse.groupBy({ by: ["status"], _count: { _all: true } }),
    db.surveyTemplate.findMany({ where: { questions: { some: {} } }, orderBy: { type: "asc" }, select: { id: true, name: true } }),
    db.surveyResponse.findMany({
      where: { application: { inScope: true } },
      select: { templateId: true, status: true },
    }),
  ]);

  const dispositionCounts = new Map(
    dispositionGroups.map((g) => [g.computedDisposition as Disposition, g._count._all]),
  );
  const responseCounts = new Map(responseGroups.map((g) => [g.status, g._count._all]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Portfolio overview. Full KPI dashboard (2×2 matrix, 4R scatter, distributions) arrives in Phase 4.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Applications" value={totalApps} />
        <StatCard label="In scope" value={inScope} />
        <StatCard label="Out of scope" value={totalApps - inScope} />
        <StatCard label="Surveys complete" value={responseCounts.get("COMPLETE") ?? 0} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Collection progress (in-scope applications)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {templates.map((t) => {
              const complete = inScopeResponses.filter((r) => r.templateId === t.id && r.status === "COMPLETE").length;
              const partial = inScopeResponses.filter((r) => r.templateId === t.id && r.status === "IN_PROGRESS").length;
              const missing = Math.max(0, inScope - complete - partial);
              return (
                <div key={t.id} className="rounded-lg border bg-card p-4">
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-muted-foreground mt-1 space-y-0.5 text-xs tabular-nums">
                    <div>Complete: {complete}</div>
                    <div>Partial: {partial}</div>
                    <div>Missing: {missing}</div>
                  </div>
                  <div className="bg-secondary mt-2 h-1.5 w-full overflow-hidden rounded">
                    <div
                      className="bg-brand h-full"
                      style={{ width: inScope === 0 ? 0 : `${Math.round((complete / inScope) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Disposition breakdown (computed)</CardTitle>
        </CardHeader>
        <CardContent>
          {dispositionCounts.size === 0 ? (
            <p className="text-muted-foreground text-sm">
              No scores computed yet — save weightings or thresholds to trigger a portfolio recompute.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map((d) => (
                <StatCard key={d} label={DISPOSITION_LABELS[d]} value={dispositionCounts.get(d) ?? 0} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
