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
