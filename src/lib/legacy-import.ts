// NOTE: no "server-only" marker — the parser is also exercised by local
// verification scripts. It is only ever CALLED from server actions.
import { RATING_VALUES, UNASSIGNED } from "@/lib/methodology";
import type { ScopedDb, EngagementContext } from "@/lib/db/scoped";

/**
 * Legacy APS v5.0 workbook importer (APP-SPEC §4.12). Reads CACHED values
 * only — formulas are never evaluated. Cell addresses come from the verified
 * inventory; survey answers are mapped through each question's legacyRef
 * ("IT!row10"), the provenance stamped at seed time exactly for this purpose.
 *
 * Parsing is a targeted zip + sheet-XML extractor rather than a full
 * spreadsheet library: the workbook's survey tabs carry ~1,000 pre-filled
 * formula columns, which blow up any full in-memory workbook model (exceljs
 * OOMs at 4 GB on this very file). We only ever need specific cells from
 * eleven known sheets.
 */

type Primitive = string | number | boolean;

class SheetCells {
  private cells = new Map<string, Primitive>();
  set(row: number, col: number, value: Primitive) {
    this.cells.set(`${row}:${col}`, value);
  }
  get(row: number, col: number): Primitive | null {
    return this.cells.get(`${row}:${col}`) ?? null;
  }
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
function decodeXml(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m]).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function colToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const NEEDED_SHEETS = new Set([
  "Master Data View",
  "Filtering Control Panel",
  "Capability Map",
  "Weightings Control Panel",
  "Disposition Control Panel",
  "Heat Map",
  "IT",
  "Business",
  "Demographics",
  "Finance",
  "Financial Data",
]);

// Decompression-bomb guards (security review). A 30 MB ZIP can inflate to
// gigabytes. The ZIP central directory records each entry's uncompressed size,
// but that value is ATTACKER-CONTROLLED metadata — a crafted archive can
// under-declare it. So the declared size is only a cheap fast-reject; the real
// enforcement counts actual bytes DURING inflation (see inflateBounded) and
// aborts the moment a per-entry or running-total budget is exceeded, so an
// over-budget stream is never fully materialized.
const MAX_TOTAL_UNCOMPRESSED = 300 * 1024 * 1024; // 300 MB across all entries
const MAX_ENTRY_UNCOMPRESSED = 80 * 1024 * 1024; // 80 MB per entry

/** Uncompressed size from the central directory, or null if unavailable. */
function uncompressedSize(file: unknown): number | null {
  const data = (file as { _data?: { uncompressedSize?: number } } | null)?._data;
  return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : null;
}

/** Minimal shape of the chunked stream JSZip's nodeStream returns. */
interface ByteStream {
  on(event: "data", cb: (chunk: Uint8Array) => void): ByteStream;
  on(event: "error", cb: (err: unknown) => void): ByteStream;
  on(event: "end", cb: () => void): ByteStream;
  pause(): void;
  resume(): void;
}

/**
 * Inflate one entry, counting real bytes and aborting past `maxBytes` — so a
 * lying central-directory size cannot get a multi-GB stream materialized. Also
 * decrements a shared running-total budget across entries.
 */
function inflateBounded(
  file: { nodeStream(type: "nodebuffer"): ByteStream },
  name: string,
  maxBytes: number,
  budget: { remaining: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    let aborted = false;
    const stream = file.nodeStream("nodebuffer");
    stream
      .on("data", (chunk) => {
        if (aborted) return;
        entryBytes += chunk.length;
        budget.remaining -= chunk.length;
        if (entryBytes > maxBytes || budget.remaining < 0) {
          aborted = true;
          stream.pause();
          reject(
            new Error(
              `Workbook part "${name}" is too large when decompressed — refusing to import (possible decompression bomb)`,
            ),
          );
          return;
        }
        chunks.push(chunk);
      })
      .on("error", (err) => {
        if (!aborted) reject(err instanceof Error ? err : new Error(String(err)));
      })
      .on("end", () => {
        if (!aborted) resolve(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"));
      });
  });
}

