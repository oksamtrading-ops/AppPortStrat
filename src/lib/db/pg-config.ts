/**
 * Shared node-postgres pool configuration for the Prisma pg adapter.
 * Handles two upstream deprecations, both scheduled to break in pg@9:
 *
 * 1. sslmode 'prefer' | 'require' | 'verify-ca' are today aliases for
 *    'verify-full' and will adopt weaker libpq semantics in pg@9. pinSslMode
 *    rewrites them to 'verify-full' — byte-for-byte the current behavior,
 *    pinned so the future pg upgrade cannot silently weaken TLS verification.
 *
 * 2. pg's implicit per-client query queue (calling client.query() while
 *    another query is in flight) is deprecated. Prisma's query interpreter
 *    legitimately runs independent plan nodes concurrently on a transaction's
 *    dedicated connection and relies on that queue. SerializingClient is the
 *    "external async flow control mechanism" pg's warning asks for: it chains
 *    query() calls per connection, reproducing the current queue semantics
 *    without the deprecated code path.
 *
 * Both are transparent to callers. Delete this module if @prisma/adapter-pg
 * gains pg@9 compatibility upstream.
 */
import pg from "pg";

const WEAKENING_SSLMODES = /\bsslmode=(prefer|require|verify-ca)\b/g;

export function pinSslMode(connectionString: string): string {
  return connectionString.replace(WEAKENING_SSLMODES, "sslmode=verify-full");
}

type AnyQuery = (...args: unknown[]) => Promise<unknown>;

export class SerializingClient extends pg.Client {
  #tail: Promise<void> = Promise.resolve();

  // Prisma's adapter only ever uses the promise form. The callback and
  // Submittable (cursor/stream) forms manage their own flow control — those
  // pass straight through. Typed `any` to stay assignable to pg's full
  // overload surface (Submittable | Promise variants).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(...args: unknown[]): any {
    const passThrough =
      typeof args[args.length - 1] === "function" ||
      typeof (args[0] as { submit?: unknown } | undefined)?.submit === "function";
    const run = super.query.bind(this) as AnyQuery;
    if (passThrough) return run(...args);
    const next = this.#tail.then(() => run(...args));
    // Keep the chain alive on failure; the error still reaches this caller.
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

/** Pool config with both pg@9 mitigations applied. */
export function apsPoolConfig(connectionString: string, tuning?: Partial<pg.PoolConfig>): pg.PoolConfig {
  return {
    connectionString: pinSslMode(connectionString),
    Client: SerializingClient,
    ...tuning,
  };
}
