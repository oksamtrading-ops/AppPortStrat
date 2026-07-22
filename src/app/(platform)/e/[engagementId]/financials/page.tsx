import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { computeFinancialScore, DISPOSITION_COLORS, DISPOSITION_LABELS } from "@/lib/methodology";
import type { Disposition } from "@/lib/methodology";
import { GRAND_TOTAL_SECTIONS, formatMoney } from "@/lib/finance";
import { loadFinanceRows } from "@/lib/finance-rows";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill, type PillColor } from "@/components/ui/pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DonutChart } from "@/components/dashboard/charts";
import { ImportCostRecordsDialog } from "@/components/financials/cost-import-dialog";
import { clearCostRecords } from "./actions";

export const dynamic = "force-dynamic";

const DISPOSITION_COLOR: Record<Disposition, PillColor> = {
  KEEP_AS_IS: "green",
  RETOOL: "blue",
  REDESIGN: "amber",
  TERMINATE: "red",
  UNKNOWN: "gray",
};

export default async function FinancialsPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);
  const currency = engagement.currency;

  const [{ costed, maxGrandTotal, totalCost, savingsCandidate, costOf }, nodes, costRecords] = await Promise.all([
    loadFinanceRows(db),
    db.capabilityNode.findMany({ select: { id: true, parentId: true, level: true, name: true } }),
    db.costRecord.findMany({ select: { fiscalYear: true, versionType: true, category: true, amount: true } }),
  ]);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const l1Of = (nodeId: string | null): string => {
    let node = nodeId ? nodeById.get(nodeId) : undefined;
    while (node) {
      if (node.level === "L1") return node.name;
      node = node.parentId ? nodeById.get(node.parentId) : undefined;
    }
    return "Unmapped";
  };

  const grandSections = [...GRAND_TOTAL_SECTIONS];
  const costByL1 = new Map<string, number>();
  for (const r of costed) {
    const l1 = l1Of(r.capabilityNodeId);
    costByL1.set(l1, (costByL1.get(l1) ?? 0) + r.grandTotal);
  }
  const maxL1Cost = Math.max(1, ...costByL1.values());

  // Fiscal-year dataset pivot (PIVOT sheet replacement).
  const costCategories = [...new Set(costRecords.map((r) => r.category))].sort();
  const pivotKeys = [...new Set(costRecords.map((r) => `${r.fiscalYear} ${r.versionType}`))].sort();
  const pivot = new Map<string, Map<string, number>>();
  for (const record of costRecords) {
    const key = `${record.fiscalYear} ${record.versionType}`;
    const byCategory = pivot.get(key) ?? new Map<string, number>();
    // Decimal → number once at the read boundary (money stays Decimal in the DB).
    byCategory.set(record.category, (byCategory.get(record.category) ?? 0) + Number(record.amount));
    pivot.set(key, byCategory);
  }

  const canEdit = (ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT") && !ctx.readOnly;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Financials</h1>
          <p className="text-muted-foreground text-sm">
            TCO from the Finance survey · costs are context — never an input to disposition (workbook-faithful).
          </p>
        </div>
        {canEdit ? <ImportCostRecordsDialog engagementId={engagementId} /> : null}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total annual cost (costed apps)" value={formatMoney(totalCost, currency)} />
        <StatCard label="Terminate + NLU cost (savings candidate)" value={formatMoney(savingsCandidate, currency)} tone="text-red-600" />
        <StatCard label="Re-Tool / Re-Design cost" value={formatMoney(costOf("RETOOL") + costOf("REDESIGN"), currency)} tone="text-amber-600" />
        <StatCard label="Keep-As-Is cost" value={formatMoney(costOf("KEEP_AS_IS"), currency)} tone="text-green-600" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost by disposition</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart
              centerLabel={costed.length ? `${costed.length} costed` : undefined}
              formatValue={(n) => formatMoney(n, currency)}
              slices={[
                { name: DISPOSITION_LABELS.KEEP_AS_IS, value: costOf("KEEP_AS_IS"), color: DISPOSITION_COLORS.KEEP_AS_IS },
                { name: DISPOSITION_LABELS.RETOOL, value: costOf("RETOOL"), color: DISPOSITION_COLORS.RETOOL },
                { name: DISPOSITION_LABELS.REDESIGN, value: costOf("REDESIGN"), color: DISPOSITION_COLORS.REDESIGN },
                { name: DISPOSITION_LABELS.TERMINATE, value: costOf("TERMINATE"), color: DISPOSITION_COLORS.TERMINATE },
                { name: "Unknown", value: costOf("UNKNOWN"), color: DISPOSITION_COLORS.UNKNOWN },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost by L1 capability</CardTitle>
          </CardHeader>
          <CardContent>
            {costByL1.size === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">No cost data yet — fill Finance surveys.</p>
            ) : (
              <div className="space-y-2">
                {[...costByL1.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([l1, cost]) => (
                    <div key={l1}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{l1}</span>
                        <span className="text-muted-foreground text-xs tabular-nums">{formatMoney(cost, currency)}</span>
                      </div>
                      <div className="bg-secondary mt-0.5 h-2 w-full overflow-hidden rounded">
                        <div className="bg-brand h-full" style={{ width: `${Math.round((cost / maxL1Cost) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-application TCO</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Application</TableHead>
                {grandSections.map((s) => (
                  <TableHead key={s} className="text-right">
                    {s.replace(" Costs", "")}
                  </TableHead>
                ))}
                <TableHead className="text-right">Grand total</TableHead>
                <TableHead className="text-right" title="Grand total ÷ max grand total across in-scope apps (workbook Finance!53)">
                  Fin. score
                </TableHead>
                <TableHead>Disposition</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costed.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
                    No Finance survey data yet. Open an application&apos;s surveys and fill the Finance form.
                  </TableCell>
                </TableRow>
              ) : (
                costed.map(({ appId, appNumber, name, subtotals, grandTotal, finalDisposition }) => {
                  const score = computeFinancialScore(grandTotal, maxGrandTotal);
                  return (
                    <TableRow key={appId}>
                      <TableCell className="text-muted-foreground tabular-nums">{appNumber}</TableCell>
                      <TableCell>
                        <Link href={`/e/${engagementId}/surveys/${appId}/finance`} className="font-medium hover:underline">
                          {name}
                        </Link>
                      </TableCell>
                      {grandSections.map((s) => (
                        <TableCell key={s} className="text-right tabular-nums">
                          {subtotals.has(s) ? formatMoney(subtotals.get(s)!, currency) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{formatMoney(grandTotal, currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{score === null ? "—" : score.toFixed(2)}</TableCell>
                      <TableCell>
                        <Pill color={DISPOSITION_COLOR[finalDisposition]}>{DISPOSITION_LABELS[finalDisposition]}</Pill>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            Fiscal-year cost dataset
            {costRecords.length > 0 && ctx.role === "ENGAGEMENT_LEAD" && !ctx.readOnly ? (
              <form action={clearCostRecords}>
                <input type="hidden" name="engagementId" value={engagementId} />
                <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground h-6 px-2 text-xs">
                  Clear dataset
                </Button>
              </form>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {costRecords.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No fiscal-year data imported. Use “Import cost data” to load the flat Actual/Budget/Forecast table
              (the workbook&apos;s Financial Data sheet).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fiscal year · version</TableHead>
                  {costCategories.map((c) => (
                    <TableHead key={c} className="text-right">
                      {c}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivotKeys.map((key) => {
                  const byCategory = pivot.get(key)!;
                  const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-medium">{key}</TableCell>
                      {costCategories.map((c) => (
                        <TableCell key={c} className="text-right tabular-nums">
                          {byCategory.has(c) ? formatMoney(byCategory.get(c)!, currency) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{formatMoney(total, currency)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className={`text-lg font-semibold tabular-nums ${tone ?? ""}`}>{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
