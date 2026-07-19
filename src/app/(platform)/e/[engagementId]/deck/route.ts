import { requireEngagementContext } from "@/lib/auth/context";
import { buildEngagementDeck } from "@/lib/pptx-export";
import { writeAudit } from "@/lib/audit";
import { tooManyRequests } from "@/lib/rate-limit-route";

/** Client-ready PPTX deck export (Consultant+). */
export async function GET(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId, "CONSULTANT");

  const limited = await tooManyRequests(`export:${ctx.membershipId}`, 20, 60);
  if (limited) return limited;

  const buffer = await buildEngagementDeck(db, {
    name: engagement.name,
    clientName: engagement.clientName,
    currency: engagement.currency,
  });

  await writeAudit(db, ctx, {
    action: "export.deck",
    entityType: "Engagement",
    entityId: engagement.id,
    after: { format: "pptx" },
  });

  const filename = `${engagement.name.replace(/[^\w-]+/g, "_")}_APS_deck.pptx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
