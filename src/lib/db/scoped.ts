/**
 * The ONLY door to engagement data. getScopedDb(ctx) returns a Prisma client
 * whose every operation is:
 *   1. validated + scoped by the pure guard (guard.ts), and
 *   2. executed under the Postgres RLS session setting app.engagement_id
 *      (batch transaction: set_config + query), so even a guard bug cannot
 *      cross tenants once the hardened runtime role is in use.
 *
 * Raw SQL is deliberately unusable here — $queryRaw/$executeRaw throw. The one
 * sanctioned raw statement (DispositionResult bulk upsert) lives in admin.ts.
 */
import { getRawPrisma } from "./prisma";
import { guardArgs, TenancyViolationError, type GuardContext } from "./guard";

export type EngagementContext = GuardContext & {
  clerkUserId: string;
  actorDisplay: string;
};

const BLOCKED_CLIENT_METHODS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$queryRawTyped",
  "$executeRaw",
  "$executeRawUnsafe",
  "$transaction",
  "$connect",
  "$disconnect",
  "$extends",
]);

function buildScopedClient(ctx: EngagementContext) {
  const prisma = getRawPrisma();

  const extended = prisma.$extends({
    name: "engagement-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const guarded = guardArgs(model, operation, args, ctx);
          // Canonical Prisma RLS pattern: the session setting and the query
          // run in one batch transaction on the same connection.
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.engagement_id', ${ctx.engagementId}, TRUE)`,
            query(guarded) as never,
          ]);
          return result;
        },
      },
    },
  });

  return new Proxy(extended, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && BLOCKED_CLIENT_METHODS.has(prop)) {
        throw new TenancyViolationError(`${prop} is not available on the scoped client — use the admin door with review`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export type ScopedDb = ReturnType<typeof buildScopedClient>;

/**
 * Only src/lib/auth/context.ts should call this, with a verified context from
 * requireEngagementContext — pages/actions/handlers never construct a context
 * by hand.
 */
export function getScopedDb(ctx: EngagementContext): ScopedDb {
  return buildScopedClient(ctx);
}
