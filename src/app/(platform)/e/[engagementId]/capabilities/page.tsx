import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function CapabilitiesPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const nodes = await db.capabilityNode.findMany({ orderBy: { name: "asc" } });
  const l0s = nodes.filter((n) => n.level === "L0");
  const childrenOf = (parentId: string) => nodes.filter((n) => n.parentId === parentId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Capability model</h1>
        <p className="text-muted-foreground text-sm">
          L0 → L1 → L2 hierarchy. Tree editing, Excel paste-import, and the disposition heat map arrive in
          Phases 3–4.
        </p>
      </div>
      {l0s.length === 0 ? (
        <p className="text-muted-foreground text-sm">No capability model yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {l0s.map((l0) => (
            <Card key={l0.id}>
              <CardHeader>
                <CardTitle className="text-base">
                  {l0.name}
                  {l0.isPlaceholder ? <span className="text-muted-foreground"> (unassigned)</span> : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {childrenOf(l0.id).map((l1) => (
                    <li key={l1.id}>
                      <div className="text-sm font-medium">{l1.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {childrenOf(l1.id)
                          .map((l2) => l2.name)
                          .join(" · ") || "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