async function loadLegacySheets(buffer: ArrayBuffer): Promise<Map<string, SheetCells>> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);

  // Cheap fast-reject on DECLARED sizes (catches honest bombs before any
  // inflation). Real enforcement is byte-counted during inflation below.
  let declaredTotal = 0;
  for (const name of Object.keys(zip.files)) {
    declaredTotal += uncompressedSize(zip.files[name]) ?? 0;
  }
  if (declaredTotal > MAX_TOTAL_UNCOMPRESSED) {
    throw new Error("Workbook is too large when decompressed — refusing to import (possible decompression bomb)");
  }

  const budget = { remaining: MAX_TOTAL_UNCOMPRESSED };
  const read = async (name: string): Promise<string | undefined> => {
    const file = zip.file(name);
    if (!file) return undefined;
    return inflateBounded(file as unknown as { nodeStream(t: "nodebuffer"): ByteStream }, name, MAX_ENTRY_UNCOMPRESSED, budget);
  };

  // Sheet name → worksheet part path (workbook.xml + its rels).
  const workbookXml = await read("xl/workbook.xml");
  const relsXml = await read("xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) throw new Error("Not a valid .xlsx/.xlsm workbook");
  const relTargets = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)) {
    relTargets.set(m[1], m[2].replace(/^\//, "").startsWith("xl/") ? m[2].replace(/^\//, "") : `xl/${m[2]}`);
  }
  const sheetParts = new Map<string, string>();
  for (const m of workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
    const target = relTargets.get(m[2]);
    if (target && NEEDED_SHEETS.has(decodeXml(m[1]))) sheetParts.set(decodeXml(m[1]), target);
  }

  // Shared strings.
  const sharedXml = (await read("xl/sharedStrings.xml")) ?? "";
  const shared: string[] = [];
  for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]));
    shared.push(texts.join(""));
  }

  const sheets = new Map<string, SheetCells>();
  const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  for (const [name, part] of sheetParts) {
    const xml = await read(part);
    if (!xml) continue;
    const cells = new SheetCells();
    for (const m of xml.matchAll(CELL_RE)) {
      const attrs = m[1];
      const inner = m[2];
      if (!inner) continue;
      const ref = attrs.match(/r="([A-Z]{1,3})(\d+)"/);
      if (!ref) continue;
      const type = attrs.match(/t="(\w+)"/)?.[1];
      const v = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1];
      const inline = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      let value: Primitive | null = null;
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? null;
      else if (type === "b" && v !== undefined) value = v === "1";
      else if (type === "str" && v !== undefined) value = decodeXml(v);
      else if (type === "inlineStr" && inline !== undefined) value = decodeXml(inline);
      else if (v !== undefined) value = Number(v);
      if (value === null || (typeof value === "number" && !Number.isFinite(value))) continue;
      cells.set(Number(ref[2]), colToNumber(ref[1]), value);
    }
    sheets.set(name, cells);
  }
  return sheets;
}

function cellVal(ws: SheetCells, row: number, col: number): string | number | boolean | null {
  return ws.get(row, col);
}

function asText(v: string | number | boolean | null): string | null {
  if (v === null) return null;
  const text = String(v).trim();
  return text === "" ? null : text;
}

function yesNo(v: string | number | boolean | null): boolean | null {
  const text = asText(v)?.toLowerCase();
  if (!text) return null;
  if (["y", "yes", "true", "1"].includes(text)) return true;
  if (["n", "no", "false", "0"].includes(text)) return false;
  return null;
}

/** Weightings Control Panel rows, in question orderIndex order (inventory §3.1). */
const BV_WEIGHT_ROWS = [17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 29];
const IT_WEIGHT_ROWS = [33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 49, 50, 51, 54, 55, 56, 57, 58, 59, 60];

export interface LegacyParseResult {
  applications: Array<{
    appNumber: number;
    name: string;
    acronym: string | null;
    description: string | null;
    applicationType: string | null;
    businessFunctionDetail: string | null;
    target: string | null;
    meetsFutureState: "YES" | "NO" | "PARTIAL" | null;
    actionPlanAssignment: string | null;
    actionPlanJustification: string | null;
    missionCritical: boolean;
    comments: string | null;
    inScope: boolean;
    isUtilized: boolean;
    isReplaced: boolean;
    inFlight: boolean;
    l0: string | null;
    l1: string | null;
    l2: string | null;
  }>;
  capabilityRows: Array<{ l0: string; l1: string; l2: string | null }>;
  /** question code → importance rating 0–5 */
  ratings: Map<string, number>;
  thresholds: { optBv: number; urgBv: number; optIt: number; urgIt: number; heatT1: number; heatT2: number } | null;
  /** appNumber → (question code → raw value) */
  answers: Map<number, Map<string, string | number | boolean>>;
  costRows: Array<{ appNumber: number; fiscalYear: string; versionType: "ACTUAL" | "BUDGET" | "FORECAST"; category: string; amount: number }>;
  warnings: string[];
}

