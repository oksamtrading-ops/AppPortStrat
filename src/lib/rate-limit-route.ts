import { rateLimit } from "@/lib/db/admin";

/**
 * Rate-limit a route handler. Returns a 429 Response when the caller is over
 * the limit, or null to proceed. Keep the key caller-scoped (membership id).
 */
export async function tooManyRequests(key: string, limit: number, windowSeconds: number): Promise<Response | null> {
  const { allowed } = await rateLimit(key, limit, windowSeconds);
  if (allowed) return null;
  return new Response("Too many requests — please slow down.", {
    status: 429,
    headers: { "Retry-After": String(windowSeconds), "Cache-Control": "no-store" },
  });
}
