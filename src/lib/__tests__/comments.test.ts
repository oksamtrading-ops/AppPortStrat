import { describe, it, expect } from "vitest";
import { resolveMentions, toCommentViews, type CommentRow, type MentionCandidate } from "../comments";

const members: MentionCandidate[] = [
  { id: "lead", displayName: "Dev Lead", role: "ENGAGEMENT_LEAD" },
  { id: "consultant", displayName: "Dev Consultant", role: "CONSULTANT" },
  { id: "viewer", displayName: "Client Viewer", role: "CLIENT_VIEWER" },
  { id: "respondent", displayName: "Client Respondent", role: "CLIENT_RESPONDENT" },
  { id: "noname", displayName: null, role: "CONSULTANT" },
];

describe("resolveMentions", () => {
  it("matches @Display Name case-insensitively and returns the member id", () => {
    expect(resolveMentions({ body: "cc @Dev Consultant please review", members, actorMembershipId: "lead", internal: true })).toEqual([
      "consultant",
    ]);
    expect(resolveMentions({ body: "hey @dev lead", members, actorMembershipId: "consultant", internal: true })).toEqual(["lead"]);
  });

  it("never mentions the actor themselves", () => {
    expect(resolveMentions({ body: "@Dev Lead note to self", members, actorMembershipId: "lead", internal: true })).toEqual([]);
  });

  it("never mentions Client Respondents (no comment access)", () => {
    expect(resolveMentions({ body: "@Client Respondent", members, actorMembershipId: "lead", internal: true })).toEqual([]);
  });

  it("excludes Client Viewers on an INTERNAL comment but includes them when SHARED", () => {
    expect(resolveMentions({ body: "@Client Viewer", members, actorMembershipId: "lead", internal: true })).toEqual([]);
    expect(resolveMentions({ body: "@Client Viewer", members, actorMembershipId: "lead", internal: false })).toEqual(["viewer"]);
  });

  it("ignores members with no display name and bodies without a mention", () => {
    expect(resolveMentions({ body: "no mentions here", members, actorMembershipId: "lead", internal: true })).toEqual([]);
  });

  it("resolves multiple distinct mentions in one body", () => {
    const ids = resolveMentions({ body: "@Dev Lead and @Dev Consultant", members, actorMembershipId: "viewer", internal: false });
    expect(new Set(ids)).toEqual(new Set(["lead", "consultant"]));
  });
});

describe("toCommentViews", () => {
  const d = (iso: string) => new Date(iso);
  const row = (over: Partial<CommentRow>): CommentRow => ({
    id: "x",
    body: "b",
    internal: true,
    parentId: null,
    createdAt: d("2026-07-20T09:30:00.000Z"),
    author: { displayName: "Dev Lead", email: "lead@x.com" },
    ...over,
  });

  it("groups replies under their root, preserving order, one level deep", () => {
    const rows: CommentRow[] = [
      row({ id: "r1", body: "root one" }),
      row({ id: "c1", body: "reply a", parentId: "r1" }),
      row({ id: "c2", body: "reply b", parentId: "r1" }),
      row({ id: "r2", body: "root two" }),
    ];
    const views = toCommentViews(rows);
    expect(views.map((v) => v.id)).toEqual(["r1", "r2"]);
    expect(views[0].replies.map((r) => r.body)).toEqual(["reply a", "reply b"]);
    expect(views[1].replies).toEqual([]);
  });

  it("falls back to email when the author has no display name, and formats the date", () => {
    const [v] = toCommentViews([row({ id: "r1", author: { displayName: null, email: "anon@x.com" } })]);
    expect(v.authorName).toBe("anon@x.com");
    expect(v.createdAt).toBe("2026-07-20 09:30"); // ISO sliced to minutes, T→space
  });

  it("carries the internal flag through", () => {
    const [v] = toCommentViews([row({ id: "r1", internal: false })]);
    expect(v.internal).toBe(false);
  });
});