export async function parseLegacyWorkbook(
  buffer: ArrayBuffer,
  questionRefs: Array<{ code: string; legacyRef: string | null; answerKind: string }>,
): Promise<LegacyParseResult> {
  const sheets = await loadLegacySheets(buffer);
  const warnings: string[] = [];
  const sheet = (name: string) => sheets.get(name);

  // ── Applications (Master Data View rows 13+, inventory §2.1) ──
  const mdv = sheet("Master Data View");
  if (!mdv) throw new Error('Sheet "Master Data View" not found — is this an APS v5.0 workbook?');
  const fcp = sheet("Filtering Control Panel");
  const flagsByApp = new Map<number, { inScope: boolean; isUtilized: boolean; isReplaced: boolean; inFlight: boolean }>();
  if (fcp) {
    for (let row = 13; row <= 1100; row++) {
      const id = cellVal(fcp, row, 1);
      if (typeof id !== "number") continue;
      flagsByApp.set(id, {
        inScope: yesNo(cellVal(fcp, row, 19)) ?? true,
        isUtilized: yesNo(cellVal(fcp, row, 20)) ?? true,
        isReplaced: yesNo(cellVal(fcp, row, 21)) ?? false,
        inFlight: yesNo(cellVal(fcp, row, 22)) ?? false,
      });
    }
  }

  const applications: LegacyParseResult["applications"] = [];
  for (let row = 13; row <= 1100; row++) {
    const id = cellVal(mdv, row, 1);
    const name = asText(cellVal(mdv, row, 2));
    if (typeof id !== "number" || !name) continue;
    const meets = asText(cellVal(mdv, row, 13))?.toUpperCase();
    const flags = flagsByApp.get(id);
    applications.push({
      appNumber: id,
      name,
      acronym: asText(cellVal(mdv, row, 3)),
      description: asText(cellVal(mdv, row, 4)),
      applicationType: asText(cellVal(mdv, row, 5)),
      comments: asText(cellVal(mdv, row, 6)),
      l0: asText(cellVal(mdv, row, 7)),
      l1: asText(cellVal(mdv, row, 8)),
      l2: asText(cellVal(mdv, row, 9)),
      businessFunctionDetail: asText(cellVal(mdv, row, 10)),
      target: asText(cellVal(mdv, row, 12)),
      meetsFutureState: meets === "Y" ? "YES" : meets === "N" ? "NO" : meets === "PARTIAL" ? "PARTIAL" : null,
      actionPlanAssignment: asText(cellVal(mdv, row, 14)),
      actionPlanJustification: asText(cellVal(mdv, row, 15)),
      missionCritical: yesNo(cellVal(mdv, row, 21)) ?? false,
      inScope: flags?.inScope ?? true,
      isUtilized: flags?.isUtilized ?? true,
      isReplaced: flags?.isReplaced ?? false,
      inFlight: flags?.inFlight ?? false,
    });
  }

  // ── Capability model (Capability Map A:C from row 8, inventory §2.3) ──
  const capabilityRows: LegacyParseResult["capabilityRows"] = [];
  const capSheet = sheet("Capability Map");
  if (capSheet) {
    for (let row = 8; row <= 2200; row++) {
      const l0 = asText(cellVal(capSheet, row, 1));
      const l1 = asText(cellVal(capSheet, row, 2));
      const l2 = asText(cellVal(capSheet, row, 3));
      if (!l0 && !l1 && !l2) continue;
      if (l0?.toLowerCase().includes("l0 capability")) continue; // header row
      capabilityRows.push({
        l0: l0 && !l0.startsWith("Level L0") ? l0 : UNASSIGNED,
        l1: l1 && !l1.startsWith("Level L1") ? l1 : UNASSIGNED,
        l2,
      });
    }
  } else {
    warnings.push('Sheet "Capability Map" not found — capability model skipped');
  }

  // Some copies clear the entry table after the VBA refresh; the model then
  // lives in the derived relation tables (P/Q = L0→L1, S/T = L1→L2, data
  // from row 3 — inventory §2.3). Apps' own MDV triples are the final
  // fallback, handled at apply time.
  if (capabilityRows.length === 0 && capSheet) {
    const l0ByL1 = new Map<string, string>();
    for (let row = 3; row <= 2200; row++) {
      const l0 = asText(cellVal(capSheet, row, 16));
      const l1 = asText(cellVal(capSheet, row, 17));
      if (l0 && l1) {
        l0ByL1.set(l1, l0);
        capabilityRows.push({ l0, l1, l2: null });
      }
    }
    for (let row = 3; row <= 2200; row++) {
      const l1 = asText(cellVal(capSheet, row, 19));
      const l2 = asText(cellVal(capSheet, row, 20));
      if (l1 && l2) capabilityRows.push({ l0: l0ByL1.get(l1) ?? UNASSIGNED, l1, l2 });
    }
  }

  // ── Weightings (labels → Ratings2 values, inventory §3.1) ──
  const ratings = new Map<string, number>();
  const wcp = sheet("Weightings Control Panel");
  const bvCodes = questionRefs.filter((q) => q.code.startsWith("BV_")).map((q) => q.code);
  const itCodes = questionRefs.filter((q) => q.code.startsWith("IT_") && !q.code.startsWith("IT_NR_")).map((q) => q.code);
  const nrCodes = questionRefs.filter((q) => q.code.startsWith("IT_NR_")).map((q) => q.code);
  const labelToRating = (v: string | number | boolean | null): number | null => {
    const label = asText(v);
    if (!label) return null;
    return (RATING_VALUES as Record<string, number>)[label] ?? null;
  };
  if (wcp) {
    BV_WEIGHT_ROWS.forEach((row, i) => {
      const rating = labelToRating(cellVal(wcp, row, 11));
      if (rating !== null && bvCodes[i]) ratings.set(bvCodes[i], rating);
    });
    IT_WEIGHT_ROWS.forEach((row, i) => {
      const rating = labelToRating(cellVal(wcp, row, 11));
      if (rating !== null && itCodes[i]) ratings.set(itCodes[i], rating);
    });
  } else {
    warnings.push('Sheet "Weightings Control Panel" not found — weightings skipped');
  }
  const itSheetForNr = sheet("IT");
  if (itSheetForNr) {
    [46, 47, 48, 49].forEach((row, i) => {
      const rating = labelToRating(cellVal(itSheetForNr, row, 8));
      if (rating !== null && nrCodes[i]) ratings.set(nrCodes[i], rating);
    });
  }

  // ── Thresholds (DCP E7:H7; Heat Map J1/J3, inventory §4/§6) ──
  let thresholds: LegacyParseResult["thresholds"] = null;
  const dcp = sheet("Disposition Control Panel");
  const heatSheet = sheet("Heat Map");
  if (dcp) {
    const n = (v: string | number | boolean | null, fallback: number) => (typeof v === "number" ? v : fallback);
    thresholds = {
      optBv: n(cellVal(dcp, 7, 5), 3),
      urgBv: n(cellVal(dcp, 7, 6), 2),
      optIt: n(cellVal(dcp, 7, 7), 3),
      urgIt: n(cellVal(dcp, 7, 8), 2),
      heatT1: heatSheet ? n(cellVal(heatSheet, 1, 10), 0.1) : 0.1,
      heatT2: heatSheet ? n(cellVal(heatSheet, 3, 10), 0.26) : 0.26,
    };
  }

  // ── Survey answers via legacyRef (transposed sheets, inventory §2.2) ──
  const answers = new Map<number, Map<string, string | number | boolean>>();
  const SHEET_LAYOUT: Record<string, { idRow: number; firstCol: number }> = {
    IT: { idRow: 4, firstCol: 10 }, // J4..
    Business: { idRow: 4, firstCol: 10 },
    Demographics: { idRow: 6, firstCol: 3 }, // C6..
    Finance: { idRow: 4, firstCol: 4 }, // D4..
  };
  const refsBySheet = new Map<string, Array<{ code: string; row: number }>>();
  for (const q of questionRefs) {
    const match = q.legacyRef?.match(/^(\w+)!row(\d+)$/);
    if (!match) continue;
    const list = refsBySheet.get(match[1]) ?? [];
    list.push({ code: q.code, row: Number(match[2]) });
    refsBySheet.set(match[1], list);
  }
  for (const [sheetName, refs] of refsBySheet) {
    const ws = sheet(sheetName);
    const layout = SHEET_LAYOUT[sheetName];
    if (!ws || !layout) continue;
    for (let col = layout.firstCol; col <= 1100; col++) {
      const appId = cellVal(ws, layout.idRow, col);
      if (typeof appId !== "number" || appId <= 0) break;
      for (const ref of refs) {
        const raw = cellVal(ws, ref.row, col);
        if (raw === null || asText(raw) === null) continue;
        const perApp = answers.get(appId) ?? new Map<string, string | number | boolean>();
        perApp.set(ref.code, raw);
        answers.set(appId, perApp);
      }
    }
  }

  // ── Financial Data → cost records (category totals, inventory §2.4) ──
  const costRows: LegacyParseResult["costRows"] = [];
  const finData = sheet("Financial Data");
  if (finData) {
    const CATEGORY_COLS: Array<[number, string]> = [
      [5, "Infrastructure"],
      [12, "Application Maintenance"],
      [18, "Application Development"],
      [24, "Commercial Software"],
    ];
    for (let row = 2; row <= 2000; row++) {
      const appId = cellVal(finData, row, 1);
      const version = asText(cellVal(finData, row, 4));
      if (typeof appId !== "number" || !version) continue;
      const match = version.match(/^(\w+?)[_\s-](ACTUAL|BUDGET|FORECAST)$/i);
      if (!match) continue;
      for (const [col, category] of CATEGORY_COLS) {
        const amount = cellVal(finData, row, col);
        if (typeof amount === "number" && amount !== 0) {
          costRows.push({
            appNumber: appId,
            fiscalYear: match[1].toUpperCase(),
            versionType: match[2].toUpperCase() as "ACTUAL" | "BUDGET" | "FORECAST",
            category,
            amount,
          });
        }
      }
    }
  }

  return { applications, capabilityRows, ratings, thresholds, answers, costRows, warnings };
}

