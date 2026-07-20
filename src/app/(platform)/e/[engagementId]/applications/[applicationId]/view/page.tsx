import { notFound, redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { DISPOSITION_LABELS, type Disposition } from "@/lib/methodology";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommentsPanel, type CommentView } from "@/components/apps/comments-panel";

export const dynamic = "force-dynamic";

/**
 * Read-only application view — the surface Client Viewers use to read SHARED
 * discussion (the guard filters internal comments out of their queries).
 * Leads/Consultants normally use the edit page; this stays available to them.
 */
export default async function ViewApplicationPage({
  params,
}: {
  params: Promise<{ engagementId: string; applicationId: string }>;
}) {
  const { engagementId, applicationId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: {
      result: true,
      override: { select: { disposition: true } },
      signOff: { select: { disposition: true, createdAt: true } },
    },
  });
  if (!app) notFound();

  const disposition = ((app.override?.disposition as Disposition | undefined) ??
    (app.result?.computedDisposition as Disposition | undefined) ??
    "UNKNOWN") as Disposition;

  const commentRows = await db.comment.findMany({
    where: { applicationId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { displayName: true, email: true } } },
  });
  const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  const toView = (c: (typeof commentRows)[number]) => ({
    id: c.id, body: c.body, internal: c.internal,
    authorName: c.author.displayName ?? c.author.email, createdAt: fmt(c.createdAt),
  });
  const comments: CommentView[] = commentRows
    .filter((c) => !c.parentId)
    .map((root) => ({ ...toView(root), replies: commentRows.filter((c) => c.parentId === root.id).map(toView) }));

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">
        <span className="text-muted-foreground">#{app.appNumber}</span> {app.name}
      </h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            <div><dt className="text-muted-foreground text-xs">Disposition</dt><dd className="font-medium">{DISPOSITION_LABELS[disposition]}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Business Value</dt><dd className="font-medium tabular-nums">{app.result?.bvScore != null ? app.result.bvScore.toFixed(1) : "—"}</dd></div>
            <div><dt className="text-muted-foreground text-xs">IT Health</dt><dd className="font-medium tabular-nums">{app.result?.itScore != null ? app.result.itScore.toFixed(1) : "—"}</dd></div>
            <div><dt className="text-muted-foreground text-xs">Scope</dt><dd className="font-medium">{app.inScope ? (app.isUtilized ? "In scope" : "No longer utilized") : "Out of scope"}</dd></div>
            <div>
              <dt className="text-muted-foreground text-xs">Sign-off</dt>
              <dd className="font-medium">
                {app.signOff
                  ? app.signOff.disposition === disposition
                    ? `Signed off ${fmt(app.signOff.createdAt).slice(0, 10)}`
                    : "Under review"
                  : "Pending"}
              </dd>
            </div>
          </dl>
          {app.description ? <p className="text-muted-foreground mt-3 text-sm">{app.description}</p> : null}
        </CardContent>
      </Card>

      <CommentsPanel
        engagementId={engagementId}
        applicationId={applicationId}
        comments={comments}
        canWrite={false}
        memberNames={[]}
      />
    </div>
  );
}
