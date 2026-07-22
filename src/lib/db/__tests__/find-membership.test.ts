import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Security review (row-adoption hardening): findMembership resolves the caller's
 * membership for context.ts. clerkUserId must take precedence, and in Clerk mode
 * the email fallback must only ever resolve an UNCLAIMED row (clerkUserId null) —
 * never a row already bound to a DIFFERENT user, which context.ts would then
 * rebind to the session (adopting someone else's row). Dev mode keeps the plain
 * email match. Skipped without a DB.
 */
const hasDb = Boolean(process.env.DATABASE_URL);
const SLOW = 120_000;

describe.skipIf(!hasDb)("findMembership row-adoption hardening (integration)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let engagementId: string;
  let findMembership: typeof import("../admin").findMembership;

  const stamp = Date.now();
  const userA = `clerk:userA:${stamp}`;
  const userB = `clerk:userB:${stamp}`;
  const sharedEmail = `shared+${stamp}@t.local`;
  const inviteEmail = `invite+${stamp}@t.local`;

  beforeAll(async () => {
    const { getRawPrisma } = await import("../prisma");
    const { createEngagementWithConfig } = await import("../provision");
    ({ findMembership } = await import("../admin"));
    const raw = getRawPrisma();

    const engagement = await createEngagementWithConfig({
      name: `__findmem_${stamp}`,
      clientName: "Test",
      source: { kind: "defaults", preset: "NEUTRAL" },
    });
    engagementId = engagement.id;

    // Row A: a CLAIMED row owned by userA, on the shared email.
    await raw.membership.create({
      data: { engagementId, clerkUserId: userA, email: sharedEmail, role: "CLIENT_VIEWER" },
    });
    // Row C: an UNCLAIMED pending-invite row (clerkUserId null).
    await raw.membership.create({
      data: { engagementId, clerkUserId: null, email: inviteEmail, role: "CLIENT_RESPONDENT" },
    });

    cleanup = async () => {
      await raw.engagement.delete({ where: { id: engagementId } });
    };
  }, SLOW);

  afterAll(async () => {
    await cleanup?.();
  }, SLOW);

  it("resolves by clerkUserId (authoritative identity) first", async () => {
    const m = await findMembership(engagementId, { clerkUserId: userA, email: "nonsense@t.local" });
    expect(m?.clerkUserId).toBe(userA);
  }, SLOW);

  it("Clerk mode: email fallback claims an UNCLAIMED row", async () => {
    const m = await findMembership(
      engagementId,
      { clerkUserId: userB, email: inviteEmail },
      { emailMatchesUnclaimedOnly: true },
    );
    expect(m).not.toBeNull();
    expect(m?.clerkUserId).toBeNull();
    expect(m?.email).toBe(inviteEmail);
  }, SLOW);

  it("Clerk mode: email fallback NEVER resolves a row claimed by another user", async () => {
    const m = await findMembership(
      engagementId,
      { clerkUserId: userB, email: sharedEmail },
      { emailMatchesUnclaimedOnly: true },
    );
    expect(m).toBeNull();
  }, SLOW);

  it("dev mode (default): plain email match still resolves a claimed row", async () => {
    const m = await findMembership(engagementId, { clerkUserId: userB, email: sharedEmail });
    expect(m?.clerkUserId).toBe(userA);
  }, SLOW);
});
