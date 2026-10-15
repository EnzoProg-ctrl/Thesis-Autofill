-- ============================================================
--  setup.sql — complete database for the Nepo Mall FIRS
--
--  Run this ONCE on a NEW, empty Supabase project:
--    Supabase dashboard > SQL Editor > New query > paste this whole file > Run
--
--  It creates every table, row-level security policy, function and trigger
--  the system uses, and the starting list of safety terms. It contains no
--  user accounts and no reports.
--
--  Supabase may warn that the query "includes destructive operations". The
--  only ones are DROP ... IF EXISTS statements on objects this script itself
--  creates, so on a new project they remove nothing.
--
--  GENERATED FILE — do not edit. It is the files below, concatenated in
--  order by supabase/build_setup.py:
--     1. schema.sql
--     2. functions_and_triggers.sql
--     3. rls_policies.sql
--     4. migration_002_ai_provenance.sql
--     5. migration_003_lock_role.sql
--     6. migration_004_tenant_issue_guard.sql
--     7. migration_005_tenant_text_edits.sql
--     8. migration_006_resolved_at.sql
--     9. migration_007_tenant_signup_trigger.sql
--    10. migration_008_safety_terms.sql
--    11. migration_009_pre_override_priority.sql
--    12. migration_010_table_grants.sql
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>> 1/12  schema.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  Nepo Mall FIRS — Supabase PostgreSQL Schema
--  Tables: profiles, tenants, issues
-- ============================================================

