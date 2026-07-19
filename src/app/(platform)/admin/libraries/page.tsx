import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/auth/context";
import { listCapabilityLibrariesWithNodes } from "@/lib/db/library";
import { TopBar } from "@/components/shell/top-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createLibraryFromPasteAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Capability reference library curation (Platform Admin). Packs are immutable
 * snapshots — edits ship as new versions (via this paste form or an
 * Engagement Lead promoting a refined tree).
 */
export default async function AdminLibrariesPage() {
  const session = await requirePlatformAdmin();
  const libraries = await listCapabilityLibrariesWithNodes();

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar session={session} subtitle="Capability reference library" />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Capability reference library</h1>
            <p className="text-muted-foreground text-sm">
              Industry starting-point capability maps. Engagements clone a pack, then refine it with the client.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/admin/engagements">← Engagements</Link>
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create a pack</CardTitle>
            <CardDescription>
              Paste a three-column L0/L1/L2 table (or a LeanIX-style export with Level or Name+Parent columns).
              Re-using an existing industry + name creates the next version. Only paste content you have the right
              to redistribute — never a vendor&apos;s licensed catalog.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createLibraryFromPasteAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="industry">Industry</Label>
                <Input id="industry" name="industry" required placeholder="Banking" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="name">Pack name</Label>
                <Input id="name" name="name" required placeholder="Banking Starter" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" placeholder="One-line summary shown to consultants" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="text">Capability table</Label>
                <textarea
                  id="text"
                  name="text"
                  required
                  placeholder={"Operations\tFinance\tGeneral Ledger\nOperations\tFinance\tAccounts Payable"}
                  className="min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs"
                />
              </div>
              <div className="md:col-span-2">
                <Button type="submit">Create pack version</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {libraries.map((l) => (
            <details key={l.id} className="rounded-xl border bg-card p-4">
              <summary className="cursor-pointer">
                <span className="font-medium">
                  {l.industry} — {l.name}
                </span>{" "}
                <span className="text-muted-foreground text-sm">
                  v{l.version} · {l.nodes.length} capabilities
                  {l.createdBy ? ` · by ${l.createdBy}` : ""} · {l.createdAt.toISOString().slice(0, 10)}
                </span>
              </summary>
              {l.attribution ? <p className="text-muted-foreground mt-2 text-xs">{l.attribution}</p> : null}
              <ul className="mt-3 space-y-0.5 text-sm">
                {l.nodes
                  .filter((n) => n.level === "L0")
                  .map((l0) => (
                    <li key={l0.id}>
                      <span className="font-medium">{l0.name}</span>
                      <ul className="ml-4">
                        {l.nodes
                          .filter((n) => n.parentId === l0.id)
                          .map((l1) => (
                            <li key={l1.id}>
                              {l1.name}
                              {(() => {
                                const l2s = l.nodes.filter((n) => n.parentId === l1.id);
                                return l2s.length > 0 ? (
                                  <span className="text-muted-foreground"> — {l2s.map((n) => n.name).join(" · ")}</span>
                                ) : null;
                              })()}
                            </li>
                          ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </details>
          ))}
          {libraries.length === 0 ? <p className="text-muted-foreground text-sm">No packs yet — run the reference seed or create one above.</p> : null}
        </div>
      </main>
    </div>
  );
}
