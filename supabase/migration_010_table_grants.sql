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
