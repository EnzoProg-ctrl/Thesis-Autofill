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
COMMENT ON COLUMN profiles.trade IS 'Staff specialty: Electrician, Plumber, HVAC, General, Security.';


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
