import Link from "next/link";
import { requireEngagementContext } from "@/lib/auth/context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TYPE_SLUGS } from "@/lib/survey-slugs";
import { deriveSurveyStatus } from "@/lib/survey-status";
import { Button } from "@/components/ui/button";
import { assignSurveys, removeAssignment } from "./assign-actions";

export const dynamic = "force-dynamic";

export default async function SurveysPage({
  params,
  searchParams,
}: {
  params: Promise<{ engagementId: string }>;
  searchParams: Promise<{ template?: string; status?: string }>;
}) {
  const { engagementId } = await params;
  const sp = await searchParams;
  const { ctx, db } = await requireEngagementContext(engagementId);

  if (ctx.role === "CLIENT_RESPONDENT") {
    // The scoped client confines this query to the respondent's assignments.
    // The nested `responses` include is NOT predicate-scoped by the guard, so
    // it is explicitly filtered to the respondent's OWN layer row — otherwise a
    // respondent could see other respondents' / the consensus status.
    const assignments = await db.surveyAssignment.findMany({
      include: {
        application: {
          select: {
            id: true,
            name: true,
            acronym: true,
            responses: {
              where: { kind: "RESPONDENT", respondentMembershipId: ctx.membershipId },
              select: { templateId: true, status: true },
            },
          },
        },
        template: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">My surveys</h1>
          <p className="text-muted-foreground text-sm">Surveys assigned to you. Answers autosave as you go.</p>
        </div>
        {assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing assigned to you yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {assignments.map((a) => {
              const status = a.application.responses.find((r) => r.templateId === a.template.id)?.status ?? "NOT_STARTED";
              return (
                <Link key={a.id} href={`/e/${engagementId}/surveys/${a.application.id}/${TYPE_SLUGS[a.template.type]}`}>
                  <Card className="transition-colors hover:border-brand">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between text-base">
                        {a.application.name}
                        <Badge variant={status === "COMPLETE" ? "default" : "outline"}>
                          {status === "NOT_STARTED" ? "Not started" : status === "IN_PROGRESS" ? "In progress" : "Complete"}
                        </Badge>
                      </CardTitle>
                      <CardDescription>{a.template.name}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const [templates, applications, respondents, assignments] = await Promise.all([
    db.surveyTemplate.findMany({
      where: { questions: { some: {} } },
      orderBy: { type: "asc" },
      include: { _count: { select: { questions: true, responses: true, assignments: true } } },
    }),
    db.application.findMany({ orderBy: { appNumber: "asc" }, select: { id: true, name: true, appNumber: true } }),
    db.membership.findMany({ where: { role: "CLIENT_RESPONDENT" }, orderBy: { email: "asc" } }),
    db.surveyAssignment.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        application: { select: { name: true, appNumber: true } },
        membership: { select: { email: true, displayName: true } },
        template: { select: { name: true } },
      },
    }),
  ]);

  const canAssign = (ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT") && !ctx.readOnly;

  // Drill-through from the dashboard "Data confidence" card: the in-scope apps
  // and their status for one survey, defaulting to the outstanding (not-complete)
  // ones. templates is scoped to this engagement, so an unknown id resolves to no card.
  const focusTemplate = sp.template ? templates.find((t) => t.id === sp.template) : undefined;
  const outstandingOnly = sp.status === "incomplete";
  const focusApps = focusTemplate
    ? (
        await db.application.findMany({
          where: { inScope: true },
          orderBy: { appNumber: "asc" },
          select: {
            id: true,
            name: true,
            appNumber: true,
            responses: {
              where: { templateId: focusTemplate.id },
              select: { kind: true, status: true, finalizedAt: true },
            },
          },
        })
      )
        .map((a) => ({
          id: a.id,
          name: a.name,
          appNumber: a.appNumber,
          // Derived across the layers (consensus ?? all-respondents-complete).
          status: deriveSurveyStatus(a.responses.map((r) => ({ kind: r.kind, status: r.status, finalized: r.finalizedAt != null }))),
        }))
        .filter((a) => (outstandingOnly ? a.status !== "COMPLETE" : true))
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Surveys</h1>
        <p className="text-muted-foreground text-sm">
          Open any application&apos;s surveys from the inventory grid (workshop mode), or assign them to Client
          Respondents below.
        </p>
      </div>

      {focusTemplate && focusApps ? (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>
                {focusTemplate.name} — {outstandingOnly ? "outstanding" : "all in-scope apps"}
              </CardTitle>
              <CardDescription>
                {focusApps.length} in-scope application{focusApps.length === 1 ? "" : "s"}
                {outstandingOnly ? " not yet complete" : ""}
              </CardDescription>
            </div>
            <Link href={`/e/${engagementId}/surveys`} className="text-muted-foreground text-xs hover:underline">
              clear
            </Link>
          </CardHeader>
          <CardContent>
            {focusApps.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing outstanding — every in-scope app has this survey complete.
              </p>
            ) : (
              <ul className="divide-y">
                {focusApps.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                    <Link
                      href={`/e/${engagementId}/surveys/${a.id}/${TYPE_SLUGS[focusTemplate.type]}`}
                      className="font-medium hover:underline"
                    >
                      #{a.appNumber} {a.name}
                    </Link>
                    <Badge variant={a.status === "COMPLETE" ? "default" : "outline"}>
                      {a.status === "NOT_STARTED" ? "Not started" : a.status === "IN_PROGRESS" ? "In progress" : "Complete"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-sm">{t.name}</CardTitle>
              <CardDescription className="flex flex-wrap gap-1">
                <Badge variant="outline">{t._count.questions} questions</Badge>
                <Badge variant="outline">{t._count.responses} responses</Badge>
              </CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {canAssign ? (
        <Card>
          <CardHeader>
            <CardTitle>Assign surveys</CardTitle>
            <CardDescription>
              {respondents.length === 0
                ? "Invite a Client Respondent on the Members page first."
                : "Pick an application, the surveys, and the Client Respondent who should fill them in."}
            </CardDescription>
          </CardHeader>
          {respondents.length > 0 ? (
            <CardContent>
              <form action={assignSurveys} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="engagementId" value={engagementId} />
                <div className="space-y-1">
                  <div className="text-xs font-medium">Application</div>
                  <select name="applicationId" required className="h-9 w-64 rounded-md border bg-background px-2 text-sm">
                    {applications.map((a) => (
                      <option key={a.id} value={a.id}>
                        #{a.appNumber} — {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium">Surveys</div>
                  <div className="flex gap-3 rounded-md border px-3 py-2">
                    {templates.map((t) => (
                      <label key={t.id} className="flex items-center gap-1 text-sm">
                        <input type="checkbox" name="templateIds" value={t.id} defaultChecked />
                        {t.name.replace(" Survey", "")}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs font-medium">Respondent</div>
                  <select name="membershipId" required className="h-9 w-56 rounded-md border bg-background px-2 text-sm">
                    {respondents.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.displayName ?? r.email}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit">Assign</Button>
              </form>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Current assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No surveys assigned yet.</p>
          ) : (
            <ul className="divide-y">
              {assignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    <span className="font-medium">
                      #{a.application.appNumber} {a.application.name}
                    </span>{" "}
                    · {a.template.name} → {a.membership.displayName ?? a.membership.email}
                  </span>
                  {canAssign ? (
                    <form action={removeAssignment}>
                      <input type="hidden" name="engagementId" value={engagementId} />
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground h-6 px-2 text-xs">
                        Remove
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
