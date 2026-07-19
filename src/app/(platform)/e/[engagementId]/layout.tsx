import { cookies } from "next/headers";
import { requireEngagementContext } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { SIDEBAR_COOKIE } from "@/components/shell/sidebar-cookie";
import { TopBar } from "@/components/shell/top-bar";

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
  const [{ ctx, session, engagement }, cookieStore] = await Promise.all([
    requireEngagementContext(engagementId),
    cookies(),
  ]);
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar
        session={session}
        subtitle={`${engagement.name} — ${engagement.clientName}`}
        roleLabel={ROLE_LABELS[ctx.role]}
        readOnlyLabel={ctx.readOnly ? `Read-only (${engagement.status.toLowerCase()})` : undefined}
      />
      <div className="flex flex-1">
        <SidebarNav engagementId={engagementId} role={ctx.role} defaultCollapsed={sidebarCollapsed} />
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