-- =====================
--  1. PROFILES
--  (Admins & Maintenance Staff — linked to Supabase Auth)
-- =====================
CREATE TABLE profiles (
  id              UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name       TEXT        NOT NULL,
  email           TEXT        UNIQUE NOT NULL,
  role            TEXT        NOT NULL CHECK (role IN ('admin', 'staff')),
  trade           TEXT,
  avatar_initials TEXT        CHECK (char_length(avatar_initials) = 2),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  profiles IS 'Admin and maintenance staff accounts.';
COMMENT ON COLUMN profiles.trade IS 'Staff specialty. Defined in js/app-data.js TRADES: '
  'Electrician, Plumber, HVAC, Carpenter, Fire Safety, Housekeeping, General. '
  'One per issue category. Plain TEXT, not constrained — the list is enforced by the UI.';


-- =====================
--  2. TENANTS
--  (Registered store accounts — linked to Supabase Auth)
-- =====================
CREATE TABLE tenants (
  id                    UUID        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  store_name            TEXT        NOT NULL,
  floor                 TEXT        NOT NULL,
  contact_person        TEXT        NOT NULL,
  phone_number          VARCHAR(11),
  email                 TEXT        UNIQUE NOT NULL,
  privacy_consented_at  TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  tenants IS 'Registered mall tenant / store accounts.';
COMMENT ON COLUMN tenants.phone_number IS 'PH mobile format — exactly 11 digits (e.g. 09171234567).';


-- =====================
--  3. ISSUES
--  (Main ticket / report table)
-- =====================
-- NOTE (2026-08-17): this table definition had drifted from the live
-- database. The application (js/shared.js mapIssueFromDB / mapIssueToDB)
-- reads and writes `text`, `category`, `store_name`, `contact_person` and
-- `phone_number` on this table, but the file declared `description`,
-- `user_category` and no contact columns at all — so a fresh project built
-- from this file failed on every insert. The names below now match what the
-- code actually uses.
--
-- STILL UNVERIFIED: `ticket_number` is NOT NULL UNIQUE and nothing in the
-- JS ever sets it, so the live database must generate it (ISS-001 format).
-- That mechanism is not captured here — see the note under the table.
CREATE TABLE issues (
  -- Core identity
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number   TEXT        UNIQUE NOT NULL,

  -- Tenant relationship
  tenant_id       UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  -- Reporter contact, denormalised onto the report. Copied from the tenant
  -- at submission time so a report keeps the details as they were given,
  -- even if the store later updates its profile.
  store_name      TEXT,
  contact_person  TEXT,
  phone_number    VARCHAR(11),

  -- Report content
  text            TEXT        NOT NULL,
  image_url       TEXT,
  category        TEXT,

  -- Workflow
  status          TEXT        NOT NULL DEFAULT 'awaiting_review'
                              CHECK (status IN ('awaiting_review', 'in_progress', 'resolved')),
  assigned_to     UUID        REFERENCES profiles (id) ON DELETE SET NULL,

  -- Timestamps
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- AI classification
  ai_category       TEXT,
  ai_confidence     INTEGER,
  ai_priority_score INTEGER,
  ai_priority_level TEXT      CHECK (ai_priority_level IN ('critical', 'high', 'medium', 'low')),
  ai_language       TEXT,

  -- Provenance of ai_priority_score. See migration_002_ai_provenance.sql for
  -- the reasoning; kept here so a fresh install matches a migrated one.
  ai_priority_source TEXT     CHECK (ai_priority_source IS NULL
                                     OR ai_priority_source IN ('model', 'keyword', 'safety_floor')),
  ai_safety_terms    TEXT,
  ai_model_priority  TEXT,

  -- HITL validation
  validated       BOOLEAN     NOT NULL DEFAULT false,
  validated_by    UUID        REFERENCES profiles (id) ON DELETE SET NULL,
  validated_at    TIMESTAMPTZ,
  overridden      BOOLEAN     NOT NULL DEFAULT false,
  override_notes  TEXT
);

COMMENT ON TABLE  issues IS 'Facility issue reports submitted by tenants.';
COMMENT ON COLUMN issues.ticket_number IS 'Human-readable ID in ISS-001 format.';
COMMENT ON COLUMN issues.image_url IS
  'Currently holds a base64 data: URI, not a URL — see the warning below.';

-- ⚠ ticket_number HAS NO DEFAULT HERE.
--
-- The application never sets it, yet the column is NOT NULL, so the live
-- database must be generating it by a mechanism that is not in this file
-- (a DEFAULT, a sequence, or a BEFORE INSERT trigger). Until that is
-- exported from the live project, a database created from this file will
-- reject every insert.
--
-- To capture it, run in the Supabase SQL editor and paste the result here:
--
--   SELECT column_default FROM information_schema.columns
--    WHERE table_name = 'issues' AND column_name = 'ticket_number';
--
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid = 'public.issues'::regclass AND NOT tgisinternal;

-- ⚠ image_url STORES BASE64, NOT A URL.
--
-- Photos are inlined as data: URIs. Reports are now fetched WITHOUT this
-- column (js/shared.js ISSUE_LIST_COLUMNS) and the photo is loaded one at a
-- time on demand, which removes the bandwidth problem — but the proper fix
-- is Supabase Storage, with this column holding an actual object URL.
COMMENT ON COLUMN issues.ai_confidence IS 'BERT model confidence percentage (0-100).';
COMMENT ON COLUMN issues.ai_priority_score IS 'Computed priority score (0-100).';


-- =====================
--  4. AUTO-UPDATE TRIGGER
--  (Keeps updated_at current on every row change)
-- =====================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issues_updated_at
  BEFORE UPDATE ON issues
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- =====================
--  5. INDEXES
--  (Speed up common dashboard queries)
-- =====================
CREATE INDEX idx_issues_tenant_id       ON issues (tenant_id);
CREATE INDEX idx_issues_status          ON issues (status);
CREATE INDEX idx_issues_assigned_to     ON issues (assigned_to);
CREATE INDEX idx_issues_validated       ON issues (validated);
CREATE INDEX idx_issues_submitted_at    ON issues (submitted_at DESC);

-- >>>>>>>>>>>>>>>>>>>> 2/12  functions_and_triggers.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  Nepo Mall FIRS — Database Functions, Triggers & Sequences
-- ============================================================
--
--  WHY THIS FILE EXISTS
--  --------------------
--  These objects lived ONLY in the live Supabase project — they were never
--  in the repository. Anyone rebuilding the database from schema.sql alone
--  got a database that looked right and then failed on the first insert,
--  because nothing generated `ticket_number`.
--
--  Exported from the live project on 2026-08-17 and hardened at the same
--  time (see migration_003_lock_role.sql and the grants at the bottom).
--
--  APPLY ORDER
--  -----------
--    1. schema.sql                    tables and indexes
--    2. functions_and_triggers.sql    THIS FILE
--    3. rls_policies.sql              row level security
--    4. migration_002_ai_provenance.sql
--    5. migration_003_lock_role.sql
-- ============================================================


-- =====================
--  SEQUENCE
--  Backs the human-readable ticket numbers (ISS-001, ISS-002, ...).
-- =====================
CREATE SEQUENCE IF NOT EXISTS public.issue_ticket_seq;


-- =====================
--  1. generate_ticket_number()
--  BEFORE INSERT on issues.
--
--  The application never sets ticket_number — this is the only thing that
--  does. The column is nullable precisely because this fills it in.
--
--  NOTE: sequences do not roll back. A failed insert still consumes a
--  number, so gaps in the ISS- series are normal and not data loss.
-- =====================
CREATE OR REPLACE FUNCTION public.generate_ticket_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number = 'ISS-' || LPAD(nextval('issue_ticket_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_issues_ticket_number ON public.issues;
CREATE TRIGGER trg_issues_ticket_number
  BEFORE INSERT ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.generate_ticket_number();


-- =====================
--  2. update_updated_at_column()
--  BEFORE UPDATE on issues. Keeps updated_at honest.
--
--  The admin board sorts on this (getLatestActivityTime in js/shared.js),
--  so if it stops firing the "Updated Xm ago" column silently freezes.
-- =====================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_issues_updated_at ON public.issues;
CREATE TRIGGER trg_issues_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- =====================
--  3. get_user_role()
--  Resolves the caller's role: 'admin' | 'staff' | 'tenant' | NULL.
--  Profiles first, then tenants. SECURITY DEFINER so it can read both
--  tables regardless of the caller's own RLS.
-- =====================
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
  IF user_role IS NOT NULL THEN RETURN user_role; END IF;

  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = auth.uid()) THEN
    RETURN 'tenant';
  END IF;

  RETURN NULL;
END;
$$;


-- =====================
--  4. admin_create_profile(...)
--  Called by the app from js/shared.js openCreateUserModal, as a signed-in
--  admin, to create a staff or admin account.
--
--  SECURITY DEFINER so it can insert into profiles, with its own admin
--  check at the top — that check is what makes it safe to expose to
--  authenticated users at all.
-- =====================
CREATE OR REPLACE FUNCTION public.admin_create_profile(
  p_user_id         uuid,
  p_full_name       text,
  p_email           text,
  p_role            text,
  p_trade           text DEFAULT NULL,
  p_avatar_initials text DEFAULT 'SA'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: only admins can create profiles';
  END IF;

  INSERT INTO public.profiles (id, full_name, email, role, trade, avatar_initials)
  VALUES (p_user_id, p_full_name, p_email, p_role, p_trade, p_avatar_initials);
END;
$$;


-- =====================
--  5. handle_new_user()  — REMOVED 2026-08-17
--
--  This used to fire on every auth.users INSERT and hand an ADMIN profile to
--  anyone registering as 'admin@gmail.com':
--
--      IF NEW.email = 'admin@gmail.com' THEN
--        INSERT INTO public.profiles (... role 'admin' ...)
--
--  A first-run convenience that became a liability. On a public deployment
--  that address is the first thing anyone would try, and if the existing
--  account were ever deleted the next person to register it would be handed
--  admin. Dropped along with its trigger (on_auth_user_created); existing
--  profiles were unaffected.
--
--  Admins are now created ONLY through admin_create_profile(), which
--  requires the caller to already be an admin.
--
--  BOOTSTRAPPING A FRESH PROJECT
--  -----------------------------
--  With no admin, nobody can create the first one. Register the account
--  normally, then promote it once from the SQL editor:
--
--      INSERT INTO public.profiles (id, full_name, email, role, avatar_initials)
--      SELECT id, 'Your Name', email, 'admin', 'SA'
--      FROM auth.users WHERE email = 'your-real-address@example.com';
--
--  Manual and deliberate, rather than a standing rule that watches for a
--  guessable address.
-- =====================


-- =====================
--  GRANTS
--  Trigger functions are never callable over the REST API. Revoking EXECUTE
--  does NOT stop triggers firing — they run in the table owner's context.
-- =====================
REVOKE ALL ON FUNCTION public.update_updated_at_column()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_ticket_number()      FROM PUBLIC, anon, authenticated;

REVOKE ALL     ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_role() TO authenticated;

REVOKE ALL     ON FUNCTION public.admin_create_profile(uuid, text, text, text, text, text)
               FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_create_profile(uuid, text, text, text, text, text)
               TO authenticated;

-- >>>>>>>>>>>>>>>>>>>> 3/12  rls_policies.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  Nepo Mall FIRS — Row Level Security Policies
-- ============================================================

-- =====================
--  ENABLE RLS ON ALL TABLES
-- =====================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues   ENABLE ROW LEVEL SECURITY;

-- =====================
--  HELPER: Get current user's role
-- =====================
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
  IF user_role IS NOT NULL THEN RETURN user_role; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = auth.uid()) THEN
    RETURN 'tenant';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
--  PROFILES POLICIES
-- ============================================================

-- All authenticated users can read profiles (needed for assignment dropdowns)
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can update their own profile
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Only admins can insert new profiles (create staff/admin accounts)
CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only admins can delete profiles
CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
--  TENANTS POLICIES
-- ============================================================

-- Admins, staff, and the tenant themselves can read tenant records
CREATE POLICY "tenants_select_admin_staff"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
    OR id = auth.uid()
  );

-- New tenants can register themselves
CREATE POLICY "tenants_insert_self"
  ON public.tenants FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Tenants can update their own record
CREATE POLICY "tenants_update_own"
  ON public.tenants FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Only admins can delete tenants
CREATE POLICY "tenants_delete_admin"
  ON public.tenants FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
--  ISSUES POLICIES
-- ============================================================

-- Tenants can read their own issues
CREATE POLICY "issues_select_tenant_own"
  ON public.issues FOR SELECT
  TO authenticated
  USING (tenant_id = auth.uid());

-- Admins can read ALL issues
CREATE POLICY "issues_select_admin"
  ON public.issues FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Staff can read assigned issues + awaiting_review pipeline
CREATE POLICY "issues_select_staff"
  ON public.issues FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
    AND (assigned_to = auth.uid() OR status = 'awaiting_review')
  );

-- Tenants can submit new issues
CREATE POLICY "issues_insert_tenant"
  ON public.issues FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = auth.uid());

