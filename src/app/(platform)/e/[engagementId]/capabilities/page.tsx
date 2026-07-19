import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { computeHeatBucket } from "@/lib/methodology";
import { loadCapabilityTallies } from "@/lib/capability-heat";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CapabilityBoard, type L0SectionData, type L1CardData } from "@/components/capabilities/board";
import { ImportCapabilitiesDialog } from "@/components/capabilities/import-dialog";
import { HeatGrid } from "@/components/capabilities/heat-grid";
import { addCapabilityNode } from "./actions";

export const dynamic = "force-dynamic";

export default async function CapabilitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { engagementId } = await params;
  const { view } = await searchParams;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [{ nodes, tallyOf }, thresholds] = await Promise.all([
    loadCapabilityTallies(db),
    db.thresholdConfig.findFirst(),
  ]);
  const heat = {
    t1: thresholds?.heatT1 ?? THRESHOLD_DEFAULTS.heatT1,
    t2: thresholds?.heatT2 ?? THRESHOLD_DEFAULTS.heatT2,
  };

  const childrenOf = (parentId: string) => nodes.filter((n) => n.parentId === parentId);
  const sections: L0SectionData[] = nodes
    .filter((n) => n.level === "L0")
    .map((l0) => ({
      id: l0.id,
      name: l0.name,
      isPlaceholder: l0.isPlaceholder,
      l1s: childrenOf(l0.id).map((l1): L1CardData => {
        const l2s = childrenOf(l1.id).map((l2) => {
          const t = tallyOf(l2.id);
          return {
            id: l2.id,
            name: l2.name,
            isPlaceholder: l2.isPlaceholder,
            appCount: t.total,
            bucket: computeHeatBucket(
              { appCount: t.known, terminateCount: t.terminate, retoolRedesignCount: t.retool + t.redesign },
              heat,
            ),
          };
        });
        const own = tallyOf(l1.id);
        const agg = childrenOf(l1.id).reduce(
          (acc, l2) => {
            const t = tallyOf(l2.id);
            acc.total += t.total;
            acc.terminate += t.terminate;
            acc.retoolRedesign += t.retool + t.redesign;
            acc.retain += t.retain;
            return acc;
          },
          { total: own.total, terminate: own.terminate, retoolRedesign: own.retool + own.redesign, retain: own.retain },
        );
        return {
          id: l1.id,
          name: l1.name,
          isPlaceholder: l1.isPlaceholder,
          appCount: agg.total,
          terminate: agg.terminate,
          retoolRedesign: agg.retoolRedesign,
          retain: agg.retain,
          l2s,
        };
      }),
    }));

  const canEdit = (ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT") && !ctx.readOnly;
  const nodeCount = nodes.length;
  const activeView = view === "heatmap" ? "heatmap" : "cards";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Capability Map</h1>
          <p className="text-muted-foreground text-sm">
            {nodeCount} capabilit{nodeCount === 1 ? "y" : "ies"}
            {activeView === "cards" && canEdit ? " · drag an L2 onto another L1 to move it" : ""}
            {activeView === "heatmap" ? " · the workbook heat map, computed live" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-secondary flex rounded-lg p-0.5">
            {(
              [
                ["cards", "Cards"],
                ["heatmap", "Heat map"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={key === "heatmap" ? "?view=heatmap" : "?"}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  activeView === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </div>
          {canEdit ? (
            <>
              <Button asChild variant="outline">
                <a href={`/e/${engagementId}/capabilities/export`} download>
                  Export
                </a>
              </Button>
              <ImportCapabilitiesDialog engagementId={engagementId} />
              <form action={addCapabilityNode} className="flex items-center gap-1">
                <input type="hidden" name="engagementId" value={engagementId} />
                <Input name="name" placeholder="New L0…" required className="h-9 w-36 rounded-lg text-sm" />
                <Button type="submit">+ Add L0</Button>
              </form>
            </>
          ) : null}
        </div>
      </div>

      {nodeCount === 0 ? (
        <p className="text-muted-foreground text-sm">No capability model yet — import one or add an L0 capability.</p>
      ) : activeView === "heatmap" ? (
        <HeatGrid
          engagementId={engagementId}
          nodes={nodes}
          tallyOf={tallyOf}
          heat={heat}
          splitYellow={engagement.splitHeatmapYellow}
        />
      ) : (
        <CapabilityBoard engagementId={engagementId} sections={sections} canEdit={canEdit} />
      )}
    </div>
  );
}
