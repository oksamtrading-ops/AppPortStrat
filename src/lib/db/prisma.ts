/**
 * Raw Prisma client singleton. DO NOT import this outside src/lib/db/** —
 * enforced by ESLint no-restricted-imports. All application data access goes
 * through getScopedDb(ctx) (scoped.ts) or the sanctioned admin door (admin.ts).
 */
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

if (typeof window !== "undefined") {
  throw new Error("Database client must never be bundled into client-side code");
}

const globalForPrisma = globalThis as unknown as { __apsPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — copy .env.example to .env and fill it in");
  }
  return new PrismaClient({
    // Pool tuned for serverless Postgres (Neon): drop idle sockets before the
    // server severs them (ECONNRESET), keep TCP alive, allow slow cold starts.
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 15_000,
      keepAlive: true,
    }),
    // Every scoped operation runs inside a batch transaction (RLS set_config +
    // query); hosted Postgres with cold starts needs generous acquisition
    // headroom or concurrent snapshot reads spuriously fail.
    transactionOptions: { maxWait: 15_000, timeout: 30_000 },
  });
}

/** Lazily initialized so importing this module without a DB configured is safe. */
export function getRawPrisma(): PrismaClient {
  if (!globalForPrisma.__apsPrisma) {
    globalForPrisma.__apsPrisma = createClient();
  }
  return globalForPrisma.__apsPrisma;
}
