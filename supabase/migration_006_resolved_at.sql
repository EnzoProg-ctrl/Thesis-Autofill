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
