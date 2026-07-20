"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppWindow,
  CircleDollarSign,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { Role } from "@/lib/auth/roles";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: readonly Role[];
}

/**
 * Role-gated navigation (UX only — every page re-enforces via
 * requireEngagementContext, and the scoped client denies at the data layer).
 * Client Respondents see only their survey queue; Client Viewers see the
 * read-only analysis surfaces (APP-SPEC §2).
 */
function navItems(engagementId: string): NavItem[] {
  const base = `/e/${engagementId}`;
  return [
    { href: `${base}/dashboard`, label: "Dashboard", icon: LayoutDashboard, roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/applications`, label: "Applications", icon: AppWindow, roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/surveys`, label: "Surveys", icon: ClipboardList, roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_RESPONDENT"] },
    { href: `${base}/capabilities`, label: "Capabilities", icon: Network, roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/financials`, label: "Financials", icon: CircleDollarSign, roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/members`, label: "Members", icon: Users, roles: ["ENGAGEMENT_LEAD", "CONSULTANT"] },
    { href: `${base}/quality`, label: "Data quality", icon: ShieldCheck, roles: ["ENGAGEMENT_LEAD", "CONSULTANT"] },
    { href: `${base}/settings`, label: "Settings", icon: Settings, roles: ["ENGAGEMENT_LEAD"] },
    { href: `${base}/config/weightings`, label: "Weightings", icon: SlidersHorizontal, roles: ["ENGAGEMENT_LEAD"] },
    { href: `${base}/config/thresholds`, label: "Thresholds", icon: Gauge, roles: ["ENGAGEMENT_LEAD"] },
    { href: `${base}/config/options`, label: "Option lists", icon: ListChecks, roles: ["ENGAGEMENT_LEAD"] },
    { href: `${base}/audit`, label: "Audit log", icon: ScrollText, roles: ["ENGAGEMENT_LEAD", "CONSULTANT"] },
  ];
}

export function SidebarNav({
  engagementId,
  role,
  defaultCollapsed,
}: {
  engagementId: string;
  role: Role;
  defaultCollapsed: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const items = navItems(engagementId).filter((item) => item.roles.includes(role));
  const configStart = items.findIndex((i) => i.label === "Settings");

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Cookie (not localStorage) so the server renders the correct width on
    // the next request — no flash of the wrong state.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <nav
      aria-label="Workspace"
      // Sticky below the h-12 header so the nav (and the collapse toggle at
      // its foot) stays visible however long the page is.
      className={`sticky top-12 flex h-[calc(100vh-3rem)] shrink-0 flex-col gap-0.5 self-start overflow-y-auto border-r bg-sidebar p-2 text-sidebar-foreground transition-[width] duration-200 ${
        collapsed ? "w-14" : "w-52"
      }`}
    >
      {items.map((item, idx) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <div key={item.href}>
            {idx === configStart && configStart >= 0 ? (
              collapsed ? (
                <div className="mx-2 my-2 border-t border-sidebar-accent" />
              ) : (
                <div className="text-muted-foreground mt-3 mb-1 px-2 text-[10px] font-semibold tracking-widest uppercase">
                  Configuration
                </div>
              )
            ) : null}
            <Link
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-sm ${
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {collapsed ? null : <span className="truncate">{item.label}</span>}
            </Link>
          </div>
        );
      })}

      <div className="mt-auto pt-2">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-4 shrink-0" /> : <PanelLeftClose className="size-4 shrink-0" />}
          {collapsed ? null : <span>Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