-- Tenants can update own issues only while awaiting_review
CREATE POLICY "issues_update_tenant_own"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (tenant_id = auth.uid() AND status = 'awaiting_review')
  WITH CHECK (tenant_id = auth.uid());

-- Admins can update any issue
CREATE POLICY "issues_update_admin"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Staff can update issues assigned to them
CREATE POLICY "issues_update_staff"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
    AND assigned_to = auth.uid()
  );

-- Tenants can delete own issues while awaiting_review
CREATE POLICY "issues_delete_tenant_own"
  ON public.issues FOR DELETE
  TO authenticated
  USING (tenant_id = auth.uid() AND status = 'awaiting_review');

-- Admins can delete any issue
CREATE POLICY "issues_delete_admin"
  ON public.issues FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- >>>>>>>>>>>>>>>>>>>> 4/12  migration_002_ai_provenance.sql >>>>>>>>>>>>>>>>>>>>

-- =====================================================================
--  migration_002_ai_provenance.sql
--  Record WHERE a report's priority came from.
--
--  Run against an existing database. schema.sql is left alone so a fresh
--  install and a migrated install do not drift; the same columns are added
--  there for new deployments.
-- =====================================================================
--
--  Why this exists
--  ---------------
--  The app already stores ai_priority_score, but not how it was produced.
--  Three different things can set it, and they are not equally trustworthy:
--
--    'model'         the trained XLM-R priority head
--    'keyword'       the fallback scorer in js/keyword-classifier.js, used
--                    when the service is unreachable. It is markedly worse on
--                    Taglish — it scored "May naipit na tao sa pinto"
--                    (a person is trapped in a door) at 38/low.
--    'safety_floor'  the deterministic keyword floor raised it to High
--
--  Without this, a day when the inference service was down is indistinguishable
--  from a normal day, and nobody can tell which reports were triaged by the
--  weak scorer. It also makes the safety floor auditable: when a report is
--  routed High on the strength of the word "sunog", that fact should be on the
--  record, along with what the model actually said.
--
--  This is an audit trail, not a feature. It costs three nullable columns.
-- =====================================================================

ALTER TABLE issues
  ADD COLUMN IF NOT EXISTS ai_priority_source   TEXT,
  ADD COLUMN IF NOT EXISTS ai_safety_terms      TEXT,
  ADD COLUMN IF NOT EXISTS ai_model_priority    TEXT;

-- Constrained rather than free text: an unrecognised value here means the
-- client and the service have drifted, and that should fail loudly.
ALTER TABLE issues
  DROP CONSTRAINT IF EXISTS issues_ai_priority_source_check;
ALTER TABLE issues
  ADD CONSTRAINT issues_ai_priority_source_check
  CHECK (ai_priority_source IS NULL
         OR ai_priority_source IN ('model', 'keyword', 'safety_floor'));

COMMENT ON COLUMN issues.ai_priority_source IS
  'Which mechanism set ai_priority_score: model | keyword | safety_floor. '
  'NULL for rows predating this migration.';
COMMENT ON COLUMN issues.ai_safety_terms IS
  'Comma-separated danger keywords found in the report text (sunog, usok, '
  'apoy, nakuryente, naipit, trapped, smoke, sparks). Populated whenever any '
  'are present, even if the model had already reached High unaided.';
COMMENT ON COLUMN issues.ai_model_priority IS
  'The level the MODEL predicted, when the safety floor overrode it. Kept so a '
  'reviewer can see the two disagreed rather than only seeing the final answer.';

-- Finding every floor-triggered report is a routine audit question
-- ("what did we escalate on keywords last month, and was it justified?"),
-- so it gets an index rather than a sequential scan.
CREATE INDEX IF NOT EXISTS idx_issues_ai_priority_source
  ON issues (ai_priority_source)
  WHERE ai_priority_source IS NOT NULL;

