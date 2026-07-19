// NOTE: no "server-only" marker — exercised by verification scripts; only route handlers call this in the app.
import PptxGenJS from "pptxgenjs";
import type { ScopedDb } from "@/lib/db/scoped";
import { DISPOSITION_LABELS, HEAT_COLORS, computeHeatBucket, formatScore } from "@/lib/methodology";
import type { Disposition } from "@/lib/methodology";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { loadCapabilityTallies } from "@/lib/capability-heat";
import { GRAND_TOTAL_SECTIONS, formatMoney } from "@/lib/finance";

/**
 * Client-ready PPTX deck (APP-SPEC §7 Phase 5). Neutral Deloitte-style theme
 * (white/black/#86BC25) — the branded template remains an open item (spec §8)
 * and can be applied as a master later.
 */

const BRAND = "86BC25";
const DARK = "1F2937";
const GRAY = "6B7280";

const DISPOSITION_HEX: Record<Disposition, string> = {
  KEEP_AS_IS: "16A34A",
  RETOOL: "2563EB",
  REDESIGN: "F59E0B",
  TERMINATE: "DC2626",
  UNKNOWN: "9CA3AF",
};

export async function buildEngagementDeck(
  db: ScopedDb,
  engagement: { name: string; clientName: string; currency: string },
): Promise<ArrayBuffer> {
  const [apps, thresholds, capability, financeTemplate] = await Promise.all([
    db.application.findMany({
      orderBy: { appNumber: "asc" },
      select: {
        id: true,
        appNumber: true,
        name: true,
        inScope: true,
        isUtilized: true,
        missionCritical: true,
        result: true,
        override: { select: { disposition: true } },
        responses: {
          where: { template: { type: "FINANCE" } },
          select: { answers: { select: { questionId: true, numericValue: true } } },
        },
      },
    }),
    db.thresholdConfig.findFirst(),
    loadCapabilityTallies(db),
    db.surveyTemplate.findFirst({
      where: { type: "FINANCE" },
      select: { questions: { where: { answerKind: "CURRENCY" }, select: { id: true, section: true } } },
    }),
  ]);
  const t = {
    optBv: thresholds?.optBv ?? THRESHOLD_DEFAULTS.optBv,
    optIt: thresholds?.optIt ?? THRESHOLD_DEFAULTS.optIt,
    heatT1: thresholds?.heatT1 ?? THRESHOLD_DEFAULTS.heatT1,
    heatT2: thresholds?.heatT2 ?? THRESHOLD_DEFAULTS.heatT2,
  };

  const finalOf = (app: (typeof apps)[number]): Disposition =>
    ((app.override?.disposition as Disposition | undefined) ??
      (app.result?.computedDisposition as Disposition | undefined) ??
      "UNKNOWN");
  const pool = apps.filter((a) => a.inScope && a.isUtilized);
  const count = (d: Disposition) => pool.filter((a) => finalOf(a) === d).length;
  const nlu = apps.filter((a) => a.inScope && !a.isUtilized).length;

  const sectionByQuestion = new Map((financeTemplate?.questions ?? []).map((q) => [q.id, q.section]));
  const grandTotalOf = (app: (typeof apps)[number]) =>
    app.responses
      .flatMap((r) => r.answers)
      .filter((a) => a.numericValue !== null && GRAND_TOTAL_SECTIONS.has(sectionByQuestion.get(a.questionId) ?? ""))
      .reduce((sum, a) => sum + (a.numericValue ?? 0), 0);

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";

  const addFooter = (slide: PptxGenJS.Slide, title: string) => {
    slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.08, fill: { color: BRAND } });
    slide.addText(title, { x: 0.5, y: 0.25, w: 12, h: 0.5, fontSize: 22, bold: true, color: DARK });
    slide.addText(`${engagement.name} · ${engagement.clientName}`, {
      x: 0.5, y: 7.05, w: 9, h: 0.35, fontSize: 9, color: GRAY,
    });
  };

  // ── Title ──
  {
    const slide = pptx.addSlide();
    slide.addShape("rect", { x: 0, y: 3.4, w: 13.33, h: 0.12, fill: { color: BRAND } });
    slide.addText("Application Portfolio Strategy", { x: 0.8, y: 2.2, w: 11.7, h: 0.9, fontSize: 36, bold: true, color: DARK });
    slide.addText(`${engagement.name} — ${engagement.clientName}`, { x: 0.8, y: 3.7, w: 11.7, h: 0.6, fontSize: 18, color: GRAY });
    slide.addText("Portfolio assessment and 4R disposition analysis", { x: 0.8, y: 4.3, w: 11.7, h: 0.5, fontSize: 12, color: GRAY });
  }

  // ── KPI / 2×2 matrix ──
  {
    const slide = pptx.addSlide();
    addFooter(slide, "Portfolio at a glance");
    const cells: Array<{ label: string; sub: string; value: number; color: string }> = [
      { label: "Re-Design", sub: "Low BV · High IT", value: count("REDESIGN"), color: DISPOSITION_HEX.REDESIGN },
      { label: "Keep-As-Is", sub: "High BV · High IT", value: count("KEEP_AS_IS"), color: DISPOSITION_HEX.KEEP_AS_IS },
      { label: "Terminate + NLU", sub: "Low BV · Low IT", value: count("TERMINATE") + nlu, color: DISPOSITION_HEX.TERMINATE },
      { label: "Re-Tool", sub: "High BV · Low IT", value: count("RETOOL"), color: DISPOSITION_HEX.RETOOL },
    ];
    cells.forEach((cell, i) => {
      const x = 0.7 + (i % 2) * 6.1;
      const y = 1.2 + Math.floor(i / 2) * 2.5;
      slide.addShape("roundRect", { x, y, w: 5.7, h: 2.2, fill: { color: "FFFFFF" }, line: { color: "E5E7EB" }, rectRadius: 0.08 });
      slide.addText(String(cell.value), { x: x + 0.3, y: y + 0.25, w: 2, h: 1, fontSize: 44, bold: true, color: cell.color });
      slide.addText(cell.label, { x: x + 0.3, y: y + 1.3, w: 5, h: 0.4, fontSize: 16, bold: true, color: DARK });
      slide.addText(cell.sub, { x: x + 0.3, y: y + 1.7, w: 5, h: 0.35, fontSize: 11, color: GRAY });
    });
    slide.addText(
      `${apps.length} applications catalogued · ${pool.length} in scope and utilized · ${count("UNKNOWN")} unscored · ${pool.filter((a) => a.missionCritical).length} mission-critical`,
      { x: 0.7, y: 6.4, w: 12, h: 0.4, fontSize: 12, color: GRAY },
    );
  }

  // ── 4R scatter ──
  {
    const slide = pptx.addSlide();
    addFooter(slide, "4R Framework — Business Value × IT Health");
    const px = 3.2, py = 1.1, pw = 7, ph = 5.4;
    slide.addShape("rect", { x: px, y: py, w: pw, h: ph, fill: { color: "FFFFFF" }, line: { color: "D1D5DB" } });
    const xAt = (bv: number) => px + (bv / 5) * pw;
    const yAt = (it: number) => py + (1 - it / 5) * ph;
    slide.addShape("line", { x: xAt(t.optBv), y: py, w: 0, h: ph, line: { color: BRAND, dashType: "dash", width: 1.5 } });
    slide.addShape("line", { x: px, y: yAt(t.optIt), w: pw, h: 0, line: { color: BRAND, dashType: "dash", width: 1.5 } });
    const corners: Array<[string, number, number]> = [
      ["Re-Design", px + 0.15, py + 0.15],
      ["Keep-As-Is", px + pw - 1.5, py + 0.15],
      ["Terminate", px + 0.15, py + ph - 0.45],
      ["Re-Tool", px + pw - 1.5, py + ph - 0.45],
    ];
    for (const [label, x, y] of corners) slide.addText(label, { x, y, w: 1.6, h: 0.3, fontSize: 10, color: GRAY });
    for (const app of pool) {
      const d = finalOf(app);
      if (d === "UNKNOWN") continue;
      const bv = app.result?.bvScore ?? 0;
      const it = app.result?.itScore ?? 0;
      slide.addShape("ellipse", {
        x: xAt(bv) - 0.07, y: yAt(it) - 0.07, w: 0.14, h: 0.14,
        fill: { color: DISPOSITION_HEX[d] }, line: { color: "FFFFFF", width: 0.75 },
      });
    }
    slide.addText("Business Score →", { x: px + pw / 2 - 1, y: py + ph + 0.1, w: 2.4, h: 0.3, fontSize: 10, color: GRAY });
    slide.addText("IT Score →", { x: px - 1.15, y: py + ph / 2 - 0.15, w: 1, h: 0.3, fontSize: 10, color: GRAY, rotate: 270 });
  }

  // ── Heat map ──
  {
    const slide = pptx.addSlide();
    addFooter(slide, "Capability heat map");
    const l1s = capability.nodes.filter((n) => n.level === "L1").slice(0, 14);
    const childrenOf = (id: string) => capability.nodes.filter((n) => n.parentId === id);
    const maxRows = Math.max(1, ...l1s.map((l1) => childrenOf(l1.id).length));
    const rows: PptxGenJS.TableRow[] = [];
    rows.push(
      l1s.map((l1) => ({
        text: l1.name,
        options: { fill: { color: DARK }, color: "FFFFFF", bold: true, fontSize: 9, align: "center" as const },
      })),
    );
    for (let r = 0; r < maxRows; r++) {
      rows.push(
        l1s.map((l1) => {
          const l2 = childrenOf(l1.id)[r];
          if (!l2) return { text: "", options: { fill: { color: "FFFFFF" } } };
          const tally = capability.tallyOf(l2.id);
          const bucket = computeHeatBucket(
            { appCount: tally.known, terminateCount: tally.terminate, retoolRedesignCount: tally.retool + tally.redesign },
            { t1: t.heatT1, t2: t.heatT2 },
          );
          const fill = bucket ? HEAT_COLORS[bucket].replace("#", "") : "FFFFFF";
          const color = bucket === "RETOOL_REDESIGN" || bucket === null ? "111111" : "FFFFFF";
          return { text: l2.name, options: { fill: { color: fill }, color, fontSize: 8, align: "center" as const } };
        }),
      );
    }
    slide.addTable(rows, { x: 0.4, y: 1.1, w: 12.5, colW: Array(l1s.length).fill(12.5 / l1s.length), border: { pt: 0.5, color: "E5E7EB" } });
    slide.addText(
      `Red: > ${Math.round(t.heatT1 * 100)}% terminate · Yellow: re-tool/re-design above ${Math.round((t.heatT2 - t.heatT1) * 100)}% · Green: retain · White: no scored applications`,
      { x: 0.4, y: 6.6, w: 12.5, h: 0.35, fontSize: 10, color: GRAY },
    );
  }

  // ── Disposition detail table ──
  {
    const slide = pptx.addSlide();
    addFooter(slide, "Disposition detail");
    const rows: PptxGenJS.TableRow[] = [
      ["#", "Application", "BV", "IT", "Disposition", "Annual cost"].map((h) => ({
        text: h,
        options: { fill: { color: DARK }, color: "FFFFFF", bold: true, fontSize: 10 },
      })),
    ];
    const ordered = [...pool].sort((a, b) => (finalOf(a) === "TERMINATE" ? -1 : 1) - (finalOf(b) === "TERMINATE" ? -1 : 1));
    for (const app of ordered.slice(0, 18)) {
      const d = finalOf(app);
      const cost = grandTotalOf(app);
      rows.push([
        { text: String(app.appNumber), options: { fontSize: 9 } },
        { text: app.name, options: { fontSize: 9 } },
        { text: formatScore(app.result?.bvScore ?? null), options: { fontSize: 9, align: "right" as const } },
        { text: formatScore(app.result?.itScore ?? null), options: { fontSize: 9, align: "right" as const } },
        { text: DISPOSITION_LABELS[d], options: { fontSize: 9, color: DISPOSITION_HEX[d], bold: true } },
        { text: cost > 0 ? formatMoney(cost, engagement.currency) : "—", options: { fontSize: 9, align: "right" as const } },
      ]);
    }
    slide.addTable(rows, { x: 0.5, y: 1.1, w: 12.3, colW: [0.6, 5.2, 1, 1, 2.3, 2.2], border: { pt: 0.5, color: "E5E7EB" } });
  }

  // ── Financial summary ──
  {
    const slide = pptx.addSlide();
    addFooter(slide, "Financial summary");
    const costed = apps.filter((a) => grandTotalOf(a) > 0);
    const total = costed.reduce((s, a) => s + grandTotalOf(a), 0);
    const byDisposition = (d: Disposition) =>
      costed.filter((a) => finalOf(a) === d).reduce((s, a) => s + grandTotalOf(a), 0);
    const nluCost = costed.filter((a) => a.inScope && !a.isUtilized).reduce((s, a) => s + grandTotalOf(a), 0);
    const lines: Array<[string, number, string]> = [
      ["Total annual cost (costed applications)", total, DARK],
      ["Terminate + No-Longer-Utilized (savings candidate)", byDisposition("TERMINATE") + nluCost, DISPOSITION_HEX.TERMINATE],
      ["Re-Tool / Re-Design (investment candidates)", byDisposition("RETOOL") + byDisposition("REDESIGN"), DISPOSITION_HEX.REDESIGN],
      ["Keep-As-Is (run cost)", byDisposition("KEEP_AS_IS"), DISPOSITION_HEX.KEEP_AS_IS],
    ];
    lines.forEach(([label, value, color], i) => {
      slide.addText(formatMoney(value, engagement.currency), { x: 0.8, y: 1.3 + i * 1.2, w: 4, h: 0.7, fontSize: 28, bold: true, color });
      slide.addText(label, { x: 5, y: 1.45 + i * 1.2, w: 7.5, h: 0.5, fontSize: 13, color: DARK });
    });
    slide.addText("Costs are context only — never an input to the disposition (methodology-faithful).", {
      x: 0.8, y: 6.4, w: 12, h: 0.4, fontSize: 10, italic: true, color: GRAY,
    });
  }

  return (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
}
