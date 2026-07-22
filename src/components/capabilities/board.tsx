"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import {
  addCapabilityNode,
  deleteCapabilityNode,
  moveCapabilityNode,
  renameCapabilityNode,
} from "@/app/(platform)/e/[engagementId]/capabilities/actions";

export type HeatBucketView = "TERMINATE" | "RETOOL_REDESIGN" | "RETAIN" | null;

export interface L2TileData {
  id: string;
  name: string;
  isPlaceholder: boolean;
  commentCount: number;
  appCount: number;
  bucket: HeatBucketView;
}

export interface L1CardData {
  id: string;
  name: string;
  isPlaceholder: boolean;
  commentCount: number;
  appCount: number;
  terminate: number;
  retoolRedesign: number;
  retain: number;
  l2s: L2TileData[];
}

export interface L0SectionData {
  id: string;
  name: string;
  isPlaceholder: boolean;
  commentCount: number;
  l1s: L1CardData[];
}

/** Discussion badge — shown only when a capability has comments. */
function CommentBadge({ engagementId, nodeId, count }: { engagementId: string; nodeId: string; count: number }) {
  if (count === 0) return null;
  return (
    <Link
      href={`/e/${engagementId}/capabilities/${nodeId}`}
      onClick={(e) => e.stopPropagation()}
      title={`${count} comment${count === 1 ? "" : "s"}`}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs"
    >
      <MessageSquare className="size-3" /> {count}
    </Link>
  );
}

// Tailwind board-tile mirror of the heat buckets. These are intentionally
// softer than the workbook's exact HEAT_COLORS hex (used by the heat grid /
// PPTX); keep the mapping (which bucket is red/yellow/green) aligned with
// lib/methodology HEAT_COLORS.
const BUCKET_DOT: Record<Exclude<HeatBucketView, null>, string> = {
  TERMINATE: "bg-red-600",
  RETOOL_REDESIGN: "bg-yellow-400",
  RETAIN: "bg-green-600",
};

