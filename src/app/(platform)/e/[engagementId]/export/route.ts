import { requireEngagementContext } from "@/lib/auth/context";
import { buildEngagementWorkbook } from "@/lib/xlsx-export";
import { writeAudit } from "@/lib/audit";

/** Full-dataset XLSX export (Consultant+); also the purge exit path. */
export async function GET(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, engagement } = await requireEngagementContext(engagementId, "CONSULTANT");

  const workbook = await buildEngagementWorkbook(db, engagement.name);
  const buffer = await workbook.xlsx.writeBuffer();

  await writeAudit(db, ctx, {
    action: "export.full-dataset",
    entityType: "Engagement",
    entityId: engagement.id,
    after: { format: "xlsx" },
  });

  const filename = `${engagement.name.replace(/[^\w-]+/g, "_")}_full_export.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
