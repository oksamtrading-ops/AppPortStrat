-- APS Platform — database hardening (defense-in-depth behind the app-layer guard).
-- Apply AFTER `prisma migrate dev` with: npm run db:harden
-- Idempotent: safe to re-run after new migrations (re-run it whenever tables are added).
--
-- What this does:
--   1. Composite same-engagement FK for Application.capabilityNodeId (Prisma can't
--      express an optional composite FK alongside a required engagementId column).
--   2. CHECK: disposition overrides are restricted to the four R values.
--   3. Runtime role `aps_runtime` (non-owner, no BYPASSRLS): the application's
--      DATABASE_URL must use this role in production. Migrations/seeds run as owner.
--   4. AuditEvent is append-only at the database for the runtime role.
--   5. Row-level security on every tenant-scoped table: rows are visible only when
--      app.engagement_id matches (set per-operation by the scoped Prisma client).
--      Engagement and Membership are intentionally NOT RLS'd — they must be readable
--      to resolve the engagement context before the setting exists; they are guarded
--      at the access layer. Bank* tables are global reference data.

-- 1. Composite capability FK (MATCH SIMPLE: NULL capabilityNodeId is allowed;
--    a non-null value must belong to the same engagement).
DO $$ BEGIN
  ALTER TABLE "Application"
    ADD CONSTRAINT "Application_capability_same_engagement_fkey"
    FOREIGN KEY ("capabilityNodeId", "engagementId")
    REFERENCES "CapabilityNode"("id", "engagementId")
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Overrides are one of the four R values, never UNKNOWN.
DO $$ BEGIN
  ALTER TABLE "DispositionOverride"
    ADD CONSTRAINT "DispositionOverride_is_4r_check"
    CHECK ("disposition" IN ('REDESIGN', 'KEEP_AS_IS', 'TERMINATE', 'RETOOL'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Runtime role. Set a real password immediately after first apply:
--      ALTER ROLE aps_runtime PASSWORD '<generated>';
--    and point the app's DATABASE_URL at it (sslmode=require).
DO $$ BEGIN
  CREATE ROLE aps_runtime LOGIN PASSWORD 'CHANGE_ME_BEFORE_USE' NOBYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO aps_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aps_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aps_runtime;

-- 4. Append-only audit log for the runtime role.
REVOKE UPDATE, DELETE ON "AuditEvent" FROM aps_runtime;

-- 5. Row-level security on tenant-scoped tables.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Application', 'CapabilityNode', 'SurveyTemplate', 'SurveyQuestion',
    'GuidelineAnchor', 'QuestionWeighting', 'ThresholdConfig',
    'SurveyAssignment', 'SurveyResponse', 'Answer',
    'DispositionResult', 'DispositionOverride', 'CostRecord',
    'OptionList', 'OptionItem', 'AuditEvent'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING ("engagementId" = current_setting(''app.engagement_id'', true)) '
      || 'WITH CHECK ("engagementId" = current_setting(''app.engagement_id'', true))',
      t
    );
  END LOOP;
END $$;

-- 6. Boot-assertion helper: the app calls this at startup (instrumentation.ts)
--    and refuses to serve in a deployed environment if the backstop is not
--    actually active. Returns a reason string ('' = healthy):
--      - 'rls-not-enabled'          a tenant table has no row-level security
--      - 'runtime-role-bypasses-rls' the CONNECTED role bypasses RLS (it owns
--                                    the tenant tables, or has BYPASSRLS/super)
--    Postgres table owners and BYPASSRLS/superuser roles bypass ENABLE'd RLS,
--    so the runtime DATABASE_URL must use the non-owner aps_runtime role for
--    the backstop to bite.
CREATE OR REPLACE FUNCTION aps_rls_inactive_reason() RETURNS text AS $$
DECLARE
  tables text[] := ARRAY[
    'Application','CapabilityNode','SurveyTemplate','SurveyQuestion','GuidelineAnchor',
    'QuestionWeighting','ThresholdConfig','SurveyAssignment','SurveyResponse','Answer',
    'DispositionResult','DispositionOverride','CostRecord','OptionList','OptionItem','AuditEvent'
  ];
  unprotected int;
  bypasses boolean;
BEGIN
  SELECT count(*) INTO unprotected
  FROM unnest(tables) AS t(name)
  JOIN pg_class c ON c.relname = t.name
  WHERE NOT c.relrowsecurity;
  IF unprotected > 0 THEN RETURN 'rls-not-enabled'; END IF;

  SELECT bool_or(is_super OR is_bypass OR is_owner) INTO bypasses
  FROM (
    SELECT
      r.rolsuper AS is_super,
      r.rolbypassrls AS is_bypass,
      EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_roles o ON o.oid = c.relowner
        WHERE c.relname = ANY(tables) AND o.rolname = current_user
      ) AS is_owner
    FROM pg_roles r WHERE r.rolname = current_user
  ) s;
  IF bypasses THEN RETURN 'runtime-role-bypasses-rls'; END IF;

  RETURN '';
END;
$$ LANGUAGE plpgsql STABLE;
