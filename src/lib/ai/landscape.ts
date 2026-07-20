// NOTE: no "server-only" marker — the pure prompt builder is unit-tested; only server code imports this.
import type { ScopedDb } from "@/lib/db/scoped";
import type { Disposition } from "@/lib/methodology";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { computeHeatBucket } from "@/lib/methodology";
import { formatMoney } from "@/lib/finance";
import { loadFinanceRows } from "@/lib/finance-rows";

/**
 * The grounding bundle for AI narratives: every figure the model may use,
 * computed by the SAME deterministic aggregates that feed the dashboard.
 * The model is instructed to reference only what is in here — it never
 * computes scores, dispositions, or money.
 */
export interface LandscapeBundle {
  engagement: { name: string; clientName: string; currency: string };
  counts: { total: number; inScope: number; outOfScope: number; notUtilized: number; pool: number; scored: number };
  quadrants: Record<"keepAsIs" | "retool" | "redesign" | "terminate" | "unknown", number>;
  urgent: { belowBvThreshold: number; belowItThreshold: number };
  missionCritical: { name: string; disposition: string }[];
  finance: { costedApps: number; totalAnnualCost: string; savingsCandidate: string } | null;
  hotspots: { capability: string; bucket: string; terminate: number; transform: number; scored: number }[];
  completion: { survey: string; complete: number; partial: number; missing: number }[];
  overridden: number;
}

export async function loadLandscapeBundle(
  db: ScopedDb,
  engagement: { name: string; clientName: string; currency: string },
): Promise<LandscapeBundle> {
  const [apps, templates, responses, thresholds, nodes, finance] = await Promise.all([
    db.application.findMany({
      select: {
        name: true, inScope: true, isUtilized: true, missionCritical: true, capabilityNodeId: true,
        result: { select: { computedDisposition: true, veryLowBv: true, veryLowIt: true } },
        override: { select: { disposition: true } },
      },
    }),
    db.surveyTemplate.findMany({ where: { questions: { some: {} } }, select: { id: true, name: true } }),
    db.surveyResponse.findMany({ select: { templateId: true, status: true, application: { select: { inScope: true } } } }),
    db.thresholdConfig.findFirst(),
    db.capabilityNode.findMany({ select: { id: true, parentId: true, level: true, name: true, isPlaceholder: true } }),
    loadFinanceRows(db),
  ]);

  const finalOf = (a: (typeof apps)[number]): Disposition =>
    ((a.override?.disposition as Disposition | undefined) ?? (a.result?.computedDisposition as Disposition | undefined) ?? "UNKNOWN");
  const pool = apps.filter((a) => a.inScope && a.isUtilized);
  const count = (d: Disposition) => pool.filter((a) => finalOf(a) === d).length;
  const quadrants = {
    keepAsIs: count("KEEP_AS_IS"), retool: count("RETOOL"), redesign: count("REDESIGN"),
    terminate: count("TERMINATE"), unknown: count("UNKNOWN"),
  };

  const heat = { t1: thresholds?.heatT1 ?? THRESHOLD_DEFAULTS.heatT1, t2: thresholds?.heatT2 ?? THRESHOLD_DEFAULTS.heatT2 };
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const l1Of = (id: string | null) => {
    let n = id ? nodeById.get(id) : undefined;
    while (n) { if (n.level === "L1") return n; n = n.parentId ? nodeById.get(n.parentId) : undefined; }
    return undefined;
  };
  const tallies = new Map<string, { name: string; known: number; terminate: number; transform: number }>();
  for (const a of pool) {
    const l1 = l1Of(a.capabilityNodeId);
    if (!l1 || l1.isPlaceholder) continue;
    const t = tallies.get(l1.id) ?? { name: l1.name, known: 0, terminate: 0, transform: 0 };
    const d = finalOf(a);
    if (d !== "UNKNOWN") {
      t.known += 1;
      if (d === "TERMINATE") t.terminate += 1;
      else if (d === "RETOOL" || d === "REDESIGN") t.transform += 1;
    }
    tallies.set(l1.id, t);
  }
  const hotspots = [...tallies.values()]
    .map((t) => ({ ...t, bucket: computeHeatBucket({ appCount: t.known, terminateCount: t.terminate, retoolRedesignCount: t.transform }, heat) }))
    .filter((t) => t.bucket === "TERMINATE" || t.bucket === "RETOOL_REDESIGN")
    .map((t) => ({ capability: t.name, bucket: t.bucket === "TERMINATE" ? "red" : "yellow", terminate: t.terminate, transform: t.transform, scored: t.known }));

  const inScope = apps.filter((a) => a.inScope).length;
  const inScopeResponses = responses.filter((r) => r.application.inScope);
  const completion = templates.map((t) => {
    const complete = inScopeResponses.filter((r) => r.templateId === t.id && r.status === "COMPLETE").length;
    const partial = inScopeResponses.filter((r) => r.templateId === t.id && r.status === "IN_PROGRESS").length;
    return { survey: t.name, complete, partial, missing: Math.max(0, inScope - complete - partial) };
  });

  return {
    engagement,
    counts: {
      total: apps.length, inScope, outOfScope: apps.length - inScope,
      notUtilized: apps.filter((a) => a.inScope && !a.isUtilized).length,
      pool: pool.length, scored: pool.length - quadrants.unknown,
    },
    quadrants,
    urgent: {
      belowBvThreshold: pool.filter((a) => a.result?.veryLowBv).length,
      belowItThreshold: pool.filter((a) => a.result?.veryLowIt).length,
    },
    missionCritical: pool.filter((a) => a.missionCritical).map((a) => ({ name: a.name, disposition: finalOf(a) })),
    finance: finance.costed.length > 0
      ? {
          costedApps: finance.costed.length,
          totalAnnualCost: formatMoney(finance.totalCost, engagement.currency),
          savingsCandidate: formatMoney(finance.savingsCandidate, engagement.currency),
        }
      : null,
    hotspots,
    completion,
    overridden: apps.filter((a) => a.override).length,
  };
}

