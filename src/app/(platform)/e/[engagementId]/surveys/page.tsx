import Link from "next/link";
import { requireEngagementContext } from "@/lib/auth/context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TYPE_SLUGS } from "@/lib/survey-slugs";

export const dynamic = "force-dynamic";

export default async function SurveysPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);

  if (ctx.role === "CLIENT_RESPONDENT") {
    // The scoped client confines this query to the respondent's assignments.
    const assignments = await db.surveyAssignment.findMany({
      include: {
        application: { select: { id: true, name: true, acronym: true, responses: { select: { templateId: true, status: true } } } },
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

  const templates = await db.surveyTemplate.findMany({
    orderBy: { type: "asc" },
    include: { _count: { select: { questions: true, responses: true, assignments: true } } },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Surveys</h1>
        <p className="text-muted-foreground text-sm">
          Question banks are seeded per engagement. Guided forms, assignment flow, and autosave arrive in Phase 3.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardHeader>
              <CardTitle className="text-base">{t.name}</CardTitle>
              <CardDescription className="flex gap-2">
                <Badge variant="outline">{t._count.questions} questions</Badge>
                <Badge variant="outline">{t._count.responses} responses</Badge>
                <Badge variant="outline">{t._count.assignments} assignments</Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              {t._count.questions === 0 ? "Question set arrives in Phase 3." : "Ready for Phase 3 survey forms."}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
