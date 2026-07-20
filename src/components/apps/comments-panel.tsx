"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, MessageSquare, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { addComment } from "@/app/(platform)/e/[engagementId]/applications/comment-actions";

export interface CommentView {
  id: string;
  body: string;
  internal: boolean;
  authorName: string;
  createdAt: string; // pre-formatted server-side
  replies: Omit<CommentView, "replies">[];
}

/**
 * Threaded discussion on one application OR one capability (exactly one target
 * prop is set). Internal (Deloitte-only) is the DEFAULT; sharing with client
 * viewers is the deliberate act. Mention teammates by typing @Their Name.
 */
export function CommentsPanel({
  engagementId,
  applicationId = null,
  capabilityNodeId = null,
  comments,
  canWrite,
  memberNames,
}: {
  engagementId: string;
  applicationId?: string | null;
  capabilityNodeId?: string | null;
  comments: CommentView[];
  canWrite: boolean;
  memberNames: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(true);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  function post(parentId: string | null, text: string, isInternal: boolean, after: () => void) {
    if (text.trim().length === 0) return;
    startTransition(async () => {
      const result = await addComment({ engagementId, applicationId, capabilityNodeId, parentId, body: text, internal: isInternal });
      if (!result.ok) return void toast.error(result.error);
      after();
      router.refresh();
    });
  }

  const badge = (isInternal: boolean) =>
    isInternal ? (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
        <Lock className="size-2.5" /> Internal
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">
        <Users className="size-2.5" /> Shared
      </span>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4" /> Discussion
        </CardTitle>
        <CardDescription>
          Internal comments are visible to the Deloitte team only; shared comments are also visible to client
          viewers. Mention teammates with @name{memberNames.length > 0 ? ` (e.g. @${memberNames[0]})` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {comments.length === 0 ? <p className="text-muted-foreground text-sm">No comments yet.</p> : null}
        {comments.map((c) => (
          <div key={c.id} className="space-y-2">
            <div className="rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{c.authorName}</span>
                <span className="text-muted-foreground">{c.createdAt}</span>
                {badge(c.internal)}
              </div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{c.body}</p>
            </div>
            {c.replies.map((r) => (
              <div key={r.id} className="ml-6 rounded-lg border px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{r.authorName}</span>
                  <span className="text-muted-foreground">{r.createdAt}</span>
                  {badge(r.internal)}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{r.body}</p>
              </div>
            ))}
            {canWrite ? (
              replyTo === c.id ? (
                <div className="ml-6 space-y-1.5">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    className="min-h-16 w-full rounded-md border bg-background p-2 text-sm"
                    placeholder="Reply… (inherits this thread's visibility)"
                    maxLength={5000}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={isPending}
                      onClick={() => post(c.id, replyBody, c.internal, () => (setReplyBody(""), setReplyTo(null)))}
                    >
                      {isPending ? "Posting…" : "Reply"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" className="text-muted-foreground ml-6 text-xs hover:underline" onClick={() => setReplyTo(c.id)}>
                  Reply
                </button>
              )
            ) : null}
          </div>
        ))}

        {canWrite ? (
          <div className="space-y-2 border-t pt-3">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-20 w-full rounded-md border bg-background p-2 text-sm"
              placeholder="Add a comment… mention teammates with @Their Name"
              maxLength={5000}
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs">
                <select
                  value={internal ? "internal" : "shared"}
                  onChange={(e) => setInternal(e.target.value === "internal")}
                  className="h-7 rounded border bg-background px-1 text-xs"
                >
                  <option value="internal">Internal (Deloitte only)</option>
                  <option value="shared">Shared with client viewers</option>
                </select>
              </label>
              <Button size="sm" disabled={isPending || body.trim().length === 0} onClick={() => post(null, body, internal, () => setBody(""))}>
                {isPending ? "Posting…" : "Comment"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
