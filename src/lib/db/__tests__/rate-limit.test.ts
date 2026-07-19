import { describe, it, expect, afterAll } from "vitest";

/**
 * The fixed-window rate limiter blocks once the per-window count exceeds the
 * limit, and a new window resets it. Integration (needs a DB); skipped without.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("rateLimit (integration)", () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterAll(async () => {
    await cleanup?.();
  });

  it("allows up to the limit, then blocks within the same window", async () => {
    const { rateLimit } = await import("../admin");
    const { getRawPrisma } = await import("../prisma");
    const key = `__test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const now = Date.now();

    cleanup = async () => {
      await getRawPrisma().$executeRawUnsafe(`DELETE FROM "RateLimitHit" WHERE "bucket" LIKE '${key}%'`);
    };

    // Fixed `now` keeps all four calls in the same window.
    expect((await rateLimit(key, 3, 60, now)).allowed).toBe(true); // 1
    expect((await rateLimit(key, 3, 60, now)).allowed).toBe(true); // 2
    expect((await rateLimit(key, 3, 60, now)).allowed).toBe(true); // 3
    expect((await rateLimit(key, 3, 60, now)).allowed).toBe(false); // 4 → blocked

    // A later window resets the counter.
    expect((await rateLimit(key, 3, 60, now + 61_000)).allowed).toBe(true);
  }, 60_000);
});
