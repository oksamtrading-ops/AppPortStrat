-- Multi-respondent surveys, rollout step 1 (MULTI-RESPONDENT-SURVEYS.md §4).
-- PURELY ADDITIVE + idempotent. The legacy (applicationId, templateId) unique
-- is deliberately KEPT until rollout step 4: deployed code upserts against it,
-- and current data (one row per app+survey) satisfies old and new indexes
-- simultaneously — so there is no deploy-race window.

-- 1. Layer discriminator enum.
DO $$ BEGIN
  CREATE TYPE "ResponseKind" AS ENUM ('CONSENSUS', 'RESPONDENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. New SurveyResponse columns (defaults keep old clients working: their
--    INSERTs omit these and get kind=CONSENSUS — today's shared-doc semantics).
ALTER TABLE "SurveyResponse" ADD COLUMN IF NOT EXISTS "kind" "ResponseKind" NOT NULL DEFAULT 'CONSENSUS';
ALTER TABLE "SurveyResponse" ADD COLUMN IF NOT EXISTS "respondentMembershipId" TEXT;
ALTER TABLE "SurveyResponse" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);

-- 3. Answer.updatedAt (latest-wins aggregation + respondent report).
ALTER TABLE "Answer" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4. Reclassify existing responses by authorship (design D5): rows last edited
--    by a CLIENT_RESPONDENT become that respondent's RESPONDENT row; everything
--    else (lead/consultant/unknown author) stays CONSENSUS. Idempotent: the
--    kind='CONSENSUS' guard makes re-runs no-ops.
UPDATE "SurveyResponse" r
SET "kind" = 'RESPONDENT', "respondentMembershipId" = r."updatedById"
FROM "Membership" m
WHERE r."kind" = 'CONSENSUS'
  AND r."updatedById" IS NOT NULL
  AND m."id" = r."updatedById"
  AND m."engagementId" = r."engagementId"
  AND m."role" = 'CLIENT_RESPONDENT';

-- 5. Previously COMPLETE consensus rows were "done" under the old model —
--    carry that over as finalized (locked; Reopen clears it). Idempotent.
UPDATE "SurveyResponse"
SET "finalizedAt" = "updatedAt"
WHERE "kind" = 'CONSENSUS' AND "status" = 'COMPLETE' AND "finalizedAt" IS NULL;

-- 6. Kind/respondent coherence (same pattern as Comment_target_xor).
DO $$ BEGIN
  ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_kind_respondent_check"
    CHECK (("kind" = 'RESPONDENT') = ("respondentMembershipId" IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. Same-engagement composite FK for the respondent (house pattern; CASCADE
--    matches SurveyAssignment: removing a member removes their individual input;
--    the CONSENSUS layer is unaffected).
DO $$ BEGIN
  ALTER TABLE "SurveyResponse" ADD CONSTRAINT "SurveyResponse_respondent_fkey"
    FOREIGN KEY ("respondentMembershipId", "engagementId")
    REFERENCES "Membership"("id", "engagementId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 8. Layer uniqueness (partial indexes — the reason this isn't in schema.prisma).
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyResponse_consensus_key"
  ON "SurveyResponse"("applicationId", "templateId") WHERE "kind" = 'CONSENSUS';
CREATE UNIQUE INDEX IF NOT EXISTS "SurveyResponse_respondent_key"
  ON "SurveyResponse"("applicationId", "templateId", "respondentMembershipId") WHERE "kind" = 'RESPONDENT';

-- 9. Respondent queue lookups.
CREATE INDEX IF NOT EXISTS "SurveyResponse_respondentMembershipId_idx"
  ON "SurveyResponse"("respondentMembershipId");
