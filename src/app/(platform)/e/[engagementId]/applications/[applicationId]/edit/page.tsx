import { notFound } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { ApplicationForm } from "@/components/apps/application-form";
import { loadApplicationFormData } from "../../form-data";

export const dynamic = "force-dynamic";

export default async function EditApplicationPage({
  params,
}: {
  params: Promise<{ engagementId: string; applicationId: string }>;
}) {
  const { engagementId, applicationId } = await params;
  const { db } = await requireEngagementContext(engagementId, "CONSULTANT");

  const app = await db.application.findUnique({ where: { id: applicationId } });
  if (!app) notFound();

  const { nodes, applicationTypes, actionPlanOptions } = await loadApplicationFormData(db);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">
        Edit application <span className="text-muted-foreground">#{app.appNumber} — {app.name}</span>
      </h1>
      <ApplicationForm
        engagementId={engagementId}
        nodes={nodes}
        applicationTypes={applicationTypes}
        actionPlanOptions={actionPlanOptions}
        initial={{
          applicationId: app.id,
          name: app.name,
          acronym: app.acronym ?? "",
          description: app.description ?? "",
          applicationType: app.applicationType ?? "",
          businessFunctionDetail: app.businessFunctionDetail ?? "",
          target: app.target ?? "",
          meetsFutureState: (app.meetsFutureState ?? "") as "" | "YES" | "NO" | "PARTIAL",
          actionPlanAssignment: app.actionPlanAssignment ?? "",
          actionPlanJustification: app.actionPlanJustification ?? "",
          missionCritical: app.missionCritical,
          comments: app.comments ?? "",
          inScope: app.inScope,
          isUtilized: app.isUtilized,
          isReplaced: app.isReplaced,
          inFlight: app.inFlight,
          capabilityNodeId: app.capabilityNodeId,
        }}
      />
    </div>
  );
}
