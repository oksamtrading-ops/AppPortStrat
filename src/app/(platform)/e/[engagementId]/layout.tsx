import { requireEngagementContext } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { TopBar } from "@/components/shell/top-bar";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

/**
 * Workspace shell. The context check here is navigation UX — every page,
 * server action, and route handler independently calls
 * requireEngagementContext (the actual security boundary).
 */
export default async function EngagementLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ engagementId: string }>;
}) {
  const { engagementId } = await params;
  const { ctx, session, engagement } = await requireEngagementContext(engagementId);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar session={session} subtitle={`${engagement.name} — ${engagement.clientName}`} />
      <div className="flex flex-1">
        <SidebarNav engagementId={engagementId} role={ctx.role} />
        <div className="flex-1">
          <div className="flex items-center gap-2 border-b bg-secondary/50 px-6 py-2">
            <Badge variant="outline">{ROLE_LABELS[ctx.role]}</Badge>
            {ctx.readOnly ? <Badge variant="secondary">Read-only ({engagement.status.toLowerCase()})</Badge> : null}
          </div>
          <main className="p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
