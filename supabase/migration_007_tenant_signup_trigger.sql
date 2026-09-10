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
