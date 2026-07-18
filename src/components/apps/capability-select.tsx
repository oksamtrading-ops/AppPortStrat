"use client";

import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";

export interface CapabilityNodeOption {
  id: string;
  parentId: string | null;
  level: "L0" | "L1" | "L2";
  name: string;
  isPlaceholder: boolean;
}

/**
 * Cascading L0 → L1 → L2 selects (the workbook's dependent dropdowns). The
 * value submitted is the DEEPEST selected node id — the single
 * capabilityNodeId the schema stores; ancestors derive from the tree.
 */
export function CapabilitySelect({
  nodes,
  initialNodeId,
  name = "capabilityNodeId",
}: {
  nodes: CapabilityNodeOption[];
  initialNodeId: string | null;
  name?: string;
}) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Derive the initial chain (deepest node → ancestors).
  const initialChain = useMemo(() => {
    const chain: Record<"L0" | "L1" | "L2", string | ""> = { L0: "", L1: "", L2: "" };
    let node = initialNodeId ? byId.get(initialNodeId) : undefined;
    while (node) {
      chain[node.level] = node.id;
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return chain;
  }, [initialNodeId, byId]);

  const [l0, setL0] = useState<string>(initialChain.L0);
  const [l1, setL1] = useState<string>(initialChain.L1);
  const [l2, setL2] = useState<string>(initialChain.L2);

  const l0Options = nodes.filter((n) => n.level === "L0");
  const l1Options = nodes.filter((n) => n.level === "L1" && n.parentId === l0);
  const l2Options = nodes.filter((n) => n.level === "L2" && n.parentId === l1);

  const deepest = l2 || l1 || l0 || "";

  const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <input type="hidden" name={name} value={deepest} />
      <div className="space-y-1">
        <Label>L0 capability</Label>
        <select
          className={selectClass}
          value={l0}
          onChange={(e) => {
            setL0(e.target.value);
            setL1("");
            setL2("");
          }}
        >
          <option value="">—</option>
          {l0Options.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
              {n.isPlaceholder ? " (unassigned)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>L1 capability</Label>
        <select
          className={selectClass}
          value={l1}
          disabled={!l0}
          onChange={(e) => {
            setL1(e.target.value);
            setL2("");
          }}
        >
          <option value="">—</option>
          {l1Options.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
              {n.isPlaceholder ? " (unassigned)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label>L2 capability</Label>
        <select className={selectClass} value={l2} disabled={!l1} onChange={(e) => setL2(e.target.value)}>
          <option value="">—</option>
          {l2Options.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