export function CapabilityBoard({
  engagementId,
  sections,
  canEdit,
  canDelete,
}: {
  engagementId: string;
  sections: L0SectionData[];
  canEdit: boolean;
  /** Deleting a subtree is Engagement-Lead-only; add/rename/move stay at canEdit. */
  canDelete: boolean;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return sections;
    return sections
      .map((l0) => ({
        ...l0,
        l1s: l0.l1s
          .map((l1) => ({
            ...l1,
            l2s: l1.name.toLowerCase().includes(q) ? l1.l2s : l1.l2s.filter((l2) => l2.name.toLowerCase().includes(q)),
          }))
          .filter((l1) => l1.name.toLowerCase().includes(q) || l1.l2s.length > 0),
      }))
      .filter((l0) => l0.name.toLowerCase().includes(q) || l0.l1s.length > 0);
  }, [sections, q]);

  function dropOn(l1Id: string, nodeIdFromEvent: string) {
    // The dataTransfer payload is the source of truth (state is visuals-only —
    // it can lag the event when drops arrive quickly).
    const nodeId = nodeIdFromEvent || dragging;
    if (!nodeId || !canEdit) return;
    setDragging(null);
    setDropTarget(null);
    startTransition(async () => {
      try {
        const result = await moveCapabilityNode({ engagementId, nodeId, newParentId: l1Id });
        if (!result.ok) toast.error(result.error);
        else if (result.moved) toast.success("Capability moved");
      } catch {
        toast.error("Could not move the capability");
      }
    });
  }

  return (
    <div className="space-y-5">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search capabilities…"
        className="h-9 w-72 rounded-lg"
      />

      {filtered.map((l0) => (
        <section key={l0.id} className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="rounded bg-foreground text-background">
              L0
            </Badge>
            <h2 className="text-sm font-semibold tracking-tight">
              <Link href={`/e/${engagementId}/capabilities/${l0.id}`} className="hover:underline">
                {l0.name}
              </Link>
            </h2>
            <CommentBadge engagementId={engagementId} nodeId={l0.id} count={l0.commentCount} />
            {l0.isPlaceholder ? <Pill color="amber">placeholder — resolve</Pill> : null}
            {canEdit ? (
              <NodeMenu engagementId={engagementId} nodeId={l0.id} name={l0.name} level="L0" canDelete={canDelete} />
            ) : null}
          </div>

          {l0.l1s.map((l1) => {
            const isCollapsed = collapsed[l1.id] ?? false;
            const isDropTarget = dropTarget === l1.id && dragging !== null;
            return (
              <div
                key={l1.id}
                className={cn(
                  "rounded-2xl border bg-card shadow-sm transition-colors",
                  isDropTarget && "border-brand ring-brand/30 ring-2",
                )}
                onDragOver={(e) => {
                  if (canEdit) {
                    e.preventDefault();
                    setDropTarget(l1.id);
                  }
                }}
                onDragLeave={() => setDropTarget((t) => (t === l1.id ? null : t))}
                onDrop={(e) => {
                  e.preventDefault();
                  dropOn(l1.id, e.dataTransfer.getData("text/plain"));
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setCollapsed((c) => ({ ...c, [l1.id]: !isCollapsed }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setCollapsed((c) => ({ ...c, [l1.id]: !isCollapsed }));
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left"
                >
                  <span className="flex items-center gap-3">
                    <span className="bg-brand block h-8 w-1 rounded-full" />
                    <Badge variant="outline" className="rounded bg-foreground text-background">
                      L1
                    </Badge>
                    <Link
                      href={`/e/${engagementId}/capabilities/${l1.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold hover:underline"
                    >
                      {l1.name}
                    </Link>
                    <CommentBadge engagementId={engagementId} nodeId={l1.id} count={l1.commentCount} />
                    {l1.isPlaceholder ? <Pill color="amber">placeholder</Pill> : null}
                    {canEdit ? <NodeMenu engagementId={engagementId} nodeId={l1.id} name={l1.name} level="L1" canDelete={canDelete} /> : null}
                  </span>
                  <span className="flex items-center gap-2">
                    {l1.appCount > 0 ? (
                      <>
                        <Pill color="gray" dot={false}>
                          {l1.appCount} app{l1.appCount === 1 ? "" : "s"}
                        </Pill>
                        {l1.terminate > 0 ? <Pill color="red">{l1.terminate} terminate</Pill> : null}
                        {l1.retoolRedesign > 0 ? <Pill color="amber">{l1.retoolRedesign} re-tool/re-design</Pill> : null}
                        {l1.retain > 0 ? <Pill color="green">{l1.retain} keep</Pill> : null}
                      </>
                    ) : (
                      <Pill color="gray" dot={false}>
                        no apps mapped
                      </Pill>
                    )}
                    <Pill color="gray" dot={false}>
                      {l1.l2s.length} sub-capabilit{l1.l2s.length === 1 ? "y" : "ies"}
                    </Pill>
                    <span className={cn("text-muted-foreground transition-transform", isCollapsed ? "" : "rotate-90")}>›</span>
                  </span>
                </div>

                {!isCollapsed ? (
                  <div className="flex flex-wrap gap-3 px-5 pb-5">
                    {l1.l2s.map((l2) => (
                      <div
                        key={l2.id}
                        draggable={canEdit}
                        onDragStart={(e) => {
                          setDragging(l2.id);
                          e.dataTransfer.setData("text/plain", l2.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        className={cn(
                          "group relative w-56 rounded-xl border bg-background p-3 shadow-sm",
                          canEdit && "cursor-grab active:cursor-grabbing",
                          dragging === l2.id && "opacity-40",
                        )}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="flex items-center gap-1.5">
                            {canEdit ? <span className="text-muted-foreground/50 select-none text-xs">⠿</span> : null}
                            <Badge variant="outline" className="rounded px-1 text-[10px]">
                              L2
                            </Badge>
                          </span>
                          <span
                            title={
                              l2.bucket === null
                                ? "No scored applications"
                                : l2.bucket === "TERMINATE"
                                  ? "Heat: terminate share exceeded"
                                  : l2.bucket === "RETOOL_REDESIGN"
                                    ? "Heat: re-tool/re-design share exceeded"
                                    : "Heat: retain"
                            }
                            className={cn(
                              "mt-0.5 block h-2.5 w-2.5 rounded-full",
                              l2.bucket ? BUCKET_DOT[l2.bucket] : "bg-muted-foreground/25",
                            )}
                          />
                        </div>
                        <div className="mt-1.5 text-sm font-medium leading-snug">
                          <Link href={`/e/${engagementId}/capabilities/${l2.id}`} className="hover:underline">
                            {l2.name}
                          </Link>
                        </div>
                        <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2">
                            {l2.appCount} app{l2.appCount === 1 ? "" : "s"}
                            <CommentBadge engagementId={engagementId} nodeId={l2.id} count={l2.commentCount} />
                          </span>
                          {canEdit ? (
                            <span className="invisible flex gap-1 group-hover:visible">
                              <NodeMenu engagementId={engagementId} nodeId={l2.id} name={l2.name} level="L2" canDelete={canDelete} />
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ))}

                    {canEdit ? (
                      <form
                        action={addCapabilityNode}
                        className="flex w-56 flex-col justify-center gap-1 rounded-xl border border-dashed p-3"
                      >
                        <input type="hidden" name="engagementId" value={engagementId} />
                        <input type="hidden" name="parentId" value={l1.id} />
                        <Input name="name" placeholder="Add L2…" required className="h-7 text-xs" />
                        <Button type="submit" size="sm" variant="ghost" className="h-6 text-xs">
                          + Add
                        </Button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {canEdit ? (
            <form action={addCapabilityNode} className="flex items-center gap-2 pl-1">
              <input type="hidden" name="engagementId" value={engagementId} />
              <input type="hidden" name="parentId" value={l0.id} />
              <Input name="name" placeholder="Add L1 capability…" required className="h-8 w-56 text-sm" />
              <Button type="submit" size="sm" variant="outline" className="h-8">
                Add L1
              </Button>
            </form>
          ) : null}
        </section>
      ))}

      {isPending ? <p className="text-muted-foreground text-xs">Saving…</p> : null}
    </div>
  );
}

/** Compact rename/delete disclosure for a node. */
function NodeMenu({
  engagementId,
  nodeId,
  name,
  level,
  canDelete,
}: {
  engagementId: string;
  nodeId: string;
  name: string;
  level: "L0" | "L1" | "L2";
  canDelete: boolean;
}) {
  return (
    <details className="relative" onClick={(e) => e.stopPropagation()}>
      <summary className="text-muted-foreground hover:text-foreground cursor-pointer list-none px-1 text-sm">⋯</summary>
      <div className="bg-popover absolute z-20 mt-1 w-56 space-y-2 rounded-md border p-2 shadow-md">
        <form action={renameCapabilityNode} className="flex items-center gap-1">
          <input type="hidden" name="engagementId" value={engagementId} />
          <input type="hidden" name="nodeId" value={nodeId} />
          <Input name="name" defaultValue={name} className="h-7 text-xs" />
          <Button type="submit" size="sm" variant="ghost" className="h-7 px-2 text-xs">
            Rename
          </Button>
        </form>
        {canDelete ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive h-7 w-full justify-start px-2 text-xs"
            onClick={async () => {
              try {
                const result = await deleteCapabilityNode({ engagementId, nodeId });
                if (!result.ok) toast.error(result.error);
                else toast.success(`Deleted “${name}”`);
              } catch {
                toast.error("Could not delete the capability");
              }
            }}
          >
            Delete {level === "L0" ? "L0 (and children)" : ""}
          </Button>
        ) : (
          <p className="text-muted-foreground px-2 text-[10px]">Only an Engagement Lead can delete capabilities.</p>
        )}
      </div>
    </details>
  );
}
