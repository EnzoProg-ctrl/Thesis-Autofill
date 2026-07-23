-- ============================================================
--  Nepo Mall FIRS — Row Level Security Policies
-- ============================================================

-- =====================
--  ENABLE RLS ON ALL TABLES
-- =====================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues   ENABLE ROW LEVEL SECURITY;

-- =====================
--  HELPER: Get current user's role
-- =====================
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================
--  PROFILES POLICIES
-- ============================================================

-- All authenticated users can read profiles (needed for assignment dropdowns)
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can update their own profile
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Only admins can insert new profiles (create staff/admin accounts)
CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Only admins can delete profiles
CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
--  TENANTS POLICIES
-- ============================================================

-- Admins, staff, and the tenant themselves can read tenant records
CREATE POLICY "tenants_select_admin_staff"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'staff'))
    OR id = auth.uid()
  );

-- New tenants can register themselves
CREATE POLICY "tenants_insert_self"
  ON public.tenants FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Tenants can update their own record
CREATE POLICY "tenants_update_own"
  ON public.tenants FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Only admins can delete tenants
CREATE POLICY "tenants_delete_admin"
  ON public.tenants FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
--  ISSUES POLICIES
-- ============================================================

-- Tenants can read their own issues
CREATE POLICY "issues_select_tenant_own"
  ON public.issues FOR SELECT
  TO authenticated
  USING (tenant_id = auth.uid());

-- Admins can read ALL issues
CREATE POLICY "issues_select_admin"
  ON public.issues FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Staff can read assigned issues + awaiting_review pipeline
CREATE POLICY "issues_select_staff"
  ON public.issues FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
    AND (assigned_to = auth.uid() OR status = 'awaiting_review')
  );

-- Tenants can submit new issues
CREATE POLICY "issues_insert_tenant"
  ON public.issues FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = auth.uid());

-- Tenants can update own issues only while awaiting_review
CREATE POLICY "issues_update_tenant_own"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (tenant_id = auth.uid() AND status = 'awaiting_review')
  WITH CHECK (tenant_id = auth.uid());

-- Admins can update any issue
CREATE POLICY "issues_update_admin"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Staff can update issues assigned to them
CREATE POLICY "issues_update_staff"
  ON public.issues FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'staff')
    AND assigned_to = auth.uid()
  );

-- Tenants can delete own issues while awaiting_review
CREATE POLICY "issues_delete_tenant_own"
  ON public.issues FOR DELETE
  TO authenticated
  USING (tenant_id = auth.uid() AND status = 'awaiting_review');

-- Admins can delete any issue
CREATE POLICY "issues_delete_admin"
  ON public.issues FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
