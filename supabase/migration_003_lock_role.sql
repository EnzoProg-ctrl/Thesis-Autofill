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
