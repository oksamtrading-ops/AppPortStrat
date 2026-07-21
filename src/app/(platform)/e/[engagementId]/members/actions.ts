"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireEngagementContext } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";

const ROLE_TO_CLERK: Record<string, string> = {
  ENGAGEMENT_LEAD: "org:lead",
  CONSULTANT: "org:consultant",
  CLIENT_RESPONDENT: "org:client_respondent",
  CLIENT_VIEWER: "org:client_viewer",
};

/**
 * Invite a user to this engagement (Lead only). Clerk mode sends a Clerk
 * organization invitation (Clerk emails the join link); the local membership
 * row anchors survey assignments until the invite is accepted, at which point
 * the lazy sync fills in the clerkUserId.
 */
export async function inviteMember(formData: FormData) {
  const parsed = z
    .object({
      engagementId: z.string().min(1),
      email: z.string().trim().email().max(320),
      role: z.enum(["ENGAGEMENT_LEAD", "CONSULTANT", "CLIENT_RESPONDENT", "CLIENT_VIEWER"]),
      displayName: z
        .string()
        .trim()
        .max(200)
        .transform((v) => (v === "" ? null : v))
        .nullable()
        .optional(),
    })
    .parse({
      engagementId: formData.get("engagementId"),
      email: formData.get("email"),
      role: formData.get("role"),
      displayName: formData.get("displayName"),
    });
  const { ctx, db, engagement, session } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const existing = await db.membership.findFirst({ where: { email: parsed.email } });
  if (existing) throw new Error("This email is already a member of the engagement");

  if (session.mode === "clerk") {
    if (!engagement.clerkOrgId) throw new Error("Engagement has no Clerk organization bound");
    const { clerkClient } = await import("@clerk/nextjs/server");
    const { headers } = await import("next/headers");
    const client = await clerkClient();
    // Point the invitation link back at THIS app's sign-up page. Without a
    // redirectUrl, Clerk's email link lands on its hosted Account Portal and
    // the invitee never returns to the app after creating their account. The
    // /sign-up page renders <SignUp/>, which consumes the __clerk_ticket to
    // create the account, accept the org invite, then redirect in-app.
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    const redirectUrl = host ? `${proto}://${host}/sign-up` : undefined;
    await client.organizations.createOrganizationInvitation({
      organizationId: engagement.clerkOrgId,
      emailAddress: parsed.email,
      role: ROLE_TO_CLERK[parsed.role],
      inviterUserId: session.userId,
      redirectUrl,
    });
  }

  await db.membership.create({
    data: {
      engagementId: ctx.engagementId,
      email: parsed.email,
      displayName: parsed.displayName ?? null,
      role: parsed.role,
      clerkUserId: null, // filled by sync once the invite is accepted
    },
  });

  await writeAudit(db, ctx, {
    action: "member.invite",
    entityType: "Membership",
    after: { email: parsed.email, role: parsed.role },
  });
  revalidatePath(`/e/${ctx.engagementId}/members`);
}

export async function removeMember(formData: FormData) {
  const parsed = z
    .object({ engagementId: z.string().min(1), membershipId: z.string().min(1) })
    .parse({ engagementId: formData.get("engagementId"), membershipId: formData.get("membershipId") });
  const { ctx, db, engagement, session } = await requireEngagementContext(parsed.engagementId, "ENGAGEMENT_LEAD");

  const member = await db.membership.findUnique({ where: { id: parsed.membershipId } });
  if (!member) throw new Error("Unknown member");
  if (member.id === ctx.membershipId) throw new Error("You cannot remove yourself");

  if (session.mode === "clerk" && member.clerkUserId && engagement.clerkOrgId) {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    await client.organizations
      .deleteOrganizationMembership({ organizationId: engagement.clerkOrgId, userId: member.clerkUserId })
      .catch(() => undefined); // may already be gone in Clerk
  }

  await db.membership.delete({ where: { id: member.id } });
  await writeAudit(db, ctx, {
    action: "member.remove",
    entityType: "Membership",
    entityId: member.id,
    before: { email: member.email, role: member.role },
  });
  revalidatePath(`/e/${ctx.engagementId}/members`);
}