-- >>>>>>>>>>>>>>>>>>>> 5/12  migration_003_lock_role.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_003_lock_role.sql
--  Stop users from changing their own `role`.
-- ============================================================
--
--  THE HOLE
--  --------
--  rls_policies.sql grants:
--
--      CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE
--        USING (id = auth.uid()) WITH CHECK (id = auth.uid());
--
--  That is row-level, not column-level. It says "you may update your own
--  row" and says nothing about WHICH columns, so a staff account can run
--
--      supabase.from('profiles').update({ role: 'admin' }).eq('id', myId)
--
--  and become an admin. The CHECK constraint on the column does not help —
--  it permits both 'admin' and 'staff'. Postgres RLS cannot express
--  "every column except this one", so the restriction has to be a trigger.
--
--  WHAT THIS DOES
--  --------------
--  Rejects any UPDATE that changes `role` unless the caller is already an
--  admin. Admins keep the ability to promote or demote people, which is how
--  the Manage Users screen works. Everything else about profile editing
--  (full_name, trade, avatar_initials) is untouched.
--
--  Runs BEFORE UPDATE so the write never lands. The app does not currently
--  send `role` on a profile edit, so this changes no legitimate behaviour —
--  it closes the path a crafted request could take.
--
--  APPLY WITH
--  ----------
--  Supabase dashboard > SQL Editor > paste > Run.
--  Safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_self_role_change()
RETURNS TRIGGER AS $$
BEGIN
  -- Nothing to police if the role is not being changed.
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Role IS changing. Only an existing admin may do that.
  --
  -- Read the CURRENT caller's role directly from the table rather than
  -- through get_user_role(), so this cannot be influenced by the row being
  -- written in this same statement.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Permission denied: role can only be changed by an admin.'
    USING ERRCODE = '42501';   -- insufficient_privilege
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_profiles_prevent_role_change ON public.profiles;

CREATE TRIGGER trg_profiles_prevent_role_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_role_change();

COMMENT ON FUNCTION public.prevent_self_role_change() IS
  'Blocks role escalation: profiles_update_own is row-level and would '
  'otherwise let any user set their own role to admin.';

-- ============================================================
--  VERIFY (run while signed in as a STAFF user — should fail)
--
--    UPDATE public.profiles SET role = 'admin' WHERE id = auth.uid();
--    -- ERROR: Permission denied: role can only be changed by an admin.
--
--  And that a normal profile edit still works:
--
--    UPDATE public.profiles SET full_name = 'New Name' WHERE id = auth.uid();
--    -- UPDATE 1
-- ============================================================

-- >>>>>>>>>>>>>>>>>>>> 6/12  migration_004_tenant_issue_guard.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_004_tenant_issue_guard.sql
--  Stop a tenant from reviewing, routing, or re-opening their own report.
-- ============================================================
--
--  THE HOLE
--  --------
--  rls_policies.sql grants:
--
--      CREATE POLICY "issues_update_tenant_own" ON public.issues FOR UPDATE
--        USING (tenant_id = auth.uid() AND status = 'awaiting_review')
--        WITH CHECK (tenant_id = auth.uid());
--
--  USING gates the row as it stood BEFORE the write; WITH CHECK gates it
--  after. Neither says anything about WHICH COLUMNS, because Postgres RLS is
--  row-level and cannot express "every column except these". So the policy
--  reads as "you may edit your own report while it is awaiting review" and
--  actually means "you may set ANY column on your own report while it is
--  awaiting review".
--
--  There is no server in front of the database — the browser talks to Postgres
--  directly with a publishable anon key and the tenant's own session token, so
--  the edit form is not a control. A tenant can send:
--
--      supabase.from('issues')
--        .update({ validated: true, ai_priority_level: 'critical' })
--        .eq('id', myIssueId)
--
--  and their report leaves the HITL queue marked human-reviewed, having been
--  reviewed by nobody. That defeats the human-in-the-loop design outright.
--
--  WHAT THIS DOES
--  --------------
--  A BEFORE UPDATE trigger that, when the caller is the tenant who owns the
--  row, rejects any change to the columns that belong to review and dispatch:
--  status, assigned_to, validated_by, validated_at, overridden,
--  override_notes, pre_override_priority_level, tenant_id, ticket_number,
--  submitted_at. `validated` may be set to FALSE but never to TRUE.
--
--  Admin and staff callers return immediately — their own RLS policies
--  already scope what they may touch, and admins legitimately set every
--  column above. Service-role calls (SQL editor, dashboard) are unaffected.
--
--  WHAT THIS DELIBERATELY DOES *NOT* CLOSE
--  ---------------------------------------
--  The ai_* columns stay writable by the tenant, because the tenant edit flow
--  legitimately writes them: tenant/home.html saveReport re-runs the
--  classifier IN THE BROWSER when the description changes and writes the
--  result back. The priority therefore arrives from the client and a
--  determined tenant can still forge it.
--
--  That is a real limitation and it is not fixable with a trigger. Closing it
--  means classifying server-side on write — a database function calling the
--  inference service, or an edge function owning the insert/update. Out of
--  scope here.
--
--  What this migration guarantees is narrower and is the part the thesis
--  rests on: a report cannot leave the review queue without a reviewer, and a
--  tenant cannot route work to a technician or reopen a closed job.
--
--  APPLY WITH
--  ----------
--  Supabase dashboard > SQL Editor > paste > Run. Safe to run more than once.
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_tenant_issue_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Admin and staff are policed by their own RLS policies, not by this.
  -- Checked against profiles rather than get_user_role() so the answer cannot
  -- be influenced by the row being written in this same statement.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Not the owning tenant. RLS has already rejected anyone who is neither
  -- owner nor staff, so this is the service role (auth.uid() IS NULL) doing
  -- maintenance. Leave it alone.
  IF auth.uid() IS DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  -- Review and dispatch state. None of this is the reporter's to set.
  IF NEW.status                      IS DISTINCT FROM OLD.status
  OR NEW.assigned_to                 IS DISTINCT FROM OLD.assigned_to
  OR NEW.validated_by                IS DISTINCT FROM OLD.validated_by
  OR NEW.validated_at                IS DISTINCT FROM OLD.validated_at
  OR NEW.overridden                  IS DISTINCT FROM OLD.overridden
  OR NEW.override_notes              IS DISTINCT FROM OLD.override_notes
  OR NEW.pre_override_priority_level IS DISTINCT FROM OLD.pre_override_priority_level
  OR NEW.tenant_id                   IS DISTINCT FROM OLD.tenant_id
  OR NEW.ticket_number               IS DISTINCT FROM OLD.ticket_number
  OR NEW.submitted_at                IS DISTINCT FROM OLD.submitted_at
  THEN
    RAISE EXCEPTION
      'Permission denied: a tenant may only edit the description and category of their own report.'
      USING ERRCODE = '42501';
  END IF;

  -- `validated` is allowed to go TRUE -> FALSE: editing the description
  -- retires a sign-off made against wording that no longer exists, and
  -- saveReport sends validated:false to push the report back into the queue.
  -- The reverse is the whole attack.
  IF NEW.validated AND NOT OLD.validated THEN
    RAISE EXCEPTION
      'Permission denied: a report cannot be marked validated by the tenant who filed it.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Name sorts before trg_issues_ticket_number and trg_issues_updated_at, so
