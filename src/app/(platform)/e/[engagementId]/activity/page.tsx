import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

/** Human-readable feed over the audit trail — "what happened while I was away". */
const FRIENDLY: Record<string, string> = {
  "engagement.create": "created the engagement",
  "engagement.settingsUpdate": "updated the engagement details",
  "engagement.aiToggle": "changed the AI features setting",
  "threshold.update": "updated thresholds",
  "weighting.update": "updated question weightings",
  "application.create": "added an application",
  "application.update": "updated an application",
  "application.delete": "deleted an application",
  "application.import": "imported applications",
  "override.set": "overrode a disposition",
  "override.clear": "cleared a disposition override",
  "capability.paste": "imported capabilities",
  "capability.delete": "deleted a capability",
  "capability.libraryImport": "started the capability model from a library pack",
  "capability.libraryPromote": "promoted the capability model to the library",
  "survey.answer": "updated survey answers",
  "survey.status": "changed a survey status",
  "assignment.create": "assigned surveys",
  "comment.add": "commented",
  "task.create": "created a task",
  "disposition.signoff.record": "recorded a disposition sign-off",
  "disposition.signoff.revoke": "revoked a disposition sign-off",
  "task.complete": "completed a task",
  "task.reopen": "reopened a task",
  "ai.narrative.generate": "generated an AI narrative",
  "ai.report.generate": "generated the AI final report",
  "ai.import.extract": "ran an AI import extraction",
  "ai.import.accept": "accepted AI-imported applications",
  "ai.capabilityMap.suggest": "requested AI capability mappings",
  "ai.capabilityMap.accept": "accepted AI capability mappings",
  "ai.quality.check": "ran AI quality checks",
  "ai.qa.ask": "asked the portfolio Q&A",
};

export default async function ActivityPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId, "CONSULTANT");
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const events = await db.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const byDay = new Map<string, typeof events>();
  for (const e of events) {
    const day = e.createdAt.toISOString().slice(0, 10);
    (byDay.get(day) ?? byDay.set(day, []).get(day)!).push(e);
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground text-sm">
          The engagement&apos;s recent history, readably — the audit log keeps the forensic detail.
        </p>
      </div>
      {events.length === 0 ? <p className="text-muted-foreground text-sm">No activity yet.</p> : null}
      {[...byDay.entries()].map(([day, dayEvents]) => (
        <div key={day} className="space-y-1.5">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">{day}</h2>
          {dayEvents.map((e) => (
            <div key={e.id} className="flex items-baseline gap-2 text-sm">
              <span className="text-muted-foreground w-12 shrink-0 text-xs tabular-nums">
                {e.createdAt.toISOString().slice(11, 16)}
              </span>
              <span>
                <span className="font-medium">{e.actorDisplay}</span>{" "}
                {FRIENDLY[e.action] ?? `${e.action.replace(/[.]/g, ": ")}`}
                {e.entityType === "Application" && typeof (e.after as Record<string, unknown>)?.name === "string" ? (
                  <span className="text-muted-foreground"> — {String((e.after as Record<string, unknown>).name)}</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
