-- C3: comments on capabilities (polymorphic target) + disposition sign-off.
-- Applied via `prisma db execute` + `migrate resolve` (see migration playbook —
-- the hardening composite FKs make `migrate dev` demand a reset forever).

-- 1. Comment: application XOR capability target.
ALTER TABLE "Comment" ALTER COLUMN "applicationId" DROP NOT NULL;
ALTER TABLE "Comment" ADD COLUMN "capabilityNodeId" TEXT;

ALTER TABLE "Comment" ADD CONSTRAINT "Comment_capabilityNodeId_engagementId_fkey"
  FOREIGN KEY ("capabilityNodeId", "engagementId")
  REFERENCES "CapabilityNode"("id", "engagementId")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one target: existing rows all have applicationId, so this is safe.
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_target_xor"
  CHECK (("applicationId" IS NOT NULL) <> ("capabilityNodeId" IS NOT NULL));

CREATE INDEX "Comment_engagementId_capabilityNodeId_idx"
  ON "Comment"("engagementId", "capabilityNodeId");

-- 2. DispositionSignOff: snapshot of the client-agreed final disposition.
CREATE TABLE "DispositionSignOff" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "disposition" TEXT NOT NULL,
  "signedByMembershipId" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DispositionSignOff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DispositionSignOff_applicationId_engagementId_key" ON "DispositionSignOff"("applicationId", "engagementId");
CREATE UNIQUE INDEX "DispositionSignOff_id_engagementId_key" ON "DispositionSignOff"("id", "engagementId");
CREATE INDEX "DispositionSignOff_engagementId_idx" ON "DispositionSignOff"("engagementId");

ALTER TABLE "DispositionSignOff" ADD CONSTRAINT "DispositionSignOff_engagementId_fkey"
  FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DispositionSignOff" ADD CONSTRAINT "DispositionSignOff_applicationId_engagementId_fkey"
  FOREIGN KEY ("applicationId", "engagementId") REFERENCES "Application"("id", "engagementId")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DispositionSignOff" ADD CONSTRAINT "DispositionSignOff_signedByMembershipId_engagementId_fkey"
  FOREIGN KEY ("signedByMembershipId", "engagementId") REFERENCES "Membership"("id", "engagementId")
  ON DELETE CASCADE ON UPDATE CASCADE;