-- this runs FIRST and compares the values the client actually sent, before
-- update_updated_at_column() rewrites updated_at.
DROP TRIGGER IF EXISTS trg_issues_guard_tenant_update ON public.issues;

CREATE TRIGGER trg_issues_guard_tenant_update
  BEFORE UPDATE ON public.issues
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_tenant_issue_update();

COMMENT ON FUNCTION public.guard_tenant_issue_update() IS
  'Blocks HITL bypass: issues_update_tenant_own is row-level and would '
  'otherwise let a tenant set validated, status or assigned_to on their own report.';

-- Same treatment functions_and_triggers.sql gives the other two trigger
-- functions. Revoking EXECUTE does NOT stop the trigger firing — triggers run
-- in the table owner's context, not the caller's — it only removes the
-- function from the REST surface. Postgres would refuse a direct call anyway
-- ("trigger functions can only be called as triggers"), so this is hygiene
-- rather than a hole being closed; without it the Supabase security advisor
-- reports the function as callable by anon and authenticated.
REVOKE ALL ON FUNCTION public.guard_tenant_issue_update()
  FROM PUBLIC, anon, authenticated;

-- ============================================================
--  VERIFY (run in the browser console, signed in as a TENANT, on
--  tenant/home.html, against one of your own awaiting_review reports)
--
--    // should FAIL with 42501
--    await supabase.from('issues').update({ validated: true }).eq('id', ID);
--
--    // should FAIL with 42501
--    await supabase.from('issues').update({ status: 'resolved' }).eq('id', ID);
--
--    // should SUCCEED — this is the normal edit path
--    await supabase.from('issues')
--      .update({ text: 'updated description here', validated: false })
--      .eq('id', ID);
-- ============================================================

-- >>>>>>>>>>>>>>>>>>>> 7/12  migration_005_tenant_text_edits.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_005_tenant_text_edits.sql
--
--  Records when a tenant last revised their report description.
--
--  WHY IT IS SEPARATE FROM updated_at
--  ----------------------------------
--  updated_at moves on ANY write to the row — a status change, an assignment,
--  a reviewer override. It therefore cannot answer "did the tenant change what
--  they originally wrote", which matters because the classification was made
--  against the original text. A report whose description was edited after
--  submission carries a classification for wording that no longer exists.
--
--  RECONSTRUCTED 2026-09-10. This column was applied directly to the live
--  database as `track_tenant_text_edits` and never committed, so a fresh
--  install from this folder produced a schema without it. js/shared.js names
--  text_edited_at in ISSUE_LIST_COLUMNS, so the report list query failed
--  outright rather than degrading — the column is not optional.
--
--  APPLY ORDER: after migration_004_tenant_issue_guard.sql
-- ============================================================

ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS text_edited_at TIMESTAMPTZ;

COMMENT ON COLUMN public.issues.text_edited_at IS
  'When the tenant last edited the report description. NULL if the text has '
  'never changed since submission. Distinct from updated_at, which any update '
  'bumps. Set by the tenant edit flow in tenant/home.html.';

-- >>>>>>>>>>>>>>>>>>>> 8/12  migration_006_resolved_at.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_006_resolved_at.sql
--  Record WHEN a report was resolved, instead of inferring it.
-- ============================================================
--
--  THE PROBLEM
--  -----------
--  There was no resolution timestamp, so every resolution-time figure in the
--  analytics page was computed as `updated_at - submitted_at`. updated_at is
--  bumped by ANY write — validation, assignment, an override, a tenant edit —
--  so the metric actually measured "time until somebody last touched this
--  row", which is not a repair time and does not stop moving once the repair
--  is done.
--
--  Measured on 2026-08-19: ISS-034 showed 22.2 h, but its updated_at was that
--  same afternoon and it was not even validated yet. Opening it again the next
--  day would have "increased" the repair time to 46 h with no work performed.
--
--  WHAT THIS DOES
--  --------------
--  Adds issues.resolved_at, set by a trigger the moment status becomes
--  'resolved', and cleared if a report is reopened — a resolution that did not
--  hold should not keep its timestamp.
--
--  A trigger rather than application code: status is written from the admin
--  board, the staff board and the SQL editor, and a timestamp that depends on
--  which screen someone used is worse than none.
--
--  EXISTING ROWS ARE LEFT NULL, DELIBERATELY
--  -----------------------------------------
--  Backfilling from updated_at would bake today's guess into the column and
--  make approximate rows indistinguishable from measured ones. NULL says "this
--  predates measurement", which is the honest state and is filterable:
--
--      -- only reports with a real resolution time
--      SELECT * FROM issues WHERE resolved_at IS NOT NULL;
--
--  js/analytics.js falls back to updated_at when resolved_at is NULL, so the
--  charts keep working on historical rows while every new resolution during
--  the pilot is exact.
--
--  Run this BEFORE the pilot. The formula can be corrected at any time; the
--  timestamps cannot be recovered afterwards.
--
--  APPLY WITH
--  ----------
--  Supabase dashboard > SQL Editor > paste > Run. Safe to run more than once.
-- ============================================================

ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

COMMENT ON COLUMN public.issues.resolved_at IS
  'When status last became ''resolved''. NULL if never resolved, if reopened, '
  'or if the report predates migration_006. Unlike updated_at this does not '
  'move when the row is edited afterwards, so it is the only trustworthy '
  'basis for resolution-time metrics.';

