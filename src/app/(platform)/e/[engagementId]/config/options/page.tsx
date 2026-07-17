import { requireEngagementContext } from "@/lib/auth/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addOptionItem, removeOptionItem } from "./actions";

export const dynamic = "force-dynamic";

export default async function OptionsPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const { ctx, db } = await requireEngagementContext(engagementId, "ENGAGEMENT_LEAD");

  const lists = await db.optionList.findMany({
    orderBy: { key: "asc" },
    include: { items: { orderBy: { orderIndex: "asc" } } },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Option lists</h1>
        <p className="text-muted-foreground text-sm">
          Configurable dropdown values for this engagement (pre-seeded with the workbook defaults). The action
          plan list ships as an editable example from the legacy tool.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {lists.map((list) => (
          <Card key={list.id}>
            <CardHeader>
              <CardTitle className="text-base">{list.name}</CardTitle>
              <CardDescription className="font-mono text-xs">{list.key}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {list.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">No values yet.</p>
              ) : (
                <ul className="space-y-1">
                  {list.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{item.value}</span>
                      {!ctx.readOnly ? (
                        <form action={removeOptionItem}>
                          <input type="hidden" name="engagementId" value={engagementId} />
                          <input type="hidden" name="itemId" value={item.id} />
                          <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground h-6 px-2 text-xs">
                            Remove
                          </Button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {!ctx.readOnly ? (
                <form action={addOptionItem} className="flex gap-2">
                  <input type="hidden" name="engagementId" value={engagementId} />
                  <input type="hidden" name="optionListId" value={list.id} />
                  <Input name="value" placeholder="Add a value…" className="h-8" required />
                  <Button type="submit" size="sm" variant="outline">
                    Add
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
