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
