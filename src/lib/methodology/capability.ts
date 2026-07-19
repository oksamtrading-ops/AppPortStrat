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

// ──────────────────── EA-tool-export-aware import ─────────────────────

/** Quote-aware single-line CSV split for a given delimiter. */
function splitDelimited(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) { cells.push(cur); cur = ""; }
    else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function detectDelimiter(line: string): string {
  if (line.includes("\t")) return "\t";
  if (line.includes(";")) return ";";
  return ",";
}

/**
 * Import parser that also understands capability exports in the two shapes
 * enterprise architecture tools produce, in CSV (comma/semicolon) or TSV:
 *   1. Level columns: a header row with "Level 1", "Level 2", "Level 3".
 *   2. Name + Parent: a header with "Name" (or "Display Name") and "Parent".
 * Anything else falls through to the classic headerless 3-column Excel paste.
 * Hierarchy deeper than three levels is skipped and counted (our model — and
 * the rationalization conversation — stops at L2).
 */
export function parseCapabilityImport(text: string): ParsedCapabilityTree {
  const lines = text.split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim() !== "");
  if (firstIdx === -1) return parseCapabilityPaste(text);
  const delim = detectDelimiter(lines[firstIdx]);
  const header = splitDelimited(lines[firstIdx], delim).map((h) => h.toLowerCase());

  const levelCols = [header.indexOf("level 1"), header.indexOf("level 2"), header.indexOf("level 3")];
  const nameCol = header.findIndex((h) => h === "name" || h === "display name");
  const parentCol = header.findIndex((h) => h === "parent" || h === "parent name");

  const toTsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

  if (levelCols[0] >= 0) {
    // Shape 1: one row per capability path.
    const rows = lines.slice(firstIdx + 1).filter((l) => l.trim() !== "").map((l) => {
      const cells = splitDelimited(l, delim);
      return [cells[levelCols[0]] ?? "", levelCols[1] >= 0 ? (cells[levelCols[1]] ?? "") : "", levelCols[2] >= 0 ? (cells[levelCols[2]] ?? "") : ""];
    });
    return parseCapabilityPaste(toTsv(rows));
  }

  if (nameCol >= 0 && parentCol >= 0) {
    // Shape 2: adjacency list — resolve each node's ancestor path.
    const parentOf = new Map<string, string>();
    const names: string[] = [];
    for (const l of lines.slice(firstIdx + 1)) {
      if (l.trim() === "") continue;
      const cells = splitDelimited(l, delim);
      const name = cells[nameCol] ?? "";
      if (!name) continue;
      names.push(name);
      const parent = cells[parentCol] ?? "";
      if (parent) parentOf.set(name, parent);
    }
    const known = new Set(names);
    let skippedDeep = 0;
    const rows: string[][] = [];
    for (const name of names) {
      const path = [name];
      let cur = name;
      while (parentOf.has(cur) && known.has(parentOf.get(cur)!) && path.length <= 4) {
        cur = parentOf.get(cur)!;
        path.unshift(cur);
      }
      if (path.length > 3) { skippedDeep += 1; continue; }
      rows.push([path[0] ?? "", path[1] ?? "", path[2] ?? ""]);
    }
    const parsed = parseCapabilityPaste(toTsv(rows));
    return { ...parsed, skippedLines: parsed.skippedLines + skippedDeep };
  }

  return parseCapabilityPaste(text);
}