CREATE OR REPLACE FUNCTION public.set_resolved_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- OLD is not assigned on INSERT, so the two cases cannot share a branch.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'resolved' THEN
      NEW.resolved_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
    NEW.resolved_at := now();          -- resolved just now
  ELSIF NEW.status IS DISTINCT FROM 'resolved' THEN
    NEW.resolved_at := NULL;           -- reopened: the resolution did not hold
  END IF;
  -- Still resolved and staying resolved: leave the original timestamp alone,
  -- which is the entire point of not using updated_at.
  RETURN NEW;
END;
$$;

-- Name sorts after trg_issues_guard_tenant_update, so the tenant guard has
-- already rejected anything it should before this writes a timestamp.
DROP TRIGGER IF EXISTS trg_issues_resolved_at ON public.issues;

CREATE TRIGGER trg_issues_resolved_at
  BEFORE INSERT OR UPDATE ON public.issues
  FOR EACH ROW
  EXECUTE FUNCTION public.set_resolved_at();

-- Trigger functions are never callable over the REST API, and revoking EXECUTE
-- does not stop the trigger firing. Without this the Supabase security advisor
-- reports the function as callable by anon and authenticated.
REVOKE ALL ON FUNCTION public.set_resolved_at() FROM PUBLIC, anon, authenticated;


-- ============================================================
--  Tenants must not be able to write this column either.
--  Extends the guard from migration_004 — resolved_at is dispatch state, and
--  a tenant who could set it would be writing the mall's own KPI.
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_tenant_issue_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;

  IF NEW.status                      IS DISTINCT FROM OLD.status
  OR NEW.assigned_to                 IS DISTINCT FROM OLD.assigned_to
  OR NEW.validated_by                IS DISTINCT FROM OLD.validated_by
  OR NEW.validated_at                IS DISTINCT FROM OLD.validated_at
  OR NEW.resolved_at                 IS DISTINCT FROM OLD.resolved_at
  OR NEW.overridden                  IS DISTINCT FROM OLD.overridden
  OR NEW.override_notes              IS DISTINCT FROM OLD.override_notes
  OR NEW.pre_override_priority_level IS DISTINCT FROM OLD.pre_override_priority_level
  OR NEW.tenant_id                   IS DISTINCT FROM OLD.tenant_id
  OR NEW.ticket_number               IS DISTINCT FROM OLD.ticket_number
  OR NEW.submitted_at                IS DISTINCT FROM OLD.submitted_at
  THEN
    RAISE EXCEPTION
      'Permission denied: a tenant may only edit the description and category of their own report.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.validated AND NOT OLD.validated THEN
    RAISE EXCEPTION
      'Permission denied: a report cannot be marked validated by the tenant who filed it.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_tenant_issue_update()
  FROM PUBLIC, anon, authenticated;

-- ============================================================
--  VERIFY
--    UPDATE issues SET status='resolved' WHERE ticket_number='ISS-XXX';
--    SELECT resolved_at FROM issues WHERE ticket_number='ISS-XXX';  -- now()
--    UPDATE issues SET status='in_progress' WHERE ticket_number='ISS-XXX';
--    SELECT resolved_at FROM issues WHERE ticket_number='ISS-XXX';  -- NULL
-- ============================================================

