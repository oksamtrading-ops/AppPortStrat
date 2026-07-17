import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { adminDb, listMembershipsForUser } from "@/lib/db/admin";
import { mapClerkOrgRole, ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { TopBar } from "@/components/shell/top-bar";
import { EngagementLink } from "@/components/shell/engagement-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface EngagementEntry {
  id: string;
  name: string;
  clientName: string;
  status: string;
  clerkOrgId: string | null;
  roleLabel: string;
}

/**
 * Clerk mode: the user's org memberships from the Clerk Backend API are the
 * authority (local Membership rows are created lazily on first entry, so a
 * fresh engagement has none yet). Dev mode: seeded local rows.
 */
async function listEngagements(session: NonNullable<Awaited<ReturnType<typeof getSession>>>): Promise<EngagementEntry[]> {
  if (session.mode === "clerk") {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const memberships = await client.users.getOrganizationMembershipList({ userId: session.userId, limit: 100 });
    const roleByOrgId = new Map(memberships.data.map((m) => [m.organization.id, m.role]));
    if (roleByOrgId.size === 0) return [];
    const engagements = await adminDb().engagement.findMany({
      where: { clerkOrgId: { in: [...roleByOrgId.keys()] } },
      orderBy: { createdAt: "desc" },
    });
    return engagements.map((e) => {
      const orgRole = roleByOrgId.get(e.clerkOrgId!) ?? null;
      const mapped = mapClerkOrgRole(orgRole);
      return {
        id: e.id,
        name: e.name,
        clientName: e.clientName,
        status: e.status,
        clerkOrgId: e.clerkOrgId,
        roleLabel: mapped ? ROLE_LABELS[mapped] : (orgRole ?? "No mapped role"),
      };
    });
  }

  const memberships = await listMembershipsForUser({ clerkUserId: session.userId, email: session.email });
  return memberships.map((m) => ({
    id: m.engagement.id,
    name: m.engagement.name,
    clientName: m.engagement.clientName,
    status: m.engagement.status,
    clerkOrgId: null,
    roleLabel: ROLE_LABELS[m.role as Role],
  }));
}

export default async function SelectEngagementPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const engagements = await listEngagements(session);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar session={session} />
      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Your engagements</h1>
            <p className="text-muted-foreground text-sm">Select a workspace to continue.</p>
          </div>
          {session.isPlatformAdmin ? (
            <Button asChild variant="outline">
              <Link href="/admin/engagements">Platform admin</Link>
            </Button>
          ) : null}
        </div>

        {engagements.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No engagements yet</CardTitle>
              <CardDescription>
                {session.isPlatformAdmin
                  ? "Create an engagement from the platform admin screen."
                  : "Ask your engagement lead for an invitation."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3">
            {engagements.map((e) => (
              <EngagementLink key={e.id} engagementId={e.id} clerkOrgId={e.clerkOrgId} className="block w-full text-left">
                <Card className="transition-colors hover:border-brand">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <div className="font-medium">{e.name}</div>
                      <div className="text-muted-foreground text-sm">{e.clientName}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {e.status !== "ACTIVE" ? (
                        <Badge variant="secondary">{e.status === "ARCHIVED" ? "Archived" : "Pending purge"}</Badge>
                      ) : null}
                      <Badge variant="outline">{e.roleLabel}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </EngagementLink>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
