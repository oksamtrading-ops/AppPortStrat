import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { computeHeatBucket } from "@/lib/methodology";
import type { Disposition } from "@/lib/methodology";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CapabilityBoard, type L0SectionData, type L1CardData } from "@/components/capabilities/board";
import { ImportCapabilitiesDialog } from "@/components/capabilities/import-dialog";
import { addCapabilityNode } from "./actions";

export const dynamic = "force-dynamic";

export default async function CapabilitiesPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [nodes, apps, thresholds] = await Promise.all([
    db.capabilityNode.findMany({ orderBy: [{ isPlaceholder: "asc" }, { name: "asc" }] }),
    db.application.findMany({
      where: { capabilityNodeId: { not: null } },
      select: {
        capabilityNodeId: true,
        result: { select: { computedDisposition: true } },
        override: { select: { disposition: true } },
      },
    }),
    db.thresholdConfig.findFirst(),
  ]);
  const heat = {
    t1: thresholds?.heatT1 ?? THRESHOLD_DEFAULTS.heatT1,
    t2: thresholds?.heatT2 ?? THRESHOLD_DEFAULTS.heatT2,
  };

  // Per-node disposition tallies (final = override ?? computed; workbook heat
  // cells count only known dispositions — inventory §6.1).
  interface Tally {
    total: number;
    known: number;
    terminate: number;
    retoolRedesign: number;
    retain: number;
  }
  const tallies = new Map<string, Tally>();
  for (const app of apps) {
    const nodeId = app.capabilityNodeId!;
    const computed = (app.result?.computedDisposition ?? "UNKNOWN") as Disposition;
    const final = (app.override?.disposition as Disposition | undefined) ?? computed;
    const tally = tallies.get(nodeId) ?? { total: 0, known: 0, terminate: 0, retoolRedesign: 0, retain: 0 };
    tally.total += 1;
    if (final !== "UNKNOWN") {
      tally.known += 1;
      if (final === "TERMINATE") tally.terminate += 1;
      else if (final === "RETOOL" || final === "REDESIGN") tally.retoolRedesign += 1;
      else tally.retain += 1;
    }
    tallies.set(nodeId, tally);
  }
  const tallyOf = (id: string): Tally => tallies.get(id) ?? { total: 0, known: 0, terminate: 0, retoolRedesign: 0, retain: 0 };

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
              { appCount: t.known, terminateCount: t.terminate, retoolRedesignCount: t.retoolRedesign },
              heat,
            ),
          };
        });
        // L1 chips aggregate the subtree: its own directly-mapped apps + all L2s.
        const own = tallyOf(l1.id);
        const agg = childrenOf(l1.id).reduce(
          (acc, l2) => {
            const t = tallyOf(l2.id);
            acc.total += t.total;
            acc.terminate += t.terminate;
            acc.retoolRedesign += t.retoolRedesign;
            acc.retain += t.retain;
            return acc;
          },
          { total: own.total, terminate: own.terminate, retoolRedesign: own.retoolRedesign, retain: own.retain },
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Capability Map</h1>
          <p className="text-muted-foreground text-sm">
            {nodeCount} capabilit{nodeCount === 1 ? "y" : "ies"} · L2 tiles are colored by the heat-map rule
            {canEdit ? " · drag an L2 onto another L1 to move it" : ""}
          </p>
        </div>
        {canEdit ? (
          <div className="flex items-center gap-2">
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
          </div>
        ) : null}
      </div>

      {sections.length === 0 ? (
        <p className="text-muted-foreground text-sm">No capability model yet — import one or add an L0 capability.</p>
      ) : (
        <CapabilityBoard engagementId={engagementId} sections={sections} canEdit={canEdit} />
      )}
    </div>
  );
}
