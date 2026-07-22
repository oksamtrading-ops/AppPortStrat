-- Multi-respondent surveys, rollout step 4: drop the transitional shared
-- unique. REVERSE deploy order from step 1 — apply this ONLY AFTER the step-4
-- code is deployed (READY on Vercel): the old code upserts with ON CONFLICT
-- against this index, while the new code uses findFirst/create per layer and
-- needs the index GONE before a second (respondent) row per app+survey can
-- exist. Layer uniqueness is already enforced by the step-1 partial indexes.
DROP INDEX IF EXISTS "SurveyResponse_applicationId_templateId_key";
