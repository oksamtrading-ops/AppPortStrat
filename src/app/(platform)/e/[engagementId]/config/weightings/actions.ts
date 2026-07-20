"use server";

import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { recomputeEngagement } from "@/lib/recompute";
import { rateLimit } from "@/lib/db/admin";

const schema = z.object({
  engagementId: z.string().min(1),
  ratings: z
    .array(z.object({ questionId: z.string().min(1), rating: z.number().int().min(0).max(5) }))
    .min(1)
    .max(500),
});

export async function updateWeightings(input: z.infer<typeof schema>) {
  const parsed = schema.parse(input);
  const { ctx, db, engagement } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  // Each save triggers a full engagement recompute; throttle bursts.
  if (!(await rateLimit(`recompute:${ctx.membershipId}`, 30, 60)).allowed) {
    throw new Error("Too many configuration changes in a short time — wait a moment and try again.");
  }

  // Scoped read — also proves every questionId belongs to this engagement.
  const existing = await db.questionWeighting.findMany({
    select: { id: true, questionId: true, importanceRating: true, question: { select: { code: true } } },
  });
  const byQuestionId = new Map(existing.map((w) => [w.questionId, w]));

  const changes: Array<{ id: string; code: string; from: number; to: number }> = [];
  for (const r of parsed.ratings) {
    const row = byQuestionId.get(r.questionId);
    if (!row) throw new Error("Unknown question for this engagement");
    if (row.importanceRating !== r.rating) {
      changes.push({ id: row.id, code: row.question.code, from: row.importanceRating, to: r.rating });
    }
  }

  for (const change of changes) {
    await db.questionWeighting.update({ where: { id: change.id }, data: { importanceRating: change.to } });
  }

  const stats = await recomputeEngagement(ctx, db, engagement);

  if (changes.length > 0) {
    await writeAudit(db, ctx, {
      action: "weighting.update",
      entityType: "QuestionWeighting",
      before: Object.fromEntries(changes.map((c) => [c.code, c.from])),
      after: Object.fromEntries(changes.map((c) => [c.code, c.to])),
    });
  }

  return { ok: true as const, changed: changes.length, ...stats };
}
