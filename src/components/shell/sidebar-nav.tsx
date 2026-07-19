import Link from "next/link";
import type { Role } from "@/lib/auth/roles";

interface NavItem {
  href: string;
  label: string;
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
    { href: `${base}/dashboard`, label: "Dashboard", roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/applications`, label: "Applications", roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/surveys`, label: "Surveys", roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_RESPONDENT"] },
    { href: `${base}/capabilities`, label: "Capabilities", roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/financials`, label: "Financials", roles: ["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_VIEWER"] },
    { href: `${base}/members`, label: "Members", roles: ["ENGAGEMENT_LEAD", "CONSULTANT"] },
    { href: `${base}/quality`, label: "Data quality", roles: ["ENGAGEMENT_LEAD", "CONSULTANT"] },
    { href: `${base}/config/weightings`, label: "Weightings", roles: ["ENGAGEMENT_LEAD"] },
    { href: `${base}/config/thresholds`, label: "Thresholds", roles: ["ENGAGEMENT_LEAD"] },
    { href: `${base}/config/options`, label: "Option lists", roles: ["ENGAGEMENT_LEAD"] },
    { href: `${base}/audit`, label: "Audit log", roles: ["ENGAGEMENT_LEAD", "CONSULTANT"] },
  ];
}

export function SidebarNav({ engagementId, role }: { engagementId: string; role: Role }) {
  const items = navItems(engagementId).filter((item) => item.roles.includes(role));
  const configStart = items.findIndex((i) => i.label === "Weightings");

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r bg-sidebar p-3 text-sidebar-foreground">
      {items.map((item, idx) => (
        <div key={item.href}>
          {idx === configStart && configStart >= 0 ? (
            <div className="text-muted-foreground mt-3 mb-1 px-2 text-[10px] font-semibold tracking-widest uppercase">
              Configuration
            </div>
          ) : null}
          <Link
            href={item.href}
            className="block rounded px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {item.label}
          </Link>
        </div>
      ))}
    </nav>
  );
}
