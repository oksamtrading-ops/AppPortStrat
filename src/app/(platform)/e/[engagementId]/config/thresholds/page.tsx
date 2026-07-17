import { requireEngagementContext } from "@/lib/auth/context";
import { THRESHOLD_DEFAULTS } from "@/lib/engagement-defaults";
import { ThresholdsForm } from "./thresholds-form";

export const dynamic = "force-dynamic";

export default async function ThresholdsPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId, "ENGAGEMENT_LEAD");

  const config = await db.thresholdConfig.findFirst();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Thresholds</h1>
        <p className="text-muted-foreground text-sm">
          Changes re-score the whole portfolio immediately and are recorded in the audit log.
        </p>
      </div>
      <ThresholdsForm
        engagementId={engagementId}
        readOnly={ctx.readOnly}
        initial={{
          optBv: config?.optBv ?? THRESHOLD_DEFAULTS.optBv,
          urgBv: config?.urgBv ?? THRESHOLD_DEFAULTS.urgBv,
          optIt: config?.optIt ?? THRESHOLD_DEFAULTS.optIt,
          urgIt: config?.urgIt ?? THRESHOLD_DEFAULTS.urgIt,
          heatT1: config?.heatT1 ?? THRESHOLD_DEFAULTS.heatT1,
          heatT2: config?.heatT2 ?? THRESHOLD_DEFAULTS.heatT2,
          strictWorkbookScoring: engagement.strictWorkbookScoring,
        }}
      />
    </div>
  );
}
