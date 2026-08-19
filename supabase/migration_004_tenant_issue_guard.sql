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
