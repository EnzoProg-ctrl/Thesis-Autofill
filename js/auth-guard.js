/* ============================================================
   Auth Guard — Shared authentication check for protected pages
   ============================================================
   
   Import and call checkAuth() at the top of any protected page's
   JS module. It will redirect unauthenticated users to the login
   page immediately.
   
   Usage:
     import { checkAuth } from './auth-guard.js';
     checkAuth('admin');   // For admin pages
     checkAuth('tenant');  // For tenant pages
   ============================================================ */

/**
 * Check if the user is authenticated and has the required role.
 * Redirects to the login page if not authenticated.
 * Also handles the browser back/forward cache (BFCache).
 *
 * @param {'admin'|'tenant'} [requiredRole] - Optional role check
 * @param {string} [loginUrl] - URL to redirect to (default: '../index.html')
 */
export function checkAuth(requiredRole, loginUrl) {
  // Determine the correct login URL based on current location
  if (!loginUrl) {
    // Check if we're in a subdirectory (admin/ or tenant/)
    const path = window.location.pathname;
    if (path.includes('/admin/') || path.includes('/tenant/')) {
      loginUrl = '../index.html';
    } else {
      loginUrl = 'index.html';
    }
  }

  function doCheck() {
    const raw = sessionStorage.getItem('firs_user');
    if (!raw) {
      window.location.replace(loginUrl);
      return false;
    }

    try {
      const user = JSON.parse(raw);

      // If a specific role is required, verify it
      if (requiredRole && user.role !== requiredRole) {
        window.location.replace(loginUrl);
        return false;
      }

      return true;
    } catch (e) {
      // Corrupted session data — clear and redirect
      sessionStorage.removeItem('firs_user');
      window.location.replace(loginUrl);
      return false;
    }
  }

  // Immediate check on script load
  if (!doCheck()) return false;

  // Handle BFCache: when the user navigates back after signing out,
  // the browser may restore the page from cache without re-running
  // DOMContentLoaded. The 'pageshow' event fires in this case with
  // event.persisted === true.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      doCheck();
    }
  });

  return true;
}
