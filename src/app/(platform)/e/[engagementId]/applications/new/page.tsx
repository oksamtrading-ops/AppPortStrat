import { requireEngagementContext } from "@/lib/auth/context";
import { ApplicationForm } from "@/components/apps/application-form";
import { loadApplicationFormData } from "../form-data";

export const dynamic = "force-dynamic";

export default async function NewApplicationPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { db } = await requireEngagementContext(engagementId, "CONSULTANT");
  const { nodes, applicationTypes, actionPlanOptions } = await loadApplicationFormData(db);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Add application</h1>
      <ApplicationForm
        engagementId={engagementId}
        nodes={nodes}
        applicationTypes={applicationTypes}
        actionPlanOptions={actionPlanOptions}
        initial={{
          name: "",
          acronym: "",
          description: "",
          applicationType: "",
          businessFunctionDetail: "",
          target: "",
          meetsFutureState: "",
          actionPlanAssignment: "",
          actionPlanJustification: "",
          missionCritical: false,
          comments: "",
          inScope: true,
          isUtilized: true,
          isReplaced: false,
          inFlight: false,
          capabilityNodeId: null,
        }}
      />
    </div>
  );
}
