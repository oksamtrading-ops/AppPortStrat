import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { ROLE_LABELS, type Role } from "@/lib/auth/roles";
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
import { inviteMember, removeMember } from "./actions";

export const dynamic = "force-dynamic";

export default async function MembersPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db, session } = await requireEngagementContext(engagementId, "CONSULTANT");
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const members = await db.membership.findMany({
    orderBy: [{ role: "asc" }, { email: "asc" }],
    include: { _count: { select: { assignments: true } } },
  });

  const isLead = ctx.role === "ENGAGEMENT_LEAD" && !ctx.readOnly;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Members</h1>
        <p className="text-muted-foreground text-sm">
          Everyone with access to this engagement. Client Respondents see only their assigned surveys.
        </p>
      </div>

      {isLead ? (
        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>
              {session.mode === "clerk"
                ? "Clerk emails them a join link; their access activates when they accept. Survey assignments can be made immediately."
                : "Dev mode has fixed identities — invitations only create the local membership row."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={inviteMember} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="engagementId" value={engagementId} />
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required placeholder="sme@client.com" className="w-64" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="displayName">Name (optional)</Label>
                <Input id="displayName" name="displayName" className="w-48" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="role">Role</Label>
                <select id="role" name="role" defaultValue="CLIENT_RESPONDENT" className="h-9 rounded-md border bg-background px-2 text-sm">
                  <option value="CLIENT_RESPONDENT">Client Respondent</option>
                  <option value="CLIENT_VIEWER">Client Viewer</option>
                  <option value="CONSULTANT">Consultant</option>
                  <option value="ENGAGEMENT_LEAD">Engagement Lead</option>
                </select>
              </div>
              <Button type="submit">Invite</Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Assignments</TableHead>
            {isLead ? <TableHead /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <div className="font-medium">{m.displayName ?? m.email}</div>
                <div className="text-muted-foreground text-xs">{m.email}</div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{ROLE_LABELS[m.role as Role]}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {m.clerkUserId ? "Active" : session.mode === "clerk" ? "Invited — pending" : "Seeded"}
              </TableCell>
              <TableCell className="text-right tabular-nums">{m._count.assignments}</TableCell>
              {isLead ? (
                <TableCell className="text-right">
                  {m.id !== ctx.membershipId ? (
                    <form action={removeMember}>
                      <input type="hidden" name="engagementId" value={engagementId} />
                      <input type="hidden" name="membershipId" value={m.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground h-6 px-2 text-xs">
                        Remove
                      </Button>
                    </form>
                  ) : null}
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
