import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import type { Session } from "@/lib/auth/session";
import { devSignOut, switchDevUser } from "@/lib/auth/dev-actions";
import { DEV_USERS } from "@/lib/auth/dev";
import { Badge } from "@/components/ui/badge";
import { NotificationBell, type NotificationView } from "./notification-bell";
import { Button } from "@/components/ui/button";

/**
 * The single top header: brand, engagement context, the viewer's role, and
 * identity controls. Role/read-only badges live here (not in a second bar)
 * so the workspace has exactly one header row.
 */
export function TopBar({
  session,
  subtitle,
  roleLabel,
  readOnlyLabel,
  notifications,
}: {
  session: Session;
  subtitle?: string;
  roleLabel?: string;
  readOnlyLabel?: string;
  notifications?: { engagementId: string; unread: number; items: NotificationView[] };
}) {
  return (
    <header className="flex h-12 items-center justify-between border-b bg-background px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/select-engagement" className="shrink-0 font-semibold tracking-tight">
          APS <span className="text-brand">Platform</span>
        </Link>
        {subtitle ? (
          <>
            <span className="text-border shrink-0">|</span>
            <span className="text-muted-foreground truncate text-sm">{subtitle}</span>
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {notifications ? (
          <NotificationBell engagementId={notifications.engagementId} unread={notifications.unread} items={notifications.items} />
        ) : null}
        {readOnlyLabel ? (
          <Badge variant="secondary" className="shrink-0">
            {readOnlyLabel}
          </Badge>
        ) : null}
        {roleLabel ? (
          <Badge variant="outline" className="shrink-0">
            {roleLabel}
          </Badge>
        ) : null}
        {session.mode === "clerk" ? (
          <UserButton />
        ) : (
          <DevIdentityControls currentUserId={session.userId} displayName={session.displayName} />
        )}
      </div>
    </header>
  );
}

function DevIdentityControls({ currentUserId, displayName }: { currentUserId: string; displayName: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground">dev: {displayName}</span>
      <form action={switchDevUser} className="flex items-center gap-1">
        <select
          name="userId"
          defaultValue={currentUserId}
          className="h-7 rounded border bg-background px-1 text-xs"
          aria-label="Switch dev user"
        >
          {DEV_USERS.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
          Switch
        </Button>
      </form>
      <form action={devSignOut}>
        <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
          Sign out
        </Button>
      </form>
    </div>
  );
}
