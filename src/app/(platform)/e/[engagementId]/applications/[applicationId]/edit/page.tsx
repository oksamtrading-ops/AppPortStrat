import { notFound } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { ApplicationForm } from "@/components/apps/application-form";
import { loadApplicationFormData } from "../../form-data";
import { CommentsPanel, type CommentView } from "@/components/apps/comments-panel";

export const dynamic = "force-dynamic";

export default async function EditApplicationPage({
  params,
}: {
  params: Promise<{ engagementId: string; applicationId: string }>;
}) {
  const { engagementId, applicationId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId, "CONSULTANT");

  const app = await db.application.findUnique({ where: { id: applicationId } });
  if (!app) notFound();

  const { nodes, applicationTypes, actionPlanOptions } = await loadApplicationFormData(db);

  const [commentRows, members] = await Promise.all([
    db.comment.findMany({
      where: { applicationId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { displayName: true, email: true } } },
    }),
    db.membership.findMany({ where: { role: { in: ["ENGAGEMENT_LEAD", "CONSULTANT"] } }, select: { displayName: true } }),
  ]);
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  const toView = (c: (typeof commentRows)[number]) => ({
    id: c.id,
    body: c.body,
    internal: c.internal,
    authorName: c.author.displayName ?? c.author.email,
    createdAt: fmt(c.createdAt),
  });
  const comments: CommentView[] = commentRows
    .filter((c) => !c.parentId)
    .map((root) => ({ ...toView(root), replies: commentRows.filter((c) => c.parentId === root.id).map(toView) }));

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

      <CommentsPanel
        engagementId={engagementId}
        applicationId={applicationId}
        comments={comments}
        canWrite={!ctx.readOnly}
        memberNames={members.map((m) => m.displayName).filter((n): n is string => Boolean(n))}
      />
    </div>
  );
}
