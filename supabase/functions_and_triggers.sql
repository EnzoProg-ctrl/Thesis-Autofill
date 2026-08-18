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
