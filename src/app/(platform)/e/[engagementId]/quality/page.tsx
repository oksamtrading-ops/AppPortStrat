import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";

export const dynamic = "force-dynamic";

/** Data-quality panel (APP-SPEC §4.14): what's missing before the analysis is defensible. */
export default async function QualityPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId, "CONSULTANT");
  if (ctx.readOnly && ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [apps, placeholderNodes, optionLists, assignedAppIds] = await Promise.all([
    db.application.findMany({
      select: {
        id: true,
        appNumber: true,
        name: true,
        inScope: true,
        isUtilized: true,
        capabilityNodeId: true,
        applicationType: true,
        actionPlanAssignment: true,
        result: { select: { computedDisposition: true, itPartial: true, bvPartial: true } },
        responses: { select: { status: true, template: { select: { type: true } } } },
      },
      orderBy: { appNumber: "asc" },
    }),
    db.capabilityNode.findMany({ where: { isPlaceholder: true }, select: { id: true, level: true, name: true } }),
    db.optionList.findMany({ include: { items: { select: { value: true } } } }),
    db.surveyAssignment.findMany({ select: { applicationId: true }, distinct: ["applicationId"] }),
  ]);

  const pool = apps.filter((a) => a.inScope && a.isUtilized);
  const unmapped = pool.filter((a) => !a.capabilityNodeId);
  const unscored = pool.filter((a) => (a.result?.computedDisposition ?? "UNKNOWN") === "UNKNOWN");
  const partial = pool.filter((a) => a.result?.itPartial || a.result?.bvPartial);
  const assignedSet = new Set(assignedAppIds.map((a) => a.applicationId));
  const noSurveyPath = pool.filter(
    (a) => !assignedSet.has(a.id) && !a.responses.some((r) => r.status !== "NOT_STARTED"),
  );

  const listValues = new Map(optionLists.map((l) => [l.key, new Set(l.items.map((i) => i.value))]));
  const orphanValues: Array<{ app: (typeof apps)[number]; field: string; value: string }> = [];
  for (const app of apps) {
    if (app.applicationType && !listValues.get("applicationType")?.has(app.applicationType)) {
      orphanValues.push({ app, field: "Application type", value: app.applicationType });
    }
    if (app.actionPlanAssignment && !listValues.get("actionPlanAssignment")?.has(app.actionPlanAssignment)) {
      orphanValues.push({ app, field: "Action plan", value: app.actionPlanAssignment });
    }
  }

  const sections: Array<{
    title: string;
    description: string;
    count: number;
    items: Array<{ key: string; label: string; href: string }>;
  }> = [
    {
      title: "Applications without a capability mapping",
      description: "These apps are invisible on the heat map.",
      count: unmapped.length,
      items: unmapped.map((a) => ({
        key: a.id,
        label: `#${a.appNumber} ${a.name}`,
        href: `/e/${engagementId}/applications/${a.id}/edit`,
      })),
    },
    {
      title: "In-scope applications still unscored (Unknown)",
      description: "IT Health or Business Value surveys have no weighted answers yet.",
      count: unscored.length,
      items: unscored.map((a) => ({
        key: a.id,
        label: `#${a.appNumber} ${a.name}`,
        href: `/e/${engagementId}/surveys/${a.id}`,
      })),
    },
    {
      title: "Scores computed from partial surveys",
      description: "Renormalized over answered questions only — flagged ⚠ on the grid.",
      count: partial.length,
      items: partial.map((a) => ({
        key: a.id,
        label: `#${a.appNumber} ${a.name}`,
        href: `/e/${engagementId}/surveys/${a.id}`,
      })),
    },
    {
      title: "No survey activity or assignments",
      description: "Nobody is assigned and nothing has been filled in.",
      count: noSurveyPath.length,
      items: noSurveyPath.map((a) => ({
        key: a.id,
        label: `#${a.appNumber} ${a.name}`,
        href: `/e/${engagementId}/surveys`,
      })),
    },
    {
      title: "Placeholder capability nodes to resolve",
      description: 'Created by imports for blank L0/L1 cells — rename them to real capabilities.',
      count: placeholderNodes.length,
      items: placeholderNodes.map((n) => ({
        key: n.id,
        label: `${n.level} · ${n.name}`,
        href: `/e/${engagementId}/capabilities`,
      })),
    },
    {
      title: "Values missing from their option lists",
      description: "Imported or renamed values that no longer match a configured option.",
      count: orphanValues.length,
      items: orphanValues.map((o) => ({
        key: `${o.app.id}:${o.field}`,
        label: `#${o.app.appNumber} ${o.app.name} — ${o.field}: "${o.value}"`,
        href: `/e/${engagementId}/config/options`,
      })),
    },
  ];

  const clean = sections.every((s) => s.count === 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Data quality</h1>
        <p className="text-muted-foreground text-sm">
          Gaps that weaken the analysis, with a path to fix each one.
        </p>
      </div>

      {clean ? <Pill color="green">All checks pass — the dataset is analysis-ready.</Pill> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {sections
          .filter((s) => s.count > 0)
          .map((section) => (
            <Card key={section.title}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {section.title}
                  <Pill color={section.count > 0 ? "amber" : "green"} dot={false}>
                    {section.count}
                  </Pill>
                </CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {section.items.map((item) => (
                    <li key={item.key}>
                      <Link href={item.href} className="text-sm hover:underline">
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
