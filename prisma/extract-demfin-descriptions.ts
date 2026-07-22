/**
 * One-off extraction: pull the per-item DESCRIPTION (column B) for the
 * Demographics and Finance sheets of excelapp.xlsm and merge it into
 * prisma/seed-data/demographics-finance.json (which previously carried only
 * row/section/name). Column A is the item name — we re-read it and assert it
 * matches the stored `name`, so a row shift can't silently mis-map descriptions.
 *
 * Reads the workbook with a targeted zip + sheet-XML scan (same approach as
 * src/lib/legacy-import.ts) because exceljs OOMs on the wide formula sheets.
 *
 * Run from AppPortStrat/:  NODE_OPTIONS=--conditions=react-server npx tsx prisma/extract-demfin-descriptions.ts
 * Local only — reads a file, rewrites the JSON. No database access.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";

const WORKBOOK = join(__dirname, "..", "..", "excelapp.xlsm");
const JSON_PATH = join(__dirname, "seed-data", "demographics-finance.json");
const SHEETS = ["Demographics", "Finance"] as const;

type Primitive = string | number | boolean;
interface FieldRow {
  row: number;
  section: string;
  name: string;
  description?: string | null;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function colToNumber(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

async function loadSheets(): Promise<Map<string, Map<string, Primitive>>> {
  const zip = await JSZip.loadAsync(readFileSync(WORKBOOK));
  const read = (name: string) => zip.file(name)?.async("string");

  const workbookXml = (await read("xl/workbook.xml")) ?? "";
  const relsXml = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
    const t = m[2].replace(/^\//, "");
    relTargets.set(m[1], t.startsWith("xl/") ? t : `xl/${t}`);
  }
  const sheetParts = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const name = decodeXml(m[1]);
    const target = relTargets.get(m[2]);
    if (target && (SHEETS as readonly string[]).includes(name)) sheetParts.set(name, target);
  }

  const sharedXml = (await read("xl/sharedStrings.xml")) ?? "";
  const shared: string[] = [];
  for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]));
    shared.push(texts.join(""));
  }

  const sheets = new Map<string, Map<string, Primitive>>();
  const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const [name, part] of sheetParts) {
    const xml = (await read(part)) ?? "";
    const cells = new Map<string, Primitive>();
    for (const m of xml.matchAll(CELL_RE)) {
      const inner = m[2];
      if (!inner) continue;
      const ref = m[1].match(/r="([A-Z]{1,3})(\d+)"/);
      if (!ref) continue;
      const type = m[1].match(/t="(\w+)"/)?.[1];
      const v = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
      const inline = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      let value: Primitive | null = null;
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === "str" && v !== undefined) value = decodeXml(v);
      else if (type === "inlineStr" && inline !== undefined) value = decodeXml(inline);
      else if (v !== undefined) value = Number(v);
      if (value === null) continue;
      cells.set(`${ref[1]}${ref[2]}`, value); // key by A1-style ref
    }
    sheets.set(name, cells);
  }
  return sheets;
}

async function main(): Promise<void> {
  const sheets = await loadSheets();
  for (const s of SHEETS) {
    if (!sheets.has(s)) throw new Error(`Sheet "${s}" not found in workbook`);
  }

  const data: { demographics: FieldRow[]; finance: FieldRow[] } = JSON.parse(readFileSync(JSON_PATH, "utf8"));
  const groups: Array<{ sheet: (typeof SHEETS)[number]; rows: FieldRow[] }> = [
    { sheet: "Demographics", rows: data.demographics },
    { sheet: "Finance", rows: data.finance },
  ];

  let withDesc = 0;
  let empty = 0;
  const mismatches: string[] = [];
  const samples: string[] = [];

  for (const { sheet, rows } of groups) {
    const cells = sheets.get(sheet)!;
    for (const r of rows) {
      const nameCell = cells.get(`A${r.row}`);
      const descCell = cells.get(`B${r.row}`);
      // Alignment guard: column A must still match the stored name.
      if (nameCell != null && String(nameCell).trim() !== r.name.trim()) {
        mismatches.push(`${sheet}!A${r.row}: json="${r.name}" vs xlsx="${String(nameCell).trim()}"`);
      }
      const desc = descCell == null ? null : String(descCell).trim() || null;
      r.description = desc;
      if (desc) {
        withDesc++;
        if (samples.length < 8) samples.push(`  ${sheet}!B${r.row} [${r.name}] → ${desc.slice(0, 80)}`);
      } else {
        empty++;
      }
    }
  }

  console.log(`Demographics rows: ${data.demographics.length} | Finance rows: ${data.finance.length}`);
  console.log(`Descriptions found: ${withDesc} | empty: ${empty}`);
  console.log(`Column-A alignment mismatches: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 15)) console.log(`  ! ${m}`);
  console.log("Samples:");
  for (const s of samples) console.log(s);

  if (mismatches.length > 0) {
    throw new Error(`Aborting write: ${mismatches.length} column-A mismatches — rows may have shifted; investigate before merging.`);
  }
  if (withDesc === 0) {
    throw new Error("Aborting write: no descriptions found in column B — wrong column/sheet?");
  }

  writeFileSync(JSON_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nWROTE ${JSON_PATH} (${withDesc} descriptions merged)`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
