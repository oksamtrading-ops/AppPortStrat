import "server-only";
import type { ScopedDb } from "@/lib/db/scoped";
import type { CapabilityNodeOption } from "@/components/apps/capability-select";

/** Shared loader for the application form's reference data. */
export async function loadApplicationFormData(db: ScopedDb): Promise<{
  nodes: CapabilityNodeOption[];
  applicationTypes: string[];
  actionPlanOptions: string[];
}> {
  const [nodes, lists] = await Promise.all([
    db.capabilityNode.findMany({ orderBy: { name: "asc" } }),
    db.optionList.findMany({
      where: { key: { in: ["applicationType", "actionPlanAssignment"] } },
      include: { items: { orderBy: { orderIndex: "asc" } } },
    }),
  ]);
  const valuesFor = (key: string) => lists.find((l) => l.key === key)?.items.map((i) => i.value) ?? [];
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      level: n.level as CapabilityNodeOption["level"],
      name: n.name,
      isPlaceholder: n.isPlaceholder,
    })),
    applicationTypes: valuesFor("applicationType"),
    actionPlanOptions: valuesFor("actionPlanAssignment"),
  };
}
