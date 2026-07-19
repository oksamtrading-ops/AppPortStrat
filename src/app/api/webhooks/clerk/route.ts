import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { reconcileMemberships } from "@/lib/db/admin";
import { mapClerkOrgRole } from "@/lib/auth/roles";

/**
 * Clerk membership sync — svix-verified, CONVERGENT: any membership event
 * triggers a full re-fetch of the org's memberships from the Clerk Backend
 * API and a reconcile, so replayed or out-of-order deliveries cannot produce
 * wrong state. Inert until CLERK_WEBHOOK_SIGNING_SECRET is configured.
 */

const MEMBERSHIP_EVENTS = new Set([
  "organizationMembership.created",
  "organizationMembership.updated",
  "organizationMembership.deleted",
]);

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }

  const payload = await req.text();
  let event: { type: string; data: { organization?: { id?: string } } };
  try {
    const webhook = new Webhook(secret);
    event = webhook.verify(payload, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as typeof event;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  if (!MEMBERSHIP_EVENTS.has(event.type)) {
    return NextResponse.json({ ok: true, skipped: event.type });
  }

  const clerkOrgId = event.data.organization?.id;
  if (!clerkOrgId) return NextResponse.json({ ok: true, skipped: "no organization" });

  // Each delivery amplifies into a Backend-API re-fetch + N upserts; throttle
  // per organization so a burst of membership events can't overwhelm the DB.
  const { rateLimit } = await import("@/lib/db/admin");
  const { allowed } = await rateLimit(`webhook:${clerkOrgId}`, 30, 60);
  if (!allowed) return NextResponse.json({ ok: false, error: "rate limited" }, { status: 429 });

  // Convergent sync: fetch the CURRENT membership list and reconcile.
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: clerkOrgId,
    limit: 500,
  });

  const members = memberships.data
    .map((m) => {
      const role = mapClerkOrgRole(m.role);
      const userData = m.publicUserData;
      if (!role || !userData?.userId) return null;
      return {
        clerkUserId: userData.userId,
        email: userData.identifier ?? `${userData.userId}@unknown.clerk`,
        displayName: [userData.firstName, userData.lastName].filter(Boolean).join(" ") || userData.identifier || null,
        role,
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);

  const result = await reconcileMemberships(clerkOrgId, members);
  return NextResponse.json({ ok: true, ...result });
}
