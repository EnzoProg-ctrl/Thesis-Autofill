/* ============================================================
   Supabase Client — Single Shared Instance
   ============================================================ */

const SUPABASE_URL  = 'https://ljlxyfznsobfgalablqe.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqbHh5Znpuc29iZmdhbGFibHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwODUxMTIsImV4cCI6MjA5ODY2MTExMn0.9arQevnafCN4rSk1zIM8KyZM1_Ye6_sdStlmAYUtLa0';

if (!window.supabase) {
  throw new Error('Supabase JS library not loaded. Ensure the CDN script tag appears before application modules.');
}

const { createClient } = window.supabase;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);
