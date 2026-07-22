"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { rateLimit } from "@/lib/db/admin";
import { formatDate } from "@/lib/format";
import { writeAudit } from "@/lib/audit";
import { aiConfigured, generateNarrative } from "@/lib/ai/generate";
import { buildBriefPrompt, buildLandscapePrompt, buildRefinePrompt, findUnverifiedNumbers, loadLandscapeBundle } from "@/lib/ai/landscape";
import { buildCritiquePrompt, buildQaPrompt, buildReportPrompt, buildRevisePrompt, loadReportData } from "@/lib/ai/report";

const schema = z.object({
  engagementId: z.string().min(1),
  kind: z.enum(["landscape", "brief"]),
  refine: z.object({ previousText: z.string().min(1).max(20_000), instruction: z.enum(["tighten it", "make it more formal", "make it shorter"]) }).optional(),
});

/**
 * AI narrative generation (Lead/Consultant): grounded in the engagement's own
 * computed aggregates, gated on the per-engagement opt-in, rate-limited for
 * cost control, and audited. Output is a DRAFT — the UI labels it as such.
 */
export async function generateAiNarrative(input: {
  engagementId: string;
  kind: "landscape" | "brief";
  refine?: { previousText: string; instruction: "tighten it" | "make it more formal" | "make it shorter" };
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const parsed = schema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  if (!engagement.aiEnabled) {
    return { ok: false, error: "AI features are switched off for this engagement (Settings → AI features)." };
  }
  if (!aiConfigured()) {
    return { ok: false, error: "AI is not configured on this platform — an administrator must set ANTHROPIC_API_KEY." };
  }
  const limit = await rateLimit(`ai:${ctx.engagementId}`, 20, 3600, undefined, { failClosed: true });
  if (!limit.allowed) {
    return { ok: false, error: "AI generation limit reached for this engagement (20/hour) — try again later." };
  }

  try {
    const bundle = await loadLandscapeBundle(
      db,
      { name: engagement.name, clientName: engagement.clientName, currency: engagement.currency },
      formatDate(new Date()),
    );
    const prompt = parsed.refine
      ? buildRefinePrompt(bundle, parsed.refine.previousText, parsed.refine.instruction)
      : parsed.kind === "landscape"
        ? buildLandscapePrompt(bundle)
        : buildBriefPrompt(bundle);
    let text = await generateNarrative(prompt);
    // Deterministic grounding check: regenerate once on a miss; if it still
    // fails, ship the draft with an explicit warning instead of silently. The
    // retry is a second model call, so charge it (best-effort — never block the
    // in-flight generation on the limiter here).
    if (findUnverifiedNumbers(text, bundle).length > 0) {
      await rateLimit(`ai:${ctx.engagementId}`, 20, 3600);
      text = await generateNarrative(prompt);
      const misses = findUnverifiedNumbers(text, bundle);
      if (misses.length > 0) {
        text += "\n\nGROUNDING CHECK: figure(s) " + misses.join(", ") + " could not be verified against the source data - confirm before sharing.";
      }
    }

    await writeAudit(db, ctx, {
      action: "ai.narrative.generate",
      entityType: "Engagement",
      entityId: ctx.engagementId,
      after: { kind: parsed.kind, refined: Boolean(parsed.refine), characters: text.length },
    });
    return { ok: true, text };
  } catch (err) {
    console.error("[aps] AI narrative failed:", err);
    return { ok: false, error: "Generation failed — try again, or check the platform's AI configuration." };
  }
}

/**
 * Final report — the one long-form pipeline, so it runs the agreed two-stage
 * chain: draft -> rubric critique -> revise, then the deterministic grounding
 * verifier. Costs ~3 model calls; charged 3 against the hourly rate limit.
 */
export async function generateAiReport(input: {
  engagementId: string;
}): Promise<{ ok: true; text: string; critiquePassed: boolean } | { ok: false; error: string }> {
  const parsed = z.object({ engagementId: z.string().min(1) }).parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  if (!engagement.aiEnabled) return { ok: false, error: "AI features are switched off for this engagement (Settings → AI features)." };
  if (!aiConfigured()) return { ok: false, error: "AI is not configured on this platform — an administrator must set ANTHROPIC_API_KEY." };
  // The report runs draft → critique → revise (~3 model calls); charge 3 in one
  // atomic decrement, fail closed so a DB brownout can't uncap Anthropic spend.
  const limit = await rateLimit(`ai:${ctx.engagementId}`, 20, 3600, undefined, { failClosed: true, cost: 3 });
  if (!limit.allowed) return { ok: false, error: "AI generation limit reached for this engagement (20/hour) — try again later." };

  try {
    const data = await loadReportData(
      db,
      { name: engagement.name, clientName: engagement.clientName, currency: engagement.currency },
      formatDate(new Date()),
    );
    let text = await generateNarrative(buildReportPrompt(data), 6000);
    const critique = await generateNarrative(buildCritiquePrompt(text, data), 1500);
    const critiquePassed = critique.trim().toUpperCase().startsWith("PASS");
    if (!critiquePassed) {
      text = await generateNarrative(buildRevisePrompt(text, critique, data), 6000);
    }
    const misses = findUnverifiedNumbers(text, data);
    if (misses.length > 0) {
      text += "\n\n> GROUNDING CHECK: figure(s) " + misses.join(", ") + " could not be verified against the source data — confirm before sharing.";
    }

    await writeAudit(db, ctx, {
      action: "ai.report.generate",
      entityType: "Engagement",
      entityId: ctx.engagementId,
      after: { critiquePassed, characters: text.length, apps: data.apps.length },
    });
    return { ok: true, text, critiquePassed };
  } catch (err) {
    console.error("[aps] AI report failed:", err);
    return { ok: false, error: "Report generation failed — try again, or check the platform's AI configuration." };
  }
}

/** Grounded portfolio Q&A — answers only from this engagement's data. */
export async function askPortfolioAction(input: {
  engagementId: string;
  question: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const parsed = z.object({ engagementId: z.string().min(1), question: z.string().trim().min(3).max(500) }).parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "CONSULTANT");

  if (!engagement.aiEnabled) return { ok: false, error: "AI features are switched off for this engagement (Settings → AI features)." };
  if (!aiConfigured()) return { ok: false, error: "AI is not configured on this platform — an administrator must set ANTHROPIC_API_KEY." };
  const limit = await rateLimit(`ai:${ctx.engagementId}`, 20, 3600, undefined, { failClosed: true });
  if (!limit.allowed) return { ok: false, error: "AI generation limit reached for this engagement (20/hour) — try again later." };

  try {
    const data = await loadReportData(
      db,
      { name: engagement.name, clientName: engagement.clientName, currency: engagement.currency },
      formatDate(new Date()),
    );
    let text = await generateNarrative(buildQaPrompt(data, parsed.question), 1000);
    const misses = findUnverifiedNumbers(text, data);
    if (misses.length > 0) {
      text += "\n\nGROUNDING CHECK: figure(s) " + misses.join(", ") + " could not be verified against the source data - confirm before sharing.";
    }
    await writeAudit(db, ctx, {
      action: "ai.qa.ask",
      entityType: "Engagement",
      entityId: ctx.engagementId,
      after: { questionLength: parsed.question.length, characters: text.length },
    });
    return { ok: true, text };
  } catch (err) {
    console.error("[aps] AI Q&A failed:", err);
    return { ok: false, error: "Answer failed — try again, or check the platform's AI configuration." };
  }
}