-- >>>>>>>>>>>>>>>>>>>> 9/12  migration_007_tenant_signup_trigger.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_007_tenant_signup_trigger.sql
--
--  WHY THIS EXISTS
--  ---------------
--  Email confirmation was disabled in Supabase Auth, so any syntactically
--  valid address was accepted and marked confirmed without a verification
--  email ever being sent. A tenant could register as jamderoa@gmai.com — a
--  real typo already present in this database — and no format check can
--  catch that. Only sending mail and requiring a click can.
--
--  Enabling "Confirm email" alone BREAKS registration. The RLS policy
--  tenants_insert_self grants INSERT only TO authenticated WITH CHECK
--  (id = auth.uid()). With confirmation off, signUp returns a live session,
--  so the browser is authenticated and the insert succeeds. With
--  confirmation on, signUp returns NO session — the browser is still anon
--  and the insert is rejected. The result is an auth account with no store
--  record, which is worse than the bug being fixed.
--
--  WHAT THIS DOES
--  --------------
--  Moves the tenants INSERT off the browser and onto the database. The
--  store details ride along with signUp as user metadata; this trigger
--  reads them and writes the row itself. Because it is SECURITY DEFINER it
--  is not subject to RLS, so it works whether or not a session exists —
--  which means "Confirm email" can now be switched on safely.
--
--  APPLY ORDER: after migration_006_resolved_at.sql
--
--  AFTER APPLYING, enable the setting:
--    Dashboard > Authentication > Sign In / Providers > Email > Confirm email
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
BEGIN
  /* Self-registering tenants send store details as signUp metadata. Admin
     and staff accounts are created through admin_create_profile and carry
     none, so they fall straight through untouched. Keying on store_name
     rather than a boolean flag means a client cannot opt out of the store
     record by omitting the flag while still sending the details. */
  IF meta->>'store_name' IS NULL THEN
    RETURN NEW;
  END IF;

  /* ON CONFLICT keeps this idempotent. Supabase can re-run a signUp for an
     unconfirmed address, and without this the second attempt would fail on
     the primary key and take the whole signUp down with it.

     The email is taken from auth.users rather than from the metadata: that
     is the address the confirmation link was actually sent to, and it is
     the only one whose ownership will have been proven. Trusting a
     client-supplied metadata email here would reintroduce exactly the hole
     this migration closes. */
  INSERT INTO public.tenants (
    id, store_name, floor, contact_person, phone_number,
    email, privacy_consented_at
  )
  VALUES (
    NEW.id,
    meta->>'store_name',
    meta->>'floor',
    meta->>'contact_person',
    NULLIF(meta->>'phone_number', ''),
    lower(trim(NEW.email)),
    now()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_tenant() IS
  'Creates the public.tenants row for a self-registering tenant from signUp '
  'metadata. SECURITY DEFINER so it does not need a browser session, which '
  'is what allows email confirmation to be enabled.';

DROP TRIGGER IF EXISTS trg_auth_user_new_tenant ON auth.users;
CREATE TRIGGER trg_auth_user_new_tenant
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_tenant();

/* Nothing should call this directly — it runs only as a trigger. Leaving it
   callable would let a signed-in user invoke it with arbitrary arguments. */
REVOKE ALL ON FUNCTION public.handle_new_tenant() FROM PUBLIC, anon, authenticated;

-- >>>>>>>>>>>>>>>>>>>> 10/12  migration_008_safety_terms.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_008_safety_terms.sql
--
--  Moves the safety-floor word list out of code and into the database, so a
--  Property Management Office admin can add, disable or remove terms without
--  a developer and a redeploy. Requested at the final defense.
--
--  Before this, the list was hardcoded twice — serving/serve.py (server) and
--  js/bert-api.js (browser) — and a change meant editing both and redeploying
--  the Hugging Face Space. Both now read this table and fall back to their
--  built-in list only when it is unreachable or returns no danger terms.
--
--  SHAPE
--  -----
--  One row per string that is matched, not one row per regex. Admins never
--  write patterns: the English entries used to be regexes such as
--  smok(?:e|es|ing|y), and a regex field would let one typo match every report
--  or hang the matcher. Inflections are separate rows sharing a `label` —
--  smoke / smokes / smoking / smoky all report as "smoke" — which reproduces
--  the old patterns exactly.
--
--    kind='danger',    match_type='substring'  Tagalog stems. "usok" also
--                                              matches "umuusok".
--    kind='danger',    match_type='word'       Whole words only, so "spark"
--                                              does not fire on "sparkling".
--    kind='exclusion', match_type='phrase'     Device names blanked BEFORE
--                                              matching — "smoke detector".
--
--  ACCESS
--  ------
--  The table itself is admin-only. Everyone else — including tenants' browsers
--  and the inference service, which calls as anon — reads through
--  get_safety_terms(), which returns only the columns needed to match. That
--  keeps notes and who-added-what private without a security-definer VIEW,
--  which Supabase's linter reports as an error. The function does draw the
--  lower-severity "security definer function executable" warning; that is
--  intentional here, and it only ever reads.
--
--  APPLY ORDER: after migration_007_tenant_signup_trigger.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.safety_terms (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT        NOT NULL,
  match_type  TEXT        NOT NULL,
  term        TEXT        NOT NULL,
  label       TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 500,
  note        TEXT,
  created_by  UUID        REFERENCES public.profiles (id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT safety_terms_kind_match CHECK (
    (kind = 'danger'    AND match_type IN ('substring', 'word')) OR
    (kind = 'exclusion' AND match_type = 'phrase')
  ),

  /* Letters only (plus ñ), lowercase, and long enough to mean something.
     A two-letter substring like "na" appears in almost every Tagalog report
     and would floor all of them to High. Phrases need at least two words. */
  CONSTRAINT safety_terms_term_shape CHECK (
    char_length(term) BETWEEN 3 AND 60 AND
    term = lower(term) AND
    (
      (match_type IN ('substring', 'word') AND term ~ '^[a-zñ]+$') OR
      (match_type = 'phrase'               AND term ~ '^[a-zñ]+([ -][a-zñ]+)+$')
    )
  ),

  CONSTRAINT safety_terms_label_shape CHECK (
    char_length(label) BETWEEN 3 AND 60 AND label = lower(label)
  ),

  CONSTRAINT safety_terms_unique UNIQUE (kind, match_type, term)
);

COMMENT ON TABLE public.safety_terms IS
  'Safety-floor vocabulary. Danger terms raise a report to at least High; '
  'exclusion phrases are blanked before matching. Read publicly through '
  'get_safety_terms(); writable by admins only.';


-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public.safety_terms_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_terms_touch ON public.safety_terms;
CREATE TRIGGER trg_safety_terms_touch
  BEFORE UPDATE ON public.safety_terms
  FOR EACH ROW EXECUTE FUNCTION public.safety_terms_touch();


-- ---------- never leave the floor empty ----------
/* Disabling or deleting the last active danger term would silently switch
   the safety guarantee off. Refused here rather than only in the admin page,
   so it holds for the SQL editor too. (The server and browser also fall back
   to their built-in list if they ever receive zero danger terms.) */
CREATE OR REPLACE FUNCTION public.safety_terms_keep_one()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.safety_terms
      WHERE kind = 'danger' AND active) = 0 THEN
    RAISE EXCEPTION 'At least one active danger term is required — the safety floor cannot be left empty.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_safety_terms_keep_one ON public.safety_terms;
CREATE CONSTRAINT TRIGGER trg_safety_terms_keep_one
  AFTER UPDATE OR DELETE ON public.safety_terms
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION public.safety_terms_keep_one();


-- ---------- access ----------
ALTER TABLE public.safety_terms ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.safety_terms FROM anon;
REVOKE ALL ON public.safety_terms FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_terms TO authenticated;

DROP POLICY IF EXISTS "safety_terms_admin_select" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_select"
  ON public.safety_terms FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "safety_terms_admin_insert" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_insert"
  ON public.safety_terms FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "safety_terms_admin_update" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_update"
  ON public.safety_terms FOR UPDATE
  TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "safety_terms_admin_delete" ON public.safety_terms;
CREATE POLICY "safety_terms_admin_delete"
  ON public.safety_terms FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));


-- ---------- public read path ----------
/* The only way non-admins read the list. Active rows, matching columns only.
   Ordered so every caller builds the same matched_terms order. */
CREATE OR REPLACE FUNCTION public.get_safety_terms()
RETURNS TABLE (kind TEXT, match_type TEXT, term TEXT, label TEXT, sort_order INTEGER)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT st.kind, st.match_type, st.term, st.label, st.sort_order
  FROM public.safety_terms st
  WHERE st.active
  ORDER BY st.kind, st.sort_order, st.term;
$$;

REVOKE ALL ON FUNCTION public.get_safety_terms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_safety_terms() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.safety_terms_touch()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.safety_terms_keep_one() FROM PUBLIC, anon, authenticated;


-- ---------- seed: exactly the list that was hardcoded ----------
/* Reproduces serve.py / bert-api.js as of 2026-09-16:
     substrings  sunog usok apoy nakuryente nakoryente naipit naiipit
     words       trapped · smok(?:e|es|ing|y) · spark(?:s|ed|ing)?
     exclusions  smoke[\s-]?(detector|detectors|alarm|alarms|sensor|sensors)
                 no[\s-]smoking · smoking[\s-]area · smoke[\s-]free
   created_by is NULL: these came from the original build, not an admin. */
