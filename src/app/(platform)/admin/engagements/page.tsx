import { requirePlatformAdmin } from "@/lib/auth/context";
import { adminDb } from "@/lib/db/admin";
import { TopBar } from "@/components/shell/top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createEngagementAction, setEngagementStatusAction } from "./actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  ACTIVE: { label: "Active", variant: "default" },
  ARCHIVED: { label: "Archived", variant: "secondary" },
  PENDING_PURGE: { label: "Pending purge", variant: "destructive" },
};

export default async function AdminEngagementsPage() {
  const session = await requirePlatformAdmin();
  const engagements = await adminDb().engagement.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { applications: true, memberships: true } } },
  });

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar session={session} subtitle="Platform administration" />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Create engagement</CardTitle>
            <CardDescription>
              Each engagement is an isolated client workspace. Configuration can start from tool defaults, the
              APS 5.0 sample weighting config, or be cloned (config only — never data) from a prior engagement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createEngagementAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="name">Engagement name</Label>
                <Input id="name" name="name" required placeholder="Contoso App Rationalization FY26" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="clientName">Client</Label>
                <Input id="clientName" name="clientName" required placeholder="Contoso Ltd." />
              </div>
              <div className="space-y-1">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" name="currency" defaultValue="USD" maxLength={3} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fiscalYearConvention">Fiscal year convention</Label>
                <Input id="fiscalYearConvention" name="fiscalYearConvention" defaultValue="FY" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="source">Starting configuration</Label>
                <select
                  id="source"
                  name="source"
                  defaultValue="defaults"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                >
                  <option value="defaults">Tool defaults (all questions “Normal”)</option>
                  <option value="aps50">APS 5.0 sample weighting config</option>
                  <option value="clone">Clone configuration from a prior engagement</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="sourceEngagementId">Clone source (if cloning)</Label>
                <select
                  id="sourceEngagementId"
                  name="sourceEngagementId"
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  defaultValue=""
                >
                  <option value="">—</option>
                  {engagements.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Button type="submit">Create engagement</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Engagements</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Apps</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>Lifecycle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {engagements.map((e) => {
                  const badge = STATUS_BADGE[e.status];
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <Link href={`/e/${e.id}/dashboard`} className="font-medium hover:underline">
                          {e.name}
                        </Link>
                      </TableCell>
                      <TableCell>{e.clientName}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{e._count.applications}</TableCell>
                      <TableCell className="text-right">{e._count.memberships}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {e.status === "ACTIVE" ? (
                            <LifecycleButton engagementId={e.id} transition="archive" label="Archive" />
                          ) : null}
                          {e.status === "ARCHIVED" ? (
                            <>
                              <LifecycleButton engagementId={e.id} transition="reactivate" label="Reactivate" />
                              <LifecycleButton engagementId={e.id} transition="schedulePurge" label="Schedule purge" />
                            </>
                          ) : null}
                          {e.status === "PENDING_PURGE" ? (
                            <LifecycleButton engagementId={e.id} transition="cancelPurge" label="Cancel purge" />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-muted-foreground mt-3 text-xs">
              Purge is two-phase: scheduling makes the engagement read-only for a 7-day grace period; the
              destructive final step ships together with the full-dataset export (Phase 5) so an export always
              precedes deletion.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function LifecycleButton({
  engagementId,
  transition,
  label,
}: {
  engagementId: string;
  transition: string;
  label: string;
}) {
  return (
    <form action={setEngagementStatusAction}>
      <input type="hidden" name="engagementId" value={engagementId} />
      <input type="hidden" name="transition" value={transition} />
      <Button type="submit" size="sm" variant="outline" className="h-7 px-2 text-xs">
        {label}
      </Button>
    </form>
  );
}
