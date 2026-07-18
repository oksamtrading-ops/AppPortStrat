import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TYPE_SLUGS } from "@/lib/survey-slugs";

export const dynamic = "force-dynamic";

export default async function ApplicationSurveysPage({
  params,
}: {
  params: Promise<{ engagementId: string; applicationId: string }>;
}) {
  const { engagementId, applicationId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);

  // For respondents the scoped read carries the assignment predicate — an
  // unassigned application 404s here.
  const app = await db.application.findUnique({ where: { id: applicationId }, select: { id: true, name: true, appNumber: true } });
  if (!app) notFound();

  const [templates, responses, assignments] = await Promise.all([
    db.surveyTemplate.findMany({ orderBy: { type: "asc" }, include: { _count: { select: { questions: true } } } }),
    db.surveyResponse.findMany({ where: { applicationId }, select: { templateId: true, status: true } }),
    ctx.role === "CLIENT_RESPONDENT"
      ? db.surveyAssignment.findMany({ where: { applicationId }, select: { templateId: true } })
      : Promise.resolve(null),
  ]);
  const statusByTemplate = new Map(responses.map((r) => [r.templateId, r.status]));
  const assignedTemplateIds = assignments ? new Set(assignments.map((a) => a.templateId)) : null;

  const visible = templates.filter(
    (t) => t._count.questions > 0 && (!assignedTemplateIds || assignedTemplateIds.has(t.id)),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">
          Surveys — {app.name} <span className="text-muted-foreground">#{app.appNumber}</span>
        </h1>
        <p className="text-muted-foreground text-sm">Answers autosave as you go.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((t) => {
          const status = statusByTemplate.get(t.id) ?? "NOT_STARTED";
          return (
            <Link key={t.id} href={`/e/${engagementId}/surveys/${applicationId}/${TYPE_SLUGS[t.type]}`}>
              <Card className="transition-colors hover:border-brand">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    {t.name}
                    <Badge variant={status === "COMPLETE" ? "default" : "outline"}>
                      {status === "NOT_STARTED" ? "Not started" : status === "IN_PROGRESS" ? "In progress" : "Complete"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{t._count.questions} questions</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