/** Apply a parsed legacy workbook to an EMPTY engagement. */
export async function applyLegacyImport(
  ctx: EngagementContext,
  db: ScopedDb,
  parsed: LegacyParseResult,
): Promise<{ applications: number; capabilities: number; answers: number; costRows: number }> {
  const existing = await db.application.count();
  if (existing > 0) {
    throw new Error("Legacy import requires an empty engagement (no applications yet)");
  }

  // 1. Capability tree (dedup per parent; placeholders marked).
  const nodeIds = new Map<string, string>(); // "L0|L1|L2" path → id
  const ensureNode = async (level: "L0" | "L1" | "L2", name: string, parentPath: string | null): Promise<string> => {
    const path = parentPath ? `${parentPath}>${name}` : name;
    const cached = nodeIds.get(path);
    if (cached) return cached;
    const parentId = parentPath ? nodeIds.get(parentPath)! : null;
    const found = await db.capabilityNode.findFirst({ where: { level, name, parentId } });
    const id =
      found?.id ??
      (
        await db.capabilityNode.create({
          data: { engagementId: ctx.engagementId, level, name, parentId, isPlaceholder: name === UNASSIGNED },
        })
      ).id;
    nodeIds.set(path, id);
    return id;
  };
  for (const row of parsed.capabilityRows) {
    await ensureNode("L0", row.l0, null);
    await ensureNode("L1", row.l1, row.l0);
    if (row.l2) await ensureNode("L2", row.l2, `${row.l0}>${row.l1}`);
  }

  // 2. Applications. Capability nodes are created from each app's own MDV
  //    L0/L1/L2 triple when missing — copies with a cleared Capability Map
  //    sheet still carry the model on the MDV rows.
  const appIdByNumber = new Map<number, string>();
  for (const app of parsed.applications) {
    const { l0, l1, l2, ...fields } = app;
    let capabilityNodeId: string | null = null;
    if (l0 || l1 || l2) {
      const l0Name = l0 ?? UNASSIGNED;
      const l1Name = l1 ?? UNASSIGNED;
      await ensureNode("L0", l0Name, null);
      await ensureNode("L1", l1Name, l0Name);
      if (l2) await ensureNode("L2", l2, `${l0Name}>${l1Name}`);
      capabilityNodeId = nodeIds.get([l0Name, l1Name, l2].filter(Boolean).join(">")) ?? null;
    }
    const created = await db.application.create({
      data: { ...fields, engagementId: ctx.engagementId, capabilityNodeId },
    });
    appIdByNumber.set(app.appNumber, created.id);
  }

  // 3. Weightings + thresholds.
  if (parsed.ratings.size > 0) {
    const weightings = await db.questionWeighting.findMany({
      select: { id: true, question: { select: { code: true } } },
    });
    for (const w of weightings) {
      const rating = parsed.ratings.get(w.question.code);
      if (rating !== undefined) {
        await db.questionWeighting.update({ where: { id: w.id }, data: { importanceRating: rating } });
      }
    }
  }
  if (parsed.thresholds) {
    await db.thresholdConfig.upsert({
      where: { engagementId: ctx.engagementId },
      create: { engagementId: ctx.engagementId, ...parsed.thresholds },
      update: parsed.thresholds,
    });
  }

  // 4. Survey answers (validated per kind; unknown values skipped).
  const templates = await db.surveyTemplate.findMany({
    include: { questions: { select: { id: true, code: true, answerKind: true } } },
  });
  const questionByCode = new Map(
    templates.flatMap((t) => t.questions.map((q) => [q.code, { ...q, templateId: t.id }] as const)),
  );
  const { validateAnswer } = await import("@/lib/methodology");
  let answerCount = 0;
  for (const [appNumber, byCode] of parsed.answers) {
    const applicationId = appIdByNumber.get(appNumber);
    if (!applicationId) continue;
    const byTemplate = new Map<string, Array<{ questionId: string; value: ReturnType<typeof validateAnswer> }>>();
    for (const [code, raw] of byCode) {
      const question = questionByCode.get(code);
      if (!question) continue;
      let input: unknown = raw;
      if (question.answerKind === "BOOLEAN" && typeof raw === "string") {
        const b = yesNo(raw);
        if (b === null) continue;
        input = b;
      }
      if (question.answerKind === "SCORE_1_5" && typeof raw === "string") {
        input = raw.trim().toUpperCase() === "N/A" ? "NA" : Number(raw);
      }
      if ((question.answerKind === "NUMBER" || question.answerKind === "CURRENCY") && typeof raw === "string") {
        const n = Number(raw.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(n)) continue;
        input = n;
      }
      if (question.answerKind === "TEXT" || question.answerKind === "OPTION" || question.answerKind === "DATE") {
        input = String(raw);
      }
      const validated = validateAnswer({ answerKind: question.answerKind as never }, input);
      if (!validated.ok) continue;
      const list = byTemplate.get(question.templateId) ?? [];
      list.push({ questionId: question.id, value: validated });
      byTemplate.set(question.templateId, list);
    }
    for (const [templateId, entries] of byTemplate) {
      const response = await db.surveyResponse.create({
        data: { engagementId: ctx.engagementId, applicationId, templateId, status: "IN_PROGRESS" },
      });
      await db.answer.createMany({
        data: entries.map((e) => {
          const v = e.value.ok ? e.value.value : { isNA: false };
          return {
            engagementId: ctx.engagementId,
            responseId: response.id,
            questionId: e.questionId,
            isNA: v.isNA,
            numericValue: v.numericValue ?? null,
            textValue: v.textValue ?? null,
            boolValue: v.boolValue ?? null,
          };
        }),
      });
      answerCount += entries.length;
    }
  }

  // 5. Fiscal-year cost records.
  if (parsed.costRows.length > 0) {
    await db.costRecord.createMany({
      data: parsed.costRows
        .filter((r) => appIdByNumber.has(r.appNumber))
        .map((r) => ({
          engagementId: ctx.engagementId,
          applicationId: appIdByNumber.get(r.appNumber)!,
          fiscalYear: r.fiscalYear,
          versionType: r.versionType,
          category: r.category,
          lineItem: r.category,
          amount: r.amount,
        })),
    });
  }

  return {
    applications: parsed.applications.length,
    capabilities: nodeIds.size,
    answers: answerCount,
    costRows: parsed.costRows.length,
  };
}
