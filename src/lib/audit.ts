import type { EngagementContext, ScopedDb } from "@/lib/db/scoped";

export interface AuditInput {
  action: string; // "weighting.update", "threshold.update", "disposition.override", ...
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append an audit event. The actor is derived EXCLUSIVELY from the verified
 * engagement context — callers cannot attribute changes to someone else.
 * (engagementId is injected by the scoped client; AuditEvent is append-only
 * in the guard and REVOKE'd at the database.)
 */
export async function writeAudit(db: ScopedDb, ctx: EngagementContext, input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      engagementId: ctx.engagementId, // guard verifies + RLS enforces
      actorUserId: ctx.clerkUserId,
      actorDisplay: ctx.actorDisplay,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before === undefined ? undefined : JSON.parse(JSON.stringify(input.before)),
      after: input.after === undefined ? undefined : JSON.parse(JSON.stringify(input.after)),
    },
  });
}
