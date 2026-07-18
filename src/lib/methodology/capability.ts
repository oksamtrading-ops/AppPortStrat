/**
 * Capability paste parsing — the VBA add_Capability replacement (inventory
 * §2.3, §6.3): users paste the denormalized 3-column L0 | L1 | L2 table
 * straight from Excel (tab-separated). Blank L0/L1 cells become explicit
 * placeholder parents ("Unassigned", the workbook's literal "Level L0"/"Level
 * L1" made visible), and deduplication happens per parent — continuously, no
 * refresh button.
 */

export const UNASSIGNED = "Unassigned";

export interface ParsedCapabilityTree {
  /** L0 name → L1 name → set of L2 names. Placeholders use UNASSIGNED. */
  tree: Map<string, Map<string, Set<string>>>;
  rowCount: number;
  skippedLines: number;
}

export function parseCapabilityPaste(text: string): ParsedCapabilityTree {
  const tree = new Map<string, Map<string, Set<string>>>();
  let rowCount = 0;
  let skippedLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === "") {
      // A line WITH cell structure but only blank cells is a skipped row;
      // plain empty lines are paste artifacts and ignored silently.
      if (rawLine.includes("\t")) skippedLines += 1;
      continue;
    }
    const cells = rawLine.split("\t").map((c) => c.trim());
    const [l0raw = "", l1raw = "", l2raw = ""] = cells;

    const l0 = l0raw || UNASSIGNED;
    const l1 = l1raw || UNASSIGNED;

    let l1Map = tree.get(l0);
    if (!l1Map) {
      l1Map = new Map();
      tree.set(l0, l1Map);
    }
    let l2Set = l1Map.get(l1);
    if (!l2Set) {
      l2Set = new Set();
      l1Map.set(l1, l2Set);
    }
    if (l2raw) l2Set.add(l2raw);
    rowCount += 1;
  }

  return { tree, rowCount, skippedLines };
}
