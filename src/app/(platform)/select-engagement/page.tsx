import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/lib/db/admin";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
import { TopBar } from "@/components/shell/top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SelectEngagementPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const memberships = await listMembershipsForUser({ clerkUserId: session.userId, email: session.email });

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

        {memberships.length === 0 ? (
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
            {memberships.map((m) => (
              <Link key={m.id} href={`/e/${m.engagement.id}/dashboard`}>
                <Card className="transition-colors hover:border-brand">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <div className="font-medium">{m.engagement.name}</div>
                      <div className="text-muted-foreground text-sm">{m.engagement.clientName}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.engagement.status !== "ACTIVE" ? (
                        <Badge variant="secondary">{m.engagement.status === "ARCHIVED" ? "Archived" : "Pending purge"}</Badge>
                      ) : null}
                      <Badge variant="outline">{ROLE_LABELS[m.role as Role]}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
