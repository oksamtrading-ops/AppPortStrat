// NOTE: no "server-only" marker — exercised by verification scripts; only server code imports this.
import type { ScopedDb } from "@/lib/db/scoped";
import { finalDisposition } from "@/lib/methodology";

/**
 * Shared per-capability disposition tallies for the Capability Map cards and
 * the heat-map grid. Final disposition = override ?? computed; heat cells
 * count only KNOWN dispositions (inventory §6.1).
 */

export interface CapabilityTally {
  total: number;
  known: number;
  terminate: number;
  retool: number;
  redesign: number;
  retain: number;
}

export const EMPTY_TALLY: CapabilityTally = { total: 0, known: 0, terminate: 0, retool: 0, redesign: 0, retain: 0 };

export interface CapabilityNodeRow {
  id: string;
  parentId: string | null;
  level: "L0" | "L1" | "L2";
  name: string;
  isPlaceholder: boolean;
}

export async function loadCapabilityTallies(db: ScopedDb): Promise<{
  nodes: CapabilityNodeRow[];
  tallyOf: (nodeId: string) => CapabilityTally;
}> {
  const [nodes, apps] = await Promise.all([
    db.capabilityNode.findMany({ orderBy: [{ isPlaceholder: "asc" }, { name: "asc" }] }),
    db.application.findMany({
      where: { capabilityNodeId: { not: null } },
      select: {
        capabilityNodeId: true,
        result: { select: { computedDisposition: true } },
        override: { select: { disposition: true } },
      },
    }),
  ]);

  const tallies = new Map<string, CapabilityTally>();
  for (const app of apps) {
    const nodeId = app.capabilityNodeId!;
    const final = finalDisposition(app);
    const tally = tallies.get(nodeId) ?? { ...EMPTY_TALLY };
    tally.total += 1;
    if (final !== "UNKNOWN") {
      tally.known += 1;
      if (final === "TERMINATE") tally.terminate += 1;
      else if (final === "RETOOL") tally.retool += 1;
      else if (final === "REDESIGN") tally.redesign += 1;
      else tally.retain += 1;
    }
    tallies.set(nodeId, tally);
  }

  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      level: n.level as CapabilityNodeRow["level"],
      name: n.name,
      isPlaceholder: n.isPlaceholder,
    })),
    tallyOf: (nodeId: string) => tallies.get(nodeId) ?? EMPTY_TALLY,
  };
}
