"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { markNotificationsRead } from "@/app/(platform)/e/[engagementId]/applications/comment-actions";

export interface NotificationView {
  id: string;
  kind: string;
  applicationId: string;
  applicationName: string;
  actorDisplay: string;
  snippet: string;
  createdAt: string;
  unread: boolean;
}

/** Header bell: unread count + recent notifications; opening marks all read. */
export function NotificationBell({
  engagementId,
  unread,
  items,
}: {
  engagementId: string;
  unread: number;
  items: NotificationView[];
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) startTransition(async () => void (await markNotificationsRead({ engagementId })));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        className="hover:bg-secondary relative rounded-md p-1.5"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="bg-popover absolute right-0 z-50 mt-1 w-80 rounded-md border p-1 shadow-md">
          {items.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-center text-sm">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={`/e/${engagementId}/applications/${n.applicationId}/edit`}
                onClick={() => setOpen(false)}
                className={`hover:bg-accent block rounded px-3 py-2 text-sm ${n.unread ? "bg-secondary/60" : ""}`}
              >
                <div className="text-xs">
                  <span className="font-medium">{n.actorDisplay}</span>{" "}
                  <span className="text-muted-foreground">
                    {n.kind === "mention" ? "mentioned you on" : "replied on"} {n.applicationName} · {n.createdAt}
                  </span>
                </div>
                <p className="text-muted-foreground mt-0.5 truncate text-xs">{n.snippet}</p>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
