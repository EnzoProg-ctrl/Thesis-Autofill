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

COMMENT ON TABLE  profiles IS 'PMO admin and maintenance staff accounts.';
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
CREATE TABLE issues (
  -- Core identity
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number   TEXT        UNIQUE NOT NULL,

  -- Tenant relationship
  tenant_id       UUID        NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,

  -- Report content
  description     TEXT        NOT NULL,
  image_url       TEXT,
  user_category   TEXT,

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

  -- HITL validation
  validated       BOOLEAN     NOT NULL DEFAULT false,
  validated_by    UUID        REFERENCES profiles (id) ON DELETE SET NULL,
  validated_at    TIMESTAMPTZ,
  overridden      BOOLEAN     NOT NULL DEFAULT false,
  override_notes  TEXT
);

COMMENT ON TABLE  issues IS 'Facility issue reports submitted by tenants.';
COMMENT ON COLUMN issues.ticket_number IS 'Human-readable ID in ISS-001 format.';
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
