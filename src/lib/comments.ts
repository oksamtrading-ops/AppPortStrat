/**
 * Pure comment helpers shared by the collaboration server action and the pages
 * that render discussion threads. No I/O — unit-tested directly.
 *
 * These were previously inlined: the @mention resolution lived only inside the
 * DB-touching addComment action, and the thread-flattening + author/date
 * mapping was copy-pasted across the application edit, application view, and
 * capability detail pages.
 */

import { formatDateTime } from "@/lib/format";

/** One rendered comment (root) with its one level of replies. */
export interface CommentView {
  id: string;
  body: string;
  internal: boolean;
  authorName: string;
  createdAt: string; // pre-formatted (server-side)
  replies: Omit<CommentView, "replies">[];
}

export interface MentionCandidate {
  id: string;
  displayName: string | null;
  role: string;
}

/**
 * Resolve @mentions in a comment body to eligible member ids. A member is
 * mentioned when `@<their display name>` (case-insensitive) appears in the body
 * AND they are eligible: never the actor, never a Client Respondent (no comment
 * access), and — for an INTERNAL comment — never a Client Viewer (they can't
 * see it). Longest display names are tested first so a longer name is preferred
 * over a shorter one it contains.
 *
 * NOTE (documented behaviour): matching is plain substring containment, so a
 * display name that is a substring of another member's name can produce an
 * extra match. Names are distinct in practice; tightening this (word-boundary
 * matching) is tracked separately.
 */
export function resolveMentions(opts: {
  body: string;
  members: MentionCandidate[];
  actorMembershipId: string;
  internal: boolean;
}): string[] {
  const { body, members, actorMembershipId, internal } = opts;
  const bodyLower = body.toLowerCase();
  const eligible = (m: MentionCandidate) =>
    m.id !== actorMembershipId &&
    m.role !== "CLIENT_RESPONDENT" &&
    !(internal && m.role === "CLIENT_VIEWER");

  const ids: string[] = [];
  for (const m of [...members].sort((a, b) => (b.displayName?.length ?? 0) - (a.displayName?.length ?? 0))) {
    if (!m.displayName || !eligible(m)) continue;
    if (bodyLower.includes(`@${m.displayName.toLowerCase()}`)) ids.push(m.id);
  }
  return ids;
}

export interface CommentRow {
  id: string;
  body: string;
  internal: boolean;
  parentId: string | null;
  createdAt: Date;
  author: { displayName: string | null; email: string };
}

/**
 * Group flat comment rows into one-level threads: each root (parentId === null)
 * carries its replies (parentId === root.id), preserving input order (callers
 * pass rows ordered by createdAt ascending). Author name falls back to email.
 */
export function toCommentViews(rows: CommentRow[]): CommentView[] {
  const toView = (c: CommentRow) => ({
    id: c.id,
    body: c.body,
    internal: c.internal,
    authorName: c.author.displayName ?? c.author.email,
    createdAt: formatDateTime(c.createdAt),
  });
  return rows
    .filter((c) => !c.parentId)
    .map((root) => ({
      ...toView(root),
      replies: rows.filter((c) => c.parentId === root.id).map(toView),
    }));
}
