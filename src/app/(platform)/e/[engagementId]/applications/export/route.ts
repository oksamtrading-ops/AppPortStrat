import { requireEngagementContext } from "@/lib/auth/context";
import { toCsv } from "@/lib/tabular";
import { DISPOSITION_LABELS, FILTER_LABELS } from "@/lib/methodology";
import type { Disposition, FilterHit } from "@/lib/methodology";
import { writeAudit } from "@/lib/audit";

/**
 * Application inventory CSV export (Consultant+; never Client Respondents —
 * requireEngagementContext's scoped client would deny their read anyway).
 * All user-authored strings pass through formula-injection escaping.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId, "CONSULTANT");

  const [applications, nodes] = await Promise.all([
    db.application.findMany({
      orderBy: { appNumber: "asc" },
      include: { result: true, override: true },
    }),
    db.capabilityNode.findMany({ select: { id: true, parentId: true, level: true, name: true } }),
  ]);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const chainFor = (nodeId: string | null): { l0: string; l1: string; l2: string } => {
    const chain = { l0: "", l1: "", l2: "" };
    let node = nodeId ? nodeById.get(nodeId) : undefined;
    while (node) {
      if (node.level === "L0") chain.l0 = node.name;
      if (node.level === "L1") chain.l1 = node.name;
      if (node.level === "L2") chain.l2 = node.name;
      node = node.parentId ? nodeById.get(node.parentId) : undefined;
    }
    return chain;
  };

  const header = [
    "App #",
    "Name",
    "Acronym",
    "Description",
    "Type",
    "L0 Capability",
    "L1 Capability",
    "L2 Capability",
    "Business Function Detail",
    "Target",
    "Meets Future State",
    "Action Plan Assignment",
    "Action Plan Justification",
    "Mission Critical",
    "In Scope",
    "Is Utilized",
    "Is Replaced",
    "In Flight",
    "BV Score",
    "IT Score",
    "Computed Disposition",
    "Override Disposition",
    "Override Justification",
    "Filter Status",
    "Analysis Candidate",
    "Comments",
  ];

  const rows = applications.map((app) => {
    const chain = chainFor(app.capabilityNodeId);
    const computed = (app.result?.computedDisposition ?? "UNKNOWN") as Disposition;
    const finalDisposition = (app.override?.disposition as Disposition | undefined) ?? computed;
    const statusLabel = app.result?.filterHit
      ? FILTER_LABELS[app.result.filterHit as FilterHit]
      : DISPOSITION_LABELS[finalDisposition];
    return [
      app.appNumber,
      app.name,
      app.acronym,
      app.description,
      app.applicationType,
      chain.l0,
      chain.l1,
      chain.l2,
      app.businessFunctionDetail,
      app.target,
      app.meetsFutureState,
      app.actionPlanAssignment,
      app.actionPlanJustification,
      app.missionCritical ? "Y" : "N",
      app.inScope ? "Y" : "N",
      app.isUtilized ? "Y" : "N",
      app.isReplaced ? "Y" : "N",
      app.inFlight ? "Y" : "N",
      app.result?.bvScore ?? "",
      app.result?.itScore ?? "",
      DISPOSITION_LABELS[computed],
      app.override ? DISPOSITION_LABELS[app.override.disposition as Disposition] : "",
      app.override?.justification ?? "",
      statusLabel,
      app.result?.analysisCandidate ? "Y" : "N",
      app.comments,
    ];
  });

  await writeAudit(db, ctx, {
    action: "export.applications",
    entityType: "Application",
    after: { rows: rows.length, format: "csv" },
  });

  const filename = `${engagement.name.replace(/[^\w-]+/g, "_")}_applications.csv`;
  return new Response(toCsv(header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
