import { requireEngagementContext } from "@/lib/auth/context";
import { toCsv } from "@/lib/tabular";
import { writeAudit } from "@/lib/audit";

/**
 * Capability model CSV export — the denormalized three-column layout of the
 * workbook's tab_Capability_Map (one row per L2; L0/L1-only branches emit a
 * row with blank deeper columns), so a round-trip through Excel and the
 * paste-import works.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId, "CONSULTANT");
  const { tooManyRequests } = await import("@/lib/rate-limit-route");
  const limited = await tooManyRequests(`export:${ctx.membershipId}`, 30, 60);
  if (limited) return limited;

  const nodes = await db.capabilityNode.findMany({ orderBy: { name: "asc" } });
  const childrenOf = (parentId: string) => nodes.filter((n) => n.parentId === parentId);

  const rows: Array<[string, string, string]> = [];
  for (const l0 of nodes.filter((n) => n.level === "L0")) {
    const l1s = childrenOf(l0.id);
    if (l1s.length === 0) rows.push([l0.name, "", ""]);
    for (const l1 of l1s) {
      const l2s = childrenOf(l1.id);
      if (l2s.length === 0) rows.push([l0.name, l1.name, ""]);
      for (const l2 of l2s) rows.push([l0.name, l1.name, l2.name]);
    }
  }

  await writeAudit(db, ctx, {
    action: "export.capabilities",
    entityType: "CapabilityNode",
    after: { rows: rows.length, format: "csv" },
  });

  const filename = `${engagement.name.replace(/[^\w-]+/g, "_")}_capabilities.csv`;
  return new Response(toCsv(["L0 Capability", "L1 Capability", "L2 Capability"], rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
