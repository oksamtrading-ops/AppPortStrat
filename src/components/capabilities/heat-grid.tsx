import Link from "next/link";
import { computeHeatBucket, HEAT_COLORS, retainShare } from "@/lib/methodology";
import type { HeatThresholds } from "@/lib/methodology";
import type { CapabilityNodeRow, CapabilityTally } from "@/lib/capability-heat";

/**
 * The workbook's rendered Heat Map (VBA generate_Heatmap, inventory §6.3):
 * columns = L1 capabilities, cells below = that L1's L2s, colored by the
 * exact rule and RGBs — Terminate RGB(204,0,0) white text, Re-Tool/Re-Design
 * RGB(255,255,0) black text, Retain RGB(0,176,80) white text, no data white.
 * L0 does not appear on the heat map (workbook-faithful).
 */
export function HeatGrid({
  engagementId,
  nodes,
  tallyOf,
  heat,
  splitYellow,
}: {
  engagementId: string;
  nodes: CapabilityNodeRow[];
  tallyOf: (nodeId: string) => CapabilityTally;
  heat: HeatThresholds;
  splitYellow: boolean;
}) {
  const l1s = nodes.filter((n) => n.level === "L1").sort((a, b) => a.name.localeCompare(b.name));
  const childrenOf = (parentId: string) => nodes.filter((n) => n.parentId === parentId);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-xl border bg-card p-4">
        <div className="flex gap-2" style={{ minWidth: l1s.length * 176 }}>
          {l1s.map((l1) => {
            const l2s = childrenOf(l1.id);
            return (
              <div key={l1.id} className="w-44 shrink-0 space-y-1.5">
                <div className="bg-foreground text-background rounded-md p-2 text-center text-xs font-semibold leading-tight">
                  {l1.name}
                </div>
                {l2s.map((l2) => {
                  const t = tallyOf(l2.id);
                  const bucket = computeHeatBucket(
                    { appCount: t.known, terminateCount: t.terminate, retoolRedesignCount: t.retool + t.redesign },
                    heat,
                  );
                  const style =
                    bucket === "TERMINATE"
                      ? { backgroundColor: HEAT_COLORS.TERMINATE, color: "white" }
                      : bucket === "RETOOL_REDESIGN"
                        ? { backgroundColor: HEAT_COLORS.RETOOL_REDESIGN, color: "black" }
                        : bucket === "RETAIN"
                          ? { backgroundColor: HEAT_COLORS.RETAIN, color: "white" }
                          : undefined;
                  const title =
                    t.total === 0
                      ? `${l2.name} — no applications mapped`
                      : `${l2.name} — ${t.total} app(s): ${t.terminate} terminate, ${t.retool} re-tool, ${t.redesign} re-design, ${t.retain} keep, ${t.total - t.known} unknown`;
                  return (
                    <Link
                      key={l2.id}
                      href={`/e/${engagementId}/applications?cap=${l2.id}`}
                      title={title}
                      style={style}
                      className="block rounded-md border p-2 text-center text-xs font-medium leading-tight transition-transform hover:scale-[1.02]"
                    >
                      {l2.name}
                      {splitYellow && bucket === "RETOOL_REDESIGN" ? (
                        <span className="mt-0.5 block text-[10px] font-normal">
                          RT {t.retool} · RD {t.redesign}
                        </span>
                      ) : null}
                      {t.total > 0 ? <span className="mt-0.5 block text-[10px] font-normal opacity-80">{t.total} app(s)</span> : null}
                    </Link>
                  );
                })}
                {l2s.length === 0 ? (
                  <div className="text-muted-foreground rounded-md border border-dashed p-2 text-center text-[10px]">
                    no L2s
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Threshold panel (workbook 'Heat Map' J1/J3/J5) */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: HEAT_COLORS.TERMINATE }} />
          more than {Math.round(heat.t1 * 100)}% terminate
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border" style={{ backgroundColor: HEAT_COLORS.RETOOL_REDESIGN }} />
          re-tool/re-design above {Math.round((heat.t2 - heat.t1) * 100)}%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded" style={{ backgroundColor: HEAT_COLORS.RETAIN }} />
          retain (≥ {Math.round(retainShare(heat) * 100)}%)
        </span>
        <span>White = no scored applications. Click a cell to see its applications.</span>
      </div>
    </div>
  );
}
