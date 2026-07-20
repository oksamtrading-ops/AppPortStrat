"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { rateLimit } from "@/lib/db/admin";
import { writeAudit } from "@/lib/audit";
import { aiConfigured } from "@/lib/ai/generate";
import { suggestCapabilityMappings, type MappingSuggestion } from "@/lib/ai/capability-map";

/**
 * AI capability mapping (Consultant+, AI opt-in, rate-limited, audited).
 * Suggestions never write anything; accepts resolve the capability name to a
 * node in THIS engagement's tree and update via the scoped client.
 */

export async function suggestMappingsAction(input: {
  engagementId: string;
}): Promise<{ ok: true; suggestions: (MappingSuggestion & { applicationId: string })[] } | { ok: false; error: string }> {
  const parsed = z.object({ engagementId: z.string().min(1) }).parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  if (!engagement.aiEnabled) return { ok: false, error: "AI features are switched off for this engagement (Settings → AI features)." };
  if (!aiConfigured()) return { ok: false, error: "AI is not configured on this platform — an administrator must set ANTHROPIC_API_KEY." };
  const limit = await rateLimit(`ai:${ctx.engagementId}`, 20, 3600);
  if (!limit.allowed) return { ok: false, error: "AI generation limit reached for this engagement (20/hour) — try again later." };

  try {
    const [unmapped, nodes] = await Promise.all([
      db.application.findMany({
        where: { capabilityNodeId: null, inScope: true },
        select: { id: true, name: true, description: true },
        orderBy: { appNumber: "asc" },
        take: 200,
      }),
      db.capabilityNode.findMany({ where: { isPlaceholder: false }, select: { name: true, level: true } }),
    ]);
    if (unmapped.length === 0) return { ok: false, error: "No unmapped in-scope applications." };

    const suggestions = await suggestCapabilityMappings(
      unmapped.map((a) => ({ name: a.name, description: a.description })),
      nodes.map((n) => `${n.name} (${n.level})`),
    );
    const idByName = new Map(unmapped.map((a) => [a.name, a.id]));
    const rows = suggestions
      .filter((s) => idByName.has(s.appName))
      .map((s) => ({ ...s, applicationId: idByName.get(s.appName)! }));

    await writeAudit(db, ctx, {
      action: "ai.capabilityMap.suggest",
      entityType: "Application",
      after: { unmapped: unmapped.length, suggested: rows.filter((r) => r.capability).length },
    });
    return { ok: true, suggestions: rows };
  } catch (err) {
    console.error("[aps] AI mapping failed:", err);
    return { ok: false, error: "Suggestion failed — try again, or check the platform's AI configuration." };
  }
}

const acceptSchema = z.object({
  engagementId: z.string().min(1),
  rows: z.array(z.object({ applicationId: z.string().min(1), capability: z.string().trim().min(1).max(200) })).min(1).max(200),
});

export async function acceptMappingsAction(input: {
  engagementId: string;
  rows: { applicationId: string; capability: string }[];
}): Promise<{ ok: true; mapped: number } | { ok: false; error: string }> {
  const parsed = acceptSchema.parse(input);
  const { ctx, db } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  try {
    const nodes = await db.capabilityNode.findMany({ select: { id: true, name: true, level: true } });
    const norm = (s: string) => s.trim().toLowerCase();
    // Deepest match wins, mirroring the import pipeline's resolution.
    const resolve = (name: string) =>
      ["L2", "L1", "L0"].map((lvl) => nodes.find((n) => n.level === lvl && norm(n.name) === norm(name))).find(Boolean)?.id ?? null;

    let mapped = 0;
    for (const row of parsed.rows) {
      const nodeId = resolve(row.capability);
      if (!nodeId) continue; // model must pick from the tree; anything else is dropped
      await db.application.update({ where: { id: row.applicationId }, data: { capabilityNodeId: nodeId } });
      mapped += 1;
    }

    await writeAudit(db, ctx, {
      action: "ai.capabilityMap.accept",
      entityType: "Application",
      after: { accepted: parsed.rows.length, mapped },
    });
    revalidatePath(`/e/${ctx.engagementId}/quality`);
    return { ok: true, mapped };
  } catch (err) {
    console.error("[aps] AI mapping accept failed:", err);
    return { ok: false, error: "Mapping failed — check the Applications page for partial results." };
  }
}

export async function runQualityChecksAction(input: {
  engagementId: string;
}): Promise<{ ok: true; findings: import("@/lib/ai/quality").QualityFinding[] } | { ok: false; error: string }> {
  const parsed = z.object({ engagementId: z.string().min(1) }).parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  if (!engagement.aiEnabled) return { ok: false, error: "AI features are switched off for this engagement (Settings → AI features)." };
  if (!aiConfigured()) return { ok: false, error: "AI is not configured on this platform — an administrator must set ANTHROPIC_API_KEY." };
  const limit = await rateLimit(`ai:${ctx.engagementId}`, 20, 3600);
  if (!limit.allowed) return { ok: false, error: "AI generation limit reached for this engagement (20/hour) — try again later." };

  try {
    const { loadQualityData, findQualityAnomalies } = await import("@/lib/ai/quality");
    const apps = await loadQualityData(db);
    if (apps.length === 0) return { ok: false, error: "No in-scope applications to check." };
    const findings = await findQualityAnomalies(apps);

    await writeAudit(db, ctx, {
      action: "ai.quality.check",
      entityType: "Application",
      after: { appsChecked: apps.length, findings: findings.length },
    });
    return { ok: true, findings };
  } catch (err) {
    console.error("[aps] AI quality check failed:", err);
    return { ok: false, error: "Quality check failed — try again, or check the platform's AI configuration." };
  }
}
