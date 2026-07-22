import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createTask, toggleTask } from "./actions";

export const dynamic = "force-dynamic";

/** Follow-ups from workshops: assignable, due-dated, checked off in place. */
export default async function TasksPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId, "CONSULTANT");
  if (ctx.readOnly) redirect(`/e/${engagementId}/dashboard`);

  const [tasks, apps, members] = await Promise.all([
    db.task.findMany({
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      include: {
        application: { select: { id: true, name: true } },
        assignee: { select: { id: true, displayName: true, email: true } },
      },
    }),
    db.application.findMany({ where: { inScope: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.membership.findMany({
      where: { role: { in: ["ENGAGEMENT_LEAD", "CONSULTANT"] } },
      select: { id: true, displayName: true, email: true },
    }),
  ]);

  const mine = tasks.filter((t) => t.status === "OPEN" && t.assigneeMembershipId === ctx.membershipId);
  const open = tasks.filter((t) => t.status === "OPEN" && t.assigneeMembershipId !== ctx.membershipId);
  const done = tasks.filter((t) => t.status === "DONE").slice(0, 20);
  const today = formatDate(new Date());

  const row = (t: (typeof tasks)[number]) => {
    const overdue = t.status === "OPEN" && t.dueDate && formatDate(t.dueDate) < today;
    return (
      <div key={t.id} className="flex items-center gap-3 rounded border px-3 py-2 text-sm">
        <form action={toggleTask}>
          <input type="hidden" name="engagementId" value={engagementId} />
          <input type="hidden" name="taskId" value={t.id} />
          <button
            type="submit"
            aria-label={t.status === "OPEN" ? "Mark done" : "Reopen"}
            className={`size-4 rounded border ${t.status === "DONE" ? "bg-brand border-brand" : "hover:border-foreground"}`}
          />
        </form>
        <span className={`flex-1 ${t.status === "DONE" ? "text-muted-foreground line-through" : ""}`}>{t.title}</span>
        {t.application ? (
          <Link href={`/e/${engagementId}/applications/${t.application.id}/edit`} className="text-muted-foreground text-xs hover:underline">
            {t.application.name}
          </Link>
        ) : null}
        {t.assignee ? <span className="text-muted-foreground text-xs">{t.assignee.displayName ?? t.assignee.email}</span> : null}
        {t.dueDate ? (
          <span className={`text-xs tabular-nums ${overdue ? "font-medium text-red-600" : "text-muted-foreground"}`}>
            {formatDate(t.dueDate)}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-muted-foreground text-sm">Follow-ups and action items — team-internal, never visible to clients.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New task</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createTask} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input type="hidden" name="engagementId" value={engagementId} />
            <div className="md:col-span-2">
              <Input name="title" required maxLength={300} placeholder="e.g. Validate GL decommission date with finance" />
            </div>
            <select name="applicationId" defaultValue="" className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">No application</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select name="assigneeMembershipId" defaultValue="" className="h-9 rounded-md border bg-background px-2 text-sm">
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName ?? m.email}</option>
              ))}
            </select>
            <input type="date" name="dueDate" className="h-9 rounded-md border bg-background px-2 text-sm" />
            <div>
              <Button type="submit">Add task</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {mine.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">My open tasks ({mine.length})</h2>
          {mine.map(row)}
        </div>
      ) : null}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Open ({open.length})</h2>
        {open.length === 0 ? <p className="text-muted-foreground text-sm">Nothing open.</p> : open.map(row)}
      </div>
      {done.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-semibold">Recently completed</h2>
          {done.map(row)}
        </div>
      ) : null}
    </div>
  );
}
