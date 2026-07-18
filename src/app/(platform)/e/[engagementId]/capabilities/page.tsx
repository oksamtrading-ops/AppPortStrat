import { redirect } from "next/navigation";
import { requireEngagementContext } from "@/lib/auth/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addCapabilityNode, deleteCapabilityNode, pasteCapabilities, renameCapabilityNode } from "./actions";

export const dynamic = "force-dynamic";

export default async function CapabilitiesPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId);
  if (ctx.role === "CLIENT_RESPONDENT") redirect(`/e/${engagementId}/surveys`);

  const [nodes, appCounts] = await Promise.all([
    db.capabilityNode.findMany({ orderBy: [{ isPlaceholder: "asc" }, { name: "asc" }] }),
    db.application.groupBy({ by: ["capabilityNodeId"], _count: { _all: true } }),
  ]);
  const countByNode = new Map(appCounts.map((g) => [g.capabilityNodeId, g._count._all]));
  const l0s = nodes.filter((n) => n.level === "L0");
  const childrenOf = (parentId: string) => nodes.filter((n) => n.parentId === parentId);

  const canEdit = (ctx.role === "ENGAGEMENT_LEAD" || ctx.role === "CONSULTANT") && !ctx.readOnly;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Capability model</h1>
        <p className="text-muted-foreground text-sm">
          L0 → L1 → L2 hierarchy. Deduplication is automatic and continuous — there is no “refresh” button.
        </p>
      </div>

      {canEdit ? (
        <Card>
          <CardHeader>
            <CardTitle>Paste from Excel</CardTitle>
            <CardDescription>
              Paste the denormalized three-column table (L0, L1, L2 — tab-separated, straight from Excel).
              Blank L0/L1 cells become explicit “Unassigned” placeholders you can rename later. Merging is
              additive; nothing is deleted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={pasteCapabilities} className="space-y-2">
              <input type="hidden" name="engagementId" value={engagementId} />
              <textarea
                name="text"
                required
                placeholder={"Operations\tFinance\tGeneral Ledger\nOperations\tFinance\tAccounts Payable"}
                className="min-h-28 w-full rounded-md border bg-background p-2 font-mono text-xs"
              />
              <Button type="submit" size="sm">
                Merge into model
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {canEdit ? (
        <form action={addCapabilityNode} className="flex items-end gap-2">
          <input type="hidden" name="engagementId" value={engagementId} />
          <div className="space-y-1">
            <Input name="name" placeholder="New L0 capability…" required className="h-8 w-64" />
          </div>
          <Button type="submit" size="sm" variant="outline">
            Add L0
          </Button>
        </form>
      ) : null}

      {l0s.length === 0 ? (
        <p className="text-muted-foreground text-sm">No capability model yet — paste one above or add L0 nodes.</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {l0s.map((l0) => (
            <Card key={l0.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>
                    {l0.name}
                    {l0.isPlaceholder ? (
                      <Badge variant="secondary" className="ml-2">
                        placeholder — resolve
                      </Badge>
                    ) : null}
                  </span>
                  {canEdit ? <NodeActions engagementId={engagementId} nodeId={l0.id} name={l0.name} /> : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {childrenOf(l0.id).map((l1) => (
                  <div key={l1.id} className="rounded-md border p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        {l1.name}
                        {l1.isPlaceholder ? (
                          <Badge variant="secondary" className="ml-2">
                            placeholder
                          </Badge>
                        ) : null}
                      </span>
                      {canEdit ? <NodeActions engagementId={engagementId} nodeId={l1.id} name={l1.name} /> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {childrenOf(l1.id).map((l2) => {
                        const appCount = countByNode.get(l2.id) ?? 0;
                        return (
                          <span key={l2.id} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs">
                            {l2.name}
                            {appCount > 0 ? <span className="text-muted-foreground">({appCount})</span> : null}
                            {canEdit ? (
                              <form action={deleteCapabilityNode} className="inline">
                                <input type="hidden" name="engagementId" value={engagementId} />
                                <input type="hidden" name="nodeId" value={l2.id} />
                                <button type="submit" className="text-muted-foreground hover:text-destructive" title="Delete">
                                  ×
                                </button>
                              </form>
                            ) : null}
                          </span>
                        );
                      })}
                      {canEdit ? (
                        <form action={addCapabilityNode} className="inline-flex items-center gap-1">
                          <input type="hidden" name="engagementId" value={engagementId} />
                          <input type="hidden" name="parentId" value={l1.id} />
                          <Input name="name" placeholder="Add L2…" className="h-6 w-28 text-xs" required />
                          <Button type="submit" size="sm" variant="ghost" className="h-6 px-1 text-xs">
                            +
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ))}
                {canEdit ? (
                  <form action={addCapabilityNode} className="flex items-center gap-2">
                    <input type="hidden" name="engagementId" value={engagementId} />
                    <input type="hidden" name="parentId" value={l0.id} />
                    <Input name="name" placeholder="Add L1 capability…" className="h-7 w-48 text-sm" required />
                    <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
                      Add L1
                    </Button>
                  </form>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NodeActions({ engagementId, nodeId, name }: { engagementId: string; nodeId: string; name: string }) {
  return (
    <span className="flex items-center gap-1">
      <form action={renameCapabilityNode} className="inline-flex items-center gap-1">
        <input type="hidden" name="engagementId" value={engagementId} />
        <input type="hidden" name="nodeId" value={nodeId} />
        <Input name="name" defaultValue={name} className="h-6 w-36 text-xs" />
        <Button type="submit" size="sm" variant="ghost" className="h-6 px-1.5 text-xs">
          Rename
        </Button>
      </form>
      <form action={deleteCapabilityNode} className="inline">
        <input type="hidden" name="engagementId" value={engagementId} />
        <input type="hidden" name="nodeId" value={nodeId} />
        <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground h-6 px-1.5 text-xs">
          Delete
        </Button>
      </form>
    </span>
  );
}
