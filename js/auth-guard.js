/* ============================================================
   Auth Guard — Supabase-backed authentication check
   ============================================================
   
   Import and call checkAuth() at the top of any protected page's
   JS module. It verifies the Supabase session and syncs it with
   sessionStorage for quick RBAC checks in the UI.
   
   Usage:
     import { checkAuth } from './auth-guard.js';
     if (!await checkAuth('admin')) throw new Error('Not authenticated');
   ============================================================ */

import { supabase } from './supabase-client.js';

/**
 * Check if the user is authenticated via Supabase and has the required role.
 * Falls back to sessionStorage for cached role info.
 * Redirects to the login page if not authenticated.
 *
 * @param {'admin'|'staff'|'tenant'|Array<string>} [requiredRole] - Role check
 * @param {string} [loginUrl] - Override redirect URL
 * @returns {Promise<boolean>}
 */
export async function checkAuth(requiredRole, loginUrl) {
  // Determine the correct login URL based on current location
  if (!loginUrl) {
    const path = window.location.pathname;
    if (path.includes('/admin/') || path.includes('/tenant/')) {
      loginUrl = '../index.html';
    } else {
      loginUrl = 'index.html';
    }
  }

  // 1. Check Supabase session
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    // No Supabase session — clear local cache and redirect
    sessionStorage.removeItem('firs_user');
    window.location.replace(loginUrl);
    return false;
  }

  // 2. Restore sessionStorage if missing (e.g., page refresh with valid Supabase token)
  let cachedUser = null;
  try {
    cachedUser = JSON.parse(sessionStorage.getItem('firs_user'));
  } catch (e) { /* ignore */ }

  if (!cachedUser || cachedUser.id !== session.user.id) {
    // Session exists but no cached user info — resolve role from DB
    const userId = session.user.id;
    const email = session.user.email;

    // Check profiles (admin/staff)
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profile) {
      cachedUser = {
        id: userId,
        email: email,
        name: profile.full_name,
        role: profile.role,
        trade: profile.trade,
        avatar: profile.avatar_initials,
      };
    } else {
      // Check tenants
      const { data: tenant } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', userId)
        .single();

      if (tenant) {
        cachedUser = {
          id: userId,
          email: email,
          name: tenant.store_name,
          storeName: tenant.store_name,
          contact: tenant.contact_person,
          phone: tenant.phone_number,
          floor: tenant.floor,
          role: 'tenant',
          tenantId: userId,
        };
      } else {
        // User exists in auth but not in profiles or tenants — redirect
        sessionStorage.removeItem('firs_user');
        window.location.replace(loginUrl);
        return false;
      }
    }

    sessionStorage.setItem('firs_user', JSON.stringify(cachedUser));
  }

  // 3. Role check
  //
  // The roles passed in are the roles allowed — nothing is added implicitly.
  // This used to push 'staff' into any list containing 'admin', which meant
  // checkAuth('admin') silently also admitted staff and there was no way to
  // express "admin only" at all. hitl.js asks for 'admin' because validating
  // the AI's judgement is meant to be a separate pair of eyes from the
  // technician doing the work; the old widening defeated that.
  //
  // Pages that genuinely allow both pass ['admin', 'staff'] explicitly
  // (admin-dashboard.js, analytics.js already do).
  if (requiredRole) {
    // Copy rather than use the caller's array — this function must not mutate
    // an argument it was handed.
    const allowedRoles = Array.isArray(requiredRole) ? [...requiredRole] : [requiredRole];
    if (!allowedRoles.includes(cachedUser.role)) {
      window.location.replace(loginUrl);
      return false;
    }
  }

  // 4. Handle BFCache
  window.addEventListener('pageshow', async function (event) {
    if (event.persisted) {
      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) {
        sessionStorage.removeItem('firs_user');
        window.location.replace(loginUrl);
      }
    }
  });

  return true;
}
