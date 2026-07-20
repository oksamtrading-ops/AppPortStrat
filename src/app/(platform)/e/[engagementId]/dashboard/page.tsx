import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { computeHeatBucket, computeScoreDistribution, DISPOSITION_LABELS, SCORE_BUCKET_LABELS } from "@/lib/methodology";
import type { Disposition, HeatBucket } from "@/lib/methodology";
import { formatMoney } from "@/lib/finance";
import { loadFinanceRows } from "@/lib/finance-rows";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { BucketBars, CHART_COLORS, DonutChart } from "@/components/dashboard/charts";
import { MatrixView, type MatrixApp } from "@/components/apps/matrix-view";
import { AiPanel } from "@/components/dashboard/ai-panel";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);
  const base = `/e/${engagementId}`;

  const [apps, templates, responses, thresholds, nodes, finance] = await Promise.all([
    db.application.findMany({
      select: {
        id: true,
        name: true,
        acronym: true,
        appNumber: true,
        inScope: true,
        isUtilized: true,
        missionCritical: true,
        capabilityNodeId: true,
        result: true,
        override: { select: { disposition: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.surveyTemplate.findMany({ where: { questions: { some: {} } }, orderBy: { type: "asc" }, select: { id: true, name: true } }),
    db.surveyResponse.findMany({ select: { templateId: true, status: true, application: { select: { inScope: true } } } }),
    db.thresholdConfig.findFirst(),
    db.capabilityNode.findMany({ select: { id: true, parentId: true, level: true, name: true, isPlaceholder: true } }),
    loadFinanceRows(db),
  ]);

  const optBv = thresholds?.optBv ?? THRESHOLD_DEFAULTS.optBv;
  const optIt = thresholds?.optIt ?? THRESHOLD_DEFAULTS.optIt;
  const heat = { t1: thresholds?.heatT1 ?? THRESHOLD_DEFAULTS.heatT1, t2: thresholds?.heatT2 ?? THRESHOLD_DEFAULTS.heatT2 };
  const currency = engagement.currency;

  const finalOf = (app: (typeof apps)[number]): Disposition =>
    ((app.override?.disposition as Disposition | undefined) ??
      (app.result?.computedDisposition as Disposition | undefined) ??
      "UNKNOWN");

  // The workbook's analysis pool: in scope AND utilized (inventory §8).
  const pool = apps.filter((a) => a.inScope && a.isUtilized);
  const outOfScope = apps.filter((a) => !a.inScope).length;
  const nlu = apps.filter((a) => a.inScope && !a.isUtilized).length;
  const inScope = apps.length - outOfScope;

  const count = (d: Disposition) => pool.filter((a) => finalOf(a) === d).length;
  const quadrants = {
    redesign: count("REDESIGN"),
    keepAsIs: count("KEEP_AS_IS"),
    terminate: count("TERMINATE"),
    retool: count("RETOOL"),
    unknown: count("UNKNOWN"),
  };
  const scored = pool.length - quadrants.unknown;
  const changeRecommended = quadrants.terminate + quadrants.retool + quadrants.redesign;
  const overridden = apps.filter((a) => a.override).length;

  const missionCritical = pool.filter((a) => a.missionCritical);
  const veryLowBv = pool.filter((a) => a.result?.veryLowBv).length;
  const veryLowIt = pool.filter((a) => a.result?.veryLowIt).length;
  const unmapped = pool.filter((a) => !a.capabilityNodeId).length;

  const bvDistribution = computeScoreDistribution(pool.map((a) => a.result?.bvScore ?? 0));
  const itDistribution = computeScoreDistribution(pool.map((a) => a.result?.itScore ?? 0));

  const inScopeResponses = responses.filter((r) => r.application.inScope);

  // Capability hotspots: aggregate the pool per L1 ancestor and bucket with
  // the workbook heat rule. Red/yellow L1s surface here; the full (L1, L2)
  // grid lives on the Capabilities page.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const l1Of = (nodeId: string | null) => {
    let node = nodeId ? nodeById.get(nodeId) : undefined;
    while (node) {
      if (node.level === "L1") return node;
      node = node.parentId ? nodeById.get(node.parentId) : undefined;
    }
    return undefined;
  };
  const l1Tallies = new Map<string, { name: string; total: number; known: number; terminate: number; retoolRedesign: number }>();
  for (const app of pool) {
    const l1 = l1Of(app.capabilityNodeId);
    if (!l1 || l1.isPlaceholder) continue;
    const tally = l1Tallies.get(l1.id) ?? { name: l1.name, total: 0, known: 0, terminate: 0, retoolRedesign: 0 };
    const d = finalOf(app);
    tally.total += 1;
    if (d !== "UNKNOWN") {
      tally.known += 1;
      if (d === "TERMINATE") tally.terminate += 1;
      else if (d === "RETOOL" || d === "REDESIGN") tally.retoolRedesign += 1;
    }
    l1Tallies.set(l1.id, tally);
  }
  const hotspots = [...l1Tallies.values()]
    .map((t) => ({
      ...t,
      bucket: computeHeatBucket({ appCount: t.known, terminateCount: t.terminate, retoolRedesignCount: t.retoolRedesign }, heat),
    }))
    .filter((t) => t.bucket === "TERMINATE" || t.bucket === "RETOOL_REDESIGN")
    .sort((a, b) => (b.terminate + b.retoolRedesign) / b.known - (a.terminate + a.retoolRedesign) / a.known)
    .slice(0, 6);

  const matrixApps: MatrixApp[] = pool.map((a) => ({
    id: a.id,
    name: a.name,
    acronym: a.acronym,
    bv: a.result?.bvScore ?? 0,
    it: a.result?.itScore ?? 0,
    disposition: finalOf(a),
    href: `${base}/applications/${a.id}/edit`,
  }));

  const pctOfScored = (n: number) => (scored === 0 ? "" : `${Math.round((n / scored) * 100)}% of scored`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Live portfolio view over {pool.length} in-scope, utilized application{pool.length === 1 ? "" : "s"}.
          </p>
        </div>
        {ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT" ? (
          <div className="flex gap-2">
            <a href={`${base}/deck`} download className="hover:bg-secondary rounded-lg border px-3 py-1.5 text-sm font-medium">
              Export deck (PPTX)
            </a>
            <a href={`${base}/export`} download className="hover:bg-secondary rounded-lg border px-3 py-1.5 text-sm font-medium">
              Export data (XLSX)
            </a>
            {engagement.aiEnabled ? <AiPanel engagementId={engagementId} /> : null}
          </div>
        ) : null}
      </div>

      {/* Executive summary strip */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard value={String(apps.length)} label="Applications" sub={`${inScope} in scope · ${outOfScope} out of scope`} />
        <StatCard
          value={pool.length === 0 ? "—" : `${Math.round((scored / Math.max(pool.length, 1)) * 100)}%`}
          label="Portfolio scored"
          sub={`${scored} of ${pool.length} in the analysis pool`}
        />
        <StatCard
          value={String(changeRecommended + nlu)}
          label="Change recommended"
          sub={`${quadrants.terminate + nlu} exit · ${quadrants.retool + quadrants.redesign} transform`}
        />
        <StatCard
          value={finance.costed.length > 0 ? formatMoney(finance.totalCost, currency) : "—"}
          label="Annual cost assessed"
          sub={finance.costed.length > 0 ? `${finance.costed.length} of ${apps.length} apps costed` : "No Finance survey data yet"}
        />
        <StatCard
          value={finance.costed.length > 0 ? formatMoney(finance.savingsCandidate, currency) : "—"}
          label="Savings candidate"
          sub="Terminate + not-utilized annual cost"
          tone={finance.savingsCandidate > 0 ? "text-red-600" : undefined}
        />
      </div>

      {/* 2×2 disposition matrix — each card drills into the filtered inventory */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MatrixCell
          href={`${base}/applications?disposition=REDESIGN&scope=in`}
          label="Re-Design"
          sub="Low BV · High IT"
          value={quadrants.redesign}
          pct={pctOfScored(quadrants.redesign)}
          tone="text-amber-600"
        />
        <MatrixCell
          href={`${base}/applications?disposition=KEEP_AS_IS&scope=in`}
          label="Keep-As-Is"
          sub="High BV · High IT"
          value={quadrants.keepAsIs}
          pct={pctOfScored(quadrants.keepAsIs)}
          tone="text-green-600"
        />
        <MatrixCell
          href={`${base}/applications?disposition=TERMINATE&scope=in`}
          label="Terminate + NLU"
          sub="Low BV · Low IT (+ not utilized)"
          value={quadrants.terminate + nlu}
          pct={pctOfScored(quadrants.terminate)}
          tone="text-red-600"
        />
        <MatrixCell
          href={`${base}/applications?disposition=RETOOL&scope=in`}
          label="Re-Tool"
          sub="High BV · Low IT"
          value={quadrants.retool}
          pct={pctOfScored(quadrants.retool)}
          tone="text-blue-600"
        />
      </div>

      {(veryLowBv > 0 || veryLowIt > 0 || quadrants.unknown > 0) && (
        <div className="flex flex-wrap gap-2">
          {veryLowBv > 0 ? <Pill color="red">{veryLowBv} app(s) below the urgent Business Value threshold</Pill> : null}
          {veryLowIt > 0 ? <Pill color="red">{veryLowIt} app(s) below the urgent IT Health threshold</Pill> : null}
          {quadrants.unknown > 0 ? (
            <Link href={`${base}/applications?disposition=UNKNOWN&scope=in`}>
              <Pill color="gray">{quadrants.unknown} unscored (Unknown) — view</Pill>
            </Link>
          ) : null}
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
            <CardTitle className="text-base">Cost by disposition</CardTitle>
          </CardHeader>
          <CardContent>
            {finance.costed.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">
                No Finance survey data yet — the cost lens appears once Finance forms are filled.
              </p>
            ) : (
              <>
                <DonutChart
                  centerLabel={formatMoney(finance.totalCost, currency)}
                  slices={[
                    { name: DISPOSITION_LABELS.KEEP_AS_IS, value: finance.costOf("KEEP_AS_IS"), color: CHART_COLORS.green },
                    { name: DISPOSITION_LABELS.RETOOL, value: finance.costOf("RETOOL"), color: CHART_COLORS.blue },
                    { name: DISPOSITION_LABELS.REDESIGN, value: finance.costOf("REDESIGN"), color: CHART_COLORS.amber },
                    { name: DISPOSITION_LABELS.TERMINATE, value: finance.costOf("TERMINATE"), color: CHART_COLORS.red },
                    { name: "Unknown", value: finance.costOf("UNKNOWN"), color: CHART_COLORS.gray },
                  ]}
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Annual TCO from the Finance survey. Costs inform the conversation — they never drive the disposition.{" "}
                  <Link href={`${base}/financials`} className="underline">
                    Financials →
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Data confidence</CardTitle>
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
              <div className="text-muted-foreground space-y-1 border-t pt-2 text-xs">
                {quadrants.unknown > 0 ? <p>{quadrants.unknown} app(s) not yet scored (shown as Unknown).</p> : null}
                {unmapped > 0 ? <p>{unmapped} app(s) not mapped to a capability — excluded from the heat map.</p> : null}
                {quadrants.unknown === 0 && unmapped === 0 ? <p>All in-scope apps are scored and mapped.</p> : null}
                {ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT" ? (
                  <Link href={`${base}/quality`} className="underline">
                    Data quality checks →
                  </Link>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">4R Framework — Business Value × IT Health</CardTitle>
        </CardHeader>
        <CardContent>
          <MatrixView apps={matrixApps} optBv={optBv} optIt={optIt} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capability hotspots</CardTitle>
          </CardHeader>
          <CardContent>
            {hotspots.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No capability area currently exceeds the Terminate or Re-Tool/Re-Design heat thresholds.{" "}
                <Link href={`${base}/capabilities`} className="underline">
                  Capability map →
                </Link>
              </p>
            ) : (
              <div className="space-y-2">
                {hotspots.map((h) => (
                  <div key={h.name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <HeatDot bucket={h.bucket} />
                      {h.name}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {h.terminate > 0 ? `${h.terminate} terminate` : ""}
                      {h.terminate > 0 && h.retoolRedesign > 0 ? " · " : ""}
                      {h.retoolRedesign > 0 ? `${h.retoolRedesign} transform` : ""} of {h.known} scored
                    </span>
                  </div>
                ))}
                <p className="text-muted-foreground border-t pt-2 text-xs">
                  Business capabilities where the share of Terminate (red) or Re-Tool/Re-Design (yellow) apps exceeds the
                  heat thresholds.{" "}
                  <Link href={`${base}/capabilities`} className="underline">
                    Full heat map →
                  </Link>
                </p>
              </div>
            )}
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
                    <Link href={`${base}/applications/${a.id}/edit`} className="hover:underline">
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

      {/* Executive legend: what the terms mean, in one glance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How to read this dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <Definition color={CHART_COLORS.green} term="Keep-As-Is" text="High business value on healthy technology — retain and maintain." />
            <Definition color={CHART_COLORS.blue} term="Re-Tool" text="High business value on weak technology — modernize the platform." />
            <Definition color={CHART_COLORS.amber} term="Re-Design" text="Healthy technology but low business value — rework or consolidate the functionality." />
            <Definition color={CHART_COLORS.red} term="Terminate" text="Low value on poor health — candidate for retirement." />
            <Definition color={CHART_COLORS.gray} term="Unknown" text="Not yet scored — complete the Business and IT surveys to classify." />
            <Definition color="#6b7280" term="NLU" text="No longer utilized — in scope but already unused; grouped with Terminate." />
          </dl>
          <p className="text-muted-foreground mt-3 text-xs">
            Dispositions are computed from importance-weighted survey scores against the engagement&apos;s thresholds
            {overridden > 0 ? (
              <>
                {" "}
                ({overridden} of them manually overridden with justification — see the{" "}
                <Link href={`${base}/audit`} className="underline">
                  audit log
                </Link>
                )
              </>
            ) : null}
            . Costs provide context and never drive a disposition.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ value, label, sub, tone }: { value: string; label: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className={`truncate text-lg font-semibold tabular-nums ${tone ?? ""}`} title={value}>
        {value}
      </div>
      <div className="text-sm font-medium">{label}</div>
      {sub ? <div className="text-muted-foreground text-xs">{sub}</div> : null}
    </div>
  );
}

function MatrixCell({
  href,
  label,
  sub,
  value,
  pct,
  tone,
}: {
  href: string;
  label: string;
  sub: string;
  value: number;
  pct: string;
  tone: string;
}) {
  return (
    <Link href={href} className="hover:border-foreground/20 rounded-xl border bg-card p-4 transition-colors">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</span>
        {pct ? <span className="text-muted-foreground text-xs">{pct}</span> : null}
      </div>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-muted-foreground text-xs">{sub}</div>
    </Link>
  );
}

function HeatDot({ bucket }: { bucket: HeatBucket | null }) {
  const color = bucket === "TERMINATE" ? "#CC0000" : bucket === "RETOOL_REDESIGN" ? "#FFFF00" : "#00B050";
  return <span className="inline-block size-2.5 shrink-0 rounded-full border border-black/20" style={{ backgroundColor: color }} />;
}

function Definition({ color, term, text }: { color: string; term: string; text: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-1.5 inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div>
        <dt className="inline font-medium">{term}</dt> <dd className="text-muted-foreground inline">— {text}</dd>
      </div>
    </div>
  );
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}
