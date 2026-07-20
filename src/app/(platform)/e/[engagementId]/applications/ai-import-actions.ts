"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { rateLimit } from "@/lib/db/admin";
import { writeAudit } from "@/lib/audit";
import { aiConfigured } from "@/lib/ai/generate";
import { extractPortfolio, type ExtractionResult, type ExtractionSource } from "@/lib/ai/extract";
import { importApplications } from "./actions";

/**
 * AI import: extraction proposes rows into a review grid; NOTHING is written
 * until the consultant accepts, and accepted rows flow through the existing
 * importApplications pipeline (field clamps, appNumber retry, capability
 * resolution, recompute, audit). Both steps gated on the per-engagement AI
 * opt-in, rate-limited, and audited.
 */

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(500_000) }),
  z.object({
    kind: z.literal("image"),
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    dataBase64: z.string().min(1).max(15_000_000), // ~11MB binary
  }),
  z.object({ kind: z.literal("pdf"), dataBase64: z.string().min(1).max(15_000_000) }),
]);

export async function extractPortfolioAction(input: {
  engagementId: string;
  source: ExtractionSource;
}): Promise<{ ok: true; result: ExtractionResult } | { ok: false; error: string }> {
  const parsed = z.object({ engagementId: z.string().min(1), source: sourceSchema }).parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  if (!engagement.aiEnabled) return { ok: false, error: "AI features are switched off for this engagement (Settings → AI features)." };
  if (!aiConfigured()) return { ok: false, error: "AI is not configured on this platform — an administrator must set ANTHROPIC_API_KEY." };
  // Weight the charge by input size so a single large multimodal/long-text
  // extraction can't buy a disproportionate amount of model spend for one unit;
  // fail CLOSED so a DB brownout can't uncap Anthropic cost (money path).
  const cost =
    parsed.source.kind === "text"
      ? Math.ceil(parsed.source.text.length / 250_000) // ~1–2 units for up to 500K chars
      : 3; // image/PDF: multimodal is materially pricier per call
  const limit = await rateLimit(`ai:${ctx.engagementId}`, 20, 3600, undefined, { failClosed: true, cost });
  if (!limit.allowed) return { ok: false, error: "AI generation limit reached for this engagement (20/hour) — try again later." };

  try {
    const nodes = await db.capabilityNode.findMany({
      where: { isPlaceholder: false },
      select: { name: true, level: true },
      orderBy: [{ level: "asc" }, { name: "asc" }],
    });
    const result = await extractPortfolio(parsed.source, nodes.map((n) => `${n.name} (${n.level})`));

    await writeAudit(db, ctx, {
      action: "ai.import.extract",
      entityType: "Application",
      after: { sourceKind: parsed.source.kind, rowsExtracted: result.applications.length },
    });
    return { ok: true, result };
  } catch (err) {
    console.error("[aps] AI extraction failed:", err);
    return { ok: false, error: "Extraction failed — try a clearer source, or check the platform's AI configuration." };
  }
}

const acceptSchema = z.object({
  engagementId: z.string().min(1),
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        description: z.string().max(1000).nullable(),
        capabilityName: z.string().trim().max(200).nullable(),
        capabilityExists: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
});

const AI_REVIEW_L0 = "AI Imported (review)";

export async function acceptAiImportAction(input: {
  engagementId: string;
  rows: { name: string; description: string | null; capabilityName: string | null; capabilityExists: boolean }[];
}): Promise<{ ok: true; created: number; newCapabilities: number } | { ok: false; error: string }> {
  const parsed = acceptSchema.parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  try {
    // Proposed-new capabilities land as L1s under a review L0 so they're
    // visible and re-parentable with the existing board tooling.
    const newNames = [...new Set(parsed.rows.filter((r) => r.capabilityName && !r.capabilityExists).map((r) => r.capabilityName!))];
    let newCapabilities = 0;
    if (newNames.length > 0) {
      const l0 =
        (await db.capabilityNode.findFirst({ where: { level: "L0", name: AI_REVIEW_L0, parentId: null } })) ??
        (await db.capabilityNode.create({ data: { engagementId: ctx.engagementId, level: "L0", name: AI_REVIEW_L0, parentId: null } }));
      for (const name of newNames) {
        const existing = await db.capabilityNode.findFirst({ where: { level: "L1", name, parentId: l0.id } });
        if (!existing) {
          await db.capabilityNode.create({ data: { engagementId: ctx.engagementId, level: "L1", name, parentId: l0.id } });
          newCapabilities += 1;
        }
      }
    }

    // Reuse the hardened TSV import pipeline: same clamps, appNumber retry,
    // capability resolution (l0=l1=l2=<name> matches the node at any level),
    // recompute, and audit trail.
    const cell = (s: string | null) => (s ?? "").replace(/[\t\r\n]+/g, " ").trim();
    const tsv = [
      "name\tdescription\tl0\tl1\tl2",
      ...parsed.rows.map((r) => {
        const cap = cell(r.capabilityName);
        return [cell(r.name), cell(r.description), cap, cap, cap].join("\t");
      }),
    ].join("\n");
    const result = await importApplications({ engagementId: ctx.engagementId, text: tsv });
    if (!result.ok) return { ok: false, error: result.error ?? "Import failed" };

    await writeAudit(db, ctx, {
      action: "ai.import.accept",
      entityType: "Application",
      after: { accepted: parsed.rows.length, newCapabilities },
    });
    return { ok: true, created: parsed.rows.length, newCapabilities };
  } catch (err) {
    console.error("[aps] AI import accept failed:", err);
    return { ok: false, error: "Import failed — nothing may have been created; check the application list." };
  }
}
