"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { rateLimit } from "@/lib/db/admin";
import { writeAudit } from "@/lib/audit";
import { aiConfigured, generateNarrative } from "@/lib/ai/generate";
import { buildBriefPrompt, buildLandscapePrompt, loadLandscapeBundle } from "@/lib/ai/landscape";

const schema = z.object({ engagementId: z.string().min(1), kind: z.enum(["landscape", "brief"]) });

/**
 * AI narrative generation (Lead/Consultant): grounded in the engagement's own
 * computed aggregates, gated on the per-engagement opt-in, rate-limited for
 * cost control, and audited. Output is a DRAFT — the UI labels it as such.
 */
export async function generateAiNarrative(input: {
  engagementId: string;
  kind: "landscape" | "brief";
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const parsed = schema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  if (!engagement.aiEnabled) {
    return { ok: false, error: "AI features are switched off for this engagement (Settings → AI features)." };
  }
  if (!aiConfigured()) {
    return { ok: false, error: "AI is not configured on this platform — an administrator must set ANTHROPIC_API_KEY." };
  }
  const limit = await rateLimit(`ai:${ctx.engagementId}`, 20, 3600);
  if (!limit.allowed) {
    return { ok: false, error: "AI generation limit reached for this engagement (20/hour) — try again later." };
  }

  try {
    const bundle = await loadLandscapeBundle(db, {
      name: engagement.name,
      clientName: engagement.clientName,
      currency: engagement.currency,
    });
    const prompt = parsed.kind === "landscape" ? buildLandscapePrompt(bundle) : buildBriefPrompt(bundle);
    const text = await generateNarrative(prompt);

    await writeAudit(db, ctx, {
      action: "ai.narrative.generate",
      entityType: "Engagement",
      entityId: ctx.engagementId,
      after: { kind: parsed.kind, characters: text.length },
    });
    return { ok: true, text };
  } catch (err) {
    console.error("[aps] AI narrative failed:", err);
    return { ok: false, error: "Generation failed — try again, or check the platform's AI configuration." };
  }
}