const GROUNDING = `You are the analysis narrator inside APS Platform, an application-rationalization tool. You are given the engagement's computed figures as JSON. STRICT RULES: use ONLY the figures provided — never invent, extrapolate, or recompute numbers; if something isn't in the data, don't mention it. Dispositions were computed by the tool's deterministic methodology (importance-weighted survey scores against thresholds); costs are context and never drive a disposition. Terminology: Keep-As-Is (retain), Re-Tool (modernize platform), Re-Design (rework functionality), Terminate (retire), Unknown (not yet scored), NLU (in scope but no longer utilized).`;

/** Pure prompt builders — unit-tested; the model sees exactly this. */
export function buildLandscapePrompt(bundle: LandscapeBundle): { system: string; user: string } {
  return {
    system: GROUNDING,
    user: `Explain this application landscape in plain language for an executive at ${bundle.engagement.clientName}. 3-5 short paragraphs, no headings, no bullet lists. Cover: portfolio size and scope, the disposition story and what it means, cost/savings if present, capability hotspots if present, and how complete/confident the data is. Be direct and specific.\n\nDATA:\n${JSON.stringify(bundle)}`,
  };
}

export function buildBriefPrompt(bundle: LandscapeBundle): { system: string; user: string } {
  return {
    system: GROUNDING,
    user: `Write a one-page engagement brief in Markdown for the "${bundle.engagement.name}" engagement at ${bundle.engagement.clientName}. Sections: **Status** (data collection and scoring completeness), **Portfolio at a glance**, **Key findings** (dispositions, urgent flags, hotspots), **Financial view** (only if cost data present), **Data confidence & next steps**. Keep it under 350 words, factual, consulting tone.\n\nDATA:\n${JSON.stringify(bundle)}`,
  };
}