INSERT INTO public.safety_terms (kind, match_type, term, label, sort_order, note, created_by) VALUES
  ('danger', 'substring', 'sunog',      'sunog',      10, 'Fire / burning: sunog, nasusunog, amoy sunog', NULL),
  ('danger', 'substring', 'usok',       'usok',       20, 'Smoke: usok, umuusok, mausok', NULL),
  ('danger', 'substring', 'apoy',       'apoy',       30, 'Flame. Added 2026-08-13 after the only severe underestimate in the test set.', NULL),
  ('danger', 'substring', 'nakuryente', 'nakuryente', 40, 'A person was shocked. Bare "kuryente" (electricity) is deliberately absent.', NULL),
  ('danger', 'substring', 'nakoryente', 'nakoryente', 50, 'Common spelling of nakuryente.', NULL),
  ('danger', 'substring', 'naipit',     'naipit',     60, 'Trapped / caught: naipit, na-ipit', NULL),
  ('danger', 'substring', 'naiipit',    'naiipit',    70, 'Trapped, progressive form. Not a substring of naipit.', NULL),

  ('danger', 'word', 'trapped',  'trapped', 110, NULL, NULL),
  ('danger', 'word', 'smoke',    'smoke',   120, NULL, NULL),
  ('danger', 'word', 'smokes',   'smoke',   121, NULL, NULL),
  ('danger', 'word', 'smoking',  'smoke',   122, NULL, NULL),
  ('danger', 'word', 'smoky',    'smoke',   123, NULL, NULL),
  ('danger', 'word', 'spark',    'sparks',  130, 'Whole word, so "sparkling" does not fire.', NULL),
  ('danger', 'word', 'sparks',   'sparks',  131, NULL, NULL),
  ('danger', 'word', 'sparked',  'sparks',  132, NULL, NULL),
  ('danger', 'word', 'sparking', 'sparks',  133, NULL, NULL),

  ('exclusion', 'phrase', 'smoke detector',  'smoke detector',  210, 'Device name, not an event.', NULL),
  ('exclusion', 'phrase', 'smoke detectors', 'smoke detector',  211, NULL, NULL),
  ('exclusion', 'phrase', 'smoke alarm',     'smoke alarm',     220, NULL, NULL),
  ('exclusion', 'phrase', 'smoke alarms',    'smoke alarm',     221, NULL, NULL),
  ('exclusion', 'phrase', 'smoke sensor',    'smoke sensor',    230, NULL, NULL),
  ('exclusion', 'phrase', 'smoke sensors',   'smoke sensor',    231, NULL, NULL),
  ('exclusion', 'phrase', 'no smoking',      'no smoking',      240, 'Signage, not an event.', NULL),
  ('exclusion', 'phrase', 'smoking area',    'smoking area',    250, NULL, NULL),
  ('exclusion', 'phrase', 'smoke free',      'smoke free',      260, NULL, NULL)
ON CONFLICT (kind, match_type, term) DO NOTHING;

-- >>>>>>>>>>>>>>>>>>>> 11/12  migration_009_pre_override_priority.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_009_pre_override_priority.sql
--
--  Records the priority the system assigned before a reviewer changed it.
--
--  When an administrator overrides a report's priority in the HITL queue,
--  js/hitl.js writes the level the report had at that moment into this
--  column, once, before applying the reviewer's choice. The original answer
--  therefore survives the correction, which is what makes reviewer
--  disagreement measurable afterwards (see the Human-in-the-Loop results).
--  NULL means the reviewer never changed the priority.
--
--  RECONSTRUCTED 2026-10-15. Like text_edited_at (migration_005), this column
--  was added directly to the live database and never committed, so a database
--  built from this folder lacked it. That was not harmless: js/shared.js
--  names it in ISSUE_LIST_COLUMNS, so the report list query failed and every
--  dashboard came up empty, and guard_tenant_issue_update() (migrations 004
--  and 006) reads NEW.pre_override_priority_level, so a tenant editing their
--  own report failed with 'record "new" has no field'.
--
--  IF NOT EXISTS makes this a no-op on the original database, where the
--  column already exists.
--
--  APPLY ORDER: after migration_008_safety_terms.sql
-- ============================================================

ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS pre_override_priority_level TEXT
    CONSTRAINT issues_pre_override_priority_level_check
    CHECK (pre_override_priority_level IN ('critical', 'high', 'medium', 'low'));

COMMENT ON COLUMN public.issues.pre_override_priority_level IS
  'The priority level assigned before a reviewer overrode it in the HITL '
  'queue. Written once, at the first override. NULL if the reviewer never '
  'changed the priority.';

-- >>>>>>>>>>>>>>>>>>>> 12/12  migration_010_table_grants.sql >>>>>>>>>>>>>>>>>>>>

-- ============================================================
--  migration_010_table_grants.sql
--
--  Grants the Supabase API roles access to the core tables explicitly.
--
--  The original project was created when every new Supabase project granted
--  anon, authenticated and service_role full privileges on anything created
--  in the public schema. The tables in schema.sql relied on that default and
--  never granted access themselves; row-level security (rls_policies.sql) is
--  what actually limits each role to its own rows.
--
--  New projects now offer to turn that default off ("Automatically expose
--  new tables", which Supabase recommends disabling). On such a project,
--  setup.sql built every table but a store's first report failed with
--  "permission denied for table issues", because nothing had granted it.
--  This file states the grants the original project has, so the result no
--  longer depends on how the project was created.
--
--  Access is unchanged: these are the privileges the original database
--  already gives these roles, and RLS still decides which rows each one may
--  read or change. safety_terms is not listed; migration_008 sets its
--  narrower grants deliberately.
--
--  A no-op on the original database, where the grants already exist.
--
--  APPLY ORDER: after migration_009_pre_override_priority.sql
-- ============================================================

GRANT ALL ON TABLE public.profiles, public.tenants, public.issues
  TO anon, authenticated, service_role;

-- A store's report takes its ticket number from this sequence.
GRANT ALL ON SEQUENCE public.issue_ticket_seq
  TO anon, authenticated, service_role;
