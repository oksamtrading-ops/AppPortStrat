import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireEngagementContext } from "@/lib/auth/context";
import { DISPOSITION_LABELS, finalDisposition } from "@/lib/methodology";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CommentsPanel } from "@/components/apps/comments-panel";
import { toCommentViews } from "@/lib/comments";

export const dynamic = "force-dynamic";

/**
 * Capability detail — the C3 surface capability comments hang off. Shows the
 * node in its tree context, the applications mapped to it (including via
 * descendants), and the Discussion thread. Client Viewers get shared comments
 * only (guard row predicate); Respondents are redirected to their surveys.
 */
export default async function CapabilityDetailPage({
  params,
}: {
  params: Promise<{ engagementId: string; nodeId: string }>;
}) {
  const { engagementId, nodeId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [node, allNodes] = await Promise.all([
    db.capabilityNode.findUnique({ where: { id: nodeId } }),
    db.capabilityNode.findMany({ select: { id: true, parentId: true, name: true, level: true } }),
  ]);
  if (!node) notFound();

  // Ancestor chain (breadcrumb) and descendant set (mapped-app rollup) from
  // the already-loaded tree — no recursive queries.
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const crumbs: { id: string; name: string }[] = [];
  for (let p = node.parentId; p; p = byId.get(p)?.parentId ?? null) {
    const parent = byId.get(p);
    if (!parent) break;
    crumbs.unshift({ id: parent.id, name: parent.name });
  }
  const subtree = new Set([node.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of allNodes) {
      if (n.parentId && subtree.has(n.parentId) && !subtree.has(n.id)) {
        subtree.add(n.id);
        grew = true;
      }
    }
  }

  const [apps, commentRows, members] = await Promise.all([
    db.application.findMany({
      where: { capabilityNodeId: { in: [...subtree] } },
      orderBy: { appNumber: "asc" },
      select: {
        id: true, appNumber: true, name: true, inScope: true,
        result: { select: { computedDisposition: true } },
        override: { select: { disposition: true } },
      },
    }),
    db.comment.findMany({
      where: { capabilityNodeId: nodeId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { displayName: true, email: true } } },
    }),
    ctx.role === "CLIENT_VIEWER"
      ? Promise.resolve([])
      : db.membership.findMany({ where: { role: { in: ["ENGAGEMENT_LEAD", "CONSULTANT"] } }, select: { displayName: true } }),
  ]);

  const comments = toCommentViews(commentRows);

  const canWrite = !ctx.readOnly && (ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT");
  const appHref = (id: string) =>
    ctx.role === "CLIENT_VIEWER" ? `/e/${engagementId}/applications/${id}/view` : `/e/${engagementId}/applications/${id}/edit`;

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
          <Link href={`/e/${engagementId}/capabilities`} className="hover:underline">
            Capabilities
          </Link>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight className="size-3" />
              <Link href={`/e/${engagementId}/capabilities/${c.id}`} className="hover:underline">
                {c.name}
              </Link>
            </span>
          ))}
        </div>
        <h1 className="mt-1 flex items-center gap-2 text-lg font-semibold">
          {node.name}
          <span className="text-muted-foreground rounded border px-1.5 py-0.5 text-[10px] font-medium">{node.level}</span>
        </h1>
        {node.description ? <p className="text-muted-foreground mt-1 text-sm">{node.description}</p> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mapped applications</CardTitle>
        </CardHeader>
        <CardContent>
          {apps.length === 0 ? (
            <p className="text-muted-foreground text-sm">No applications are mapped to this capability{subtree.size > 1 ? " or its children" : ""}.</p>
          ) : (
            <ul className="divide-y text-sm">
              {apps.map((a) => {
                const disposition = finalDisposition(a);
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-1.5">
                    <Link href={appHref(a.id)} className="min-w-0 truncate hover:underline">
                      <span className="text-muted-foreground">#{a.appNumber}</span> {a.name}
                    </Link>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {a.inScope ? DISPOSITION_LABELS[disposition] : "Out of scope"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <CommentsPanel
        engagementId={engagementId}
        capabilityNodeId={nodeId}
        comments={comments}
        canWrite={canWrite}
        memberNames={members.map((m) => m.displayName).filter((n): n is string => Boolean(n))}
      />
    </div>
  );
}
