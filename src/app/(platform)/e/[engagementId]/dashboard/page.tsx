import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { computeScoreDistribution, DISPOSITION_LABELS, SCORE_BUCKET_LABELS } from "@/lib/methodology";
import type { Disposition } from "@/lib/methodology";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { BucketBars, CHART_COLORS, DonutChart } from "@/components/dashboard/charts";
import { MatrixView, type MatrixApp } from "@/components/apps/matrix-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [apps, templates, responses, thresholds] = await Promise.all([
    db.application.findMany({
      select: {
        id: true,
        name: true,
        acronym: true,
        appNumber: true,
        inScope: true,
        isUtilized: true,
        missionCritical: true,
        result: true,
        override: { select: { disposition: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.surveyTemplate.findMany({ where: { questions: { some: {} } }, orderBy: { type: "asc" }, select: { id: true, name: true } }),
    db.surveyResponse.findMany({ select: { templateId: true, status: true, application: { select: { inScope: true } } } }),
    db.thresholdConfig.findFirst(),
  ]);

  const optBv = thresholds?.optBv ?? THRESHOLD_DEFAULTS.optBv;
  const optIt = thresholds?.optIt ?? THRESHOLD_DEFAULTS.optIt;

  const finalOf = (app: (typeof apps)[number]): Disposition =>
    ((app.override?.disposition as Disposition | undefined) ??
      (app.result?.computedDisposition as Disposition | undefined) ??
      "UNKNOWN");

  // The workbook's analysis pool: in scope AND utilized (inventory §8).
  const pool = apps.filter((a) => a.inScope && a.isUtilized);
  const outOfScope = apps.filter((a) => !a.inScope).length;
  const nlu = apps.filter((a) => a.inScope && !a.isUtilized).length;

  const count = (d: Disposition) => pool.filter((a) => finalOf(a) === d).length;
  const quadrants = {
    redesign: count("REDESIGN"),
    keepAsIs: count("KEEP_AS_IS"),
    terminate: count("TERMINATE"),
    retool: count("RETOOL"),
    unknown: count("UNKNOWN"),
  };

  const missionCritical = pool.filter((a) => a.missionCritical);
  const veryLowBv = pool.filter((a) => a.result?.veryLowBv).length;
  const veryLowIt = pool.filter((a) => a.result?.veryLowIt).length;

  const bvDistribution = computeScoreDistribution(pool.map((a) => a.result?.bvScore ?? 0));
  const itDistribution = computeScoreDistribution(pool.map((a) => a.result?.itScore ?? 0));

  const inScopeResponses = responses.filter((r) => r.application.inScope);
  const inScope = apps.length - outOfScope;

  const matrixApps: MatrixApp[] = pool.map((a) => ({
    id: a.id,
    name: a.name,
    acronym: a.acronym,
    bv: a.result?.bvScore ?? 0,
    it: a.result?.itScore ?? 0,
    disposition: finalOf(a),
    href: `/e/${engagementId}/applications/${a.id}/edit`,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Live portfolio KPIs over {pool.length} in-scope, utilized application{pool.length === 1 ? "" : "s"}.
          </p>
        </div>
        {ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT" ? (
          <div className="flex gap-2">
            <a
              href={`/e/${engagementId}/deck`}
              download
              className="hover:bg-secondary rounded-lg border px-3 py-1.5 text-sm font-medium"
            >
              Export deck (PPTX)
            </a>
            <a
              href={`/e/${engagementId}/export`}
              download
              className="hover:bg-secondary rounded-lg border px-3 py-1.5 text-sm font-medium"
            >
              Export data (XLSX)
            </a>
          </div>
        ) : null}
      </div>

      {/* 2×2 disposition matrix + urgent alerts */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MatrixCell label="Re-Design" sub="Low BV · High IT" value={quadrants.redesign} tone="text-amber-600" />
        <MatrixCell label="Keep-As-Is" sub="High BV · High IT" value={quadrants.keepAsIs} tone="text-green-600" />
        <MatrixCell
          label="Terminate + NLU"
          sub="Low BV · Low IT (+ not utilized)"
          value={quadrants.terminate + nlu}
          tone="text-red-600"
        />
        <MatrixCell label="Re-Tool" sub="High BV · Low IT" value={quadrants.retool} tone="text-blue-600" />
      </div>

      {(veryLowBv > 0 || veryLowIt > 0 || quadrants.unknown > 0) && (
        <div className="flex flex-wrap gap-2">
          {veryLowBv > 0 ? <Pill color="red">{veryLowBv} app(s) below the urgent Business Value threshold</Pill> : null}
          {veryLowIt > 0 ? <Pill color="red">{veryLowIt} app(s) below the urgent IT Health threshold</Pill> : null}
          {quadrants.unknown > 0 ? <Pill color="gray">{quadrants.unknown} unscored (Unknown)</Pill> : null}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Disposition breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              centerLabel={String(apps.length)}
              slices={[
                { name: DISPOSITION_LABELS.KEEP_AS_IS, value: quadrants.keepAsIs, color: CHART_COLORS.green },
                { name: DISPOSITION_LABELS.RETOOL, value: quadrants.retool, color: CHART_COLORS.blue },
                { name: DISPOSITION_LABELS.REDESIGN, value: quadrants.redesign, color: CHART_COLORS.amber },
                { name: DISPOSITION_LABELS.TERMINATE, value: quadrants.terminate, color: CHART_COLORS.red },
                { name: "Unknown", value: quadrants.unknown, color: CHART_COLORS.gray },
                { name: "No Longer Utilized", value: nlu, color: "#6b7280" },
                { name: "Out of Scope", value: outOfScope, color: "#d1d5db" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mission critical</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              centerLabel={String(missionCritical.length)}
              slices={[
                { name: "Mission critical", value: missionCritical.length, color: CHART_COLORS.dark },
                { name: "Other", value: pool.length - missionCritical.length, color: "#d1d5db" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Application universe</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              centerLabel={String(apps.length)}
              slices={[
                { name: "In scope", value: inScope, color: CHART_COLORS.brand },
                { name: "Out of scope", value: outOfScope, color: "#d1d5db" },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business Value distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BucketBars buckets={bvDistribution.buckets} labels={SCORE_BUCKET_LABELS} color={CHART_COLORS.brand} />
            <p className="text-muted-foreground mt-1 text-xs">Unscored apps count in the 0–1 bucket (workbook-faithful).</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">IT Health distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <BucketBars buckets={itDistribution.buckets} labels={SCORE_BUCKET_LABELS} color={CHART_COLORS.dark} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">4R Framework</CardTitle>
        </CardHeader>
        <CardContent>
          <MatrixView apps={matrixApps} optBv={optBv} optIt={optIt} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Collection progress (in-scope applications)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {templates.map((t) => {
                const complete = inScopeResponses.filter((r) => r.templateId === t.id && r.status === "COMPLETE").length;
                const partial = inScopeResponses.filter((r) => r.templateId === t.id && r.status === "IN_PROGRESS").length;
                const missing = Math.max(0, inScope - complete - partial);
                return (
                  <div key={t.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{t.name}</span>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {complete} complete · {partial} partial · {missing} missing
                      </span>
                    </div>
                    <div className="bg-secondary mt-1 flex h-2 w-full overflow-hidden rounded">
                      <div className="bg-brand h-full" style={{ width: pct(complete, inScope) }} />
                      <div className="h-full bg-amber-400" style={{ width: pct(partial, inScope) }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mission-critical applications</CardTitle>
          </CardHeader>
          <CardContent>
            {missionCritical.length === 0 ? (
              <p className="text-muted-foreground text-sm">None flagged.</p>
            ) : (
              <ul className="space-y-1.5">
                {missionCritical.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm">
                    <Link href={`/e/${engagementId}/applications/${a.id}/edit`} className="hover:underline">
                      <span className="text-muted-foreground mr-2 tabular-nums">#{a.appNumber}</span>
                      {a.name}
                    </Link>
                    <Pill
                      color={
                        finalOf(a) === "TERMINATE"
                          ? "red"
                          : finalOf(a) === "KEEP_AS_IS"
                            ? "green"
                            : finalOf(a) === "UNKNOWN"
                              ? "gray"
                              : finalOf(a) === "RETOOL"
                                ? "blue"
                                : "amber"
                      }
                    >
                      {DISPOSITION_LABELS[finalOf(a)]}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MatrixCell({ label, sub, value, tone }: { label: string; sub: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-muted-foreground text-xs">{sub}</div>
    </div>
  );
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}
