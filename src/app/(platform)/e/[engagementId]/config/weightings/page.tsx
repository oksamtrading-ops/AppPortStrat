import { requireEngagementContext } from "@/lib/auth/context";
import { APS50_PRESET } from "@/lib/engagement-defaults";
import { WeightingsForm, type WeightingRow } from "./weightings-form";

export const dynamic = "force-dynamic";

export default async function WeightingsPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId, "ENGAGEMENT_LEAD");

  const weightings = await db.questionWeighting.findMany({
    select: {
      questionId: true,
      importanceRating: true,
      question: { select: { code: true, text: true, section: true, scoreFamily: true, orderIndex: true } },
    },
  });

  const rows: WeightingRow[] = weightings
    .filter((w) => w.question.scoreFamily !== "NONE")
    .sort((a, b) => a.question.orderIndex - b.question.orderIndex)
    .map((w) => ({
      questionId: w.questionId,
      code: w.question.code,
      text: w.question.text,
      section: w.question.section,
      family: w.question.scoreFamily as WeightingRow["family"],
      rating: w.importanceRating,
    }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Weightings</h1>
        <p className="text-muted-foreground text-sm">
          Weight = importance ÷ sum of importances within the score family (always normalized to 100%). Saving
          re-scores the whole portfolio immediately and is recorded in the audit log.
        </p>
      </div>
      <WeightingsForm
        engagementId={engagementId}
        rows={rows}
        aps50Codes={[...APS50_PRESET.bv, ...APS50_PRESET.it]}
        readOnly={ctx.readOnly}
      />
    </div>
  );
}
