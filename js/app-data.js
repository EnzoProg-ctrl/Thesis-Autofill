/* ============================================================
   App Data — Categories, Priorities, Statuses, Profile queries

   The app's real taxonomy plus live Supabase reads. Nothing here is
   mock data.

   CATEGORIES is the authority for category ids: serving/serve.py maps
   the model's own class names onto these ids in LABEL_TO_SYSTEM_ID, and
   the two must agree. These 7 now match the model's 7 classes exactly.

   'elevator' ("Escalator") was removed on 2026-08-17. It was the one
   category the model could never emit — lift and escalator complaints
   were trained as 'Other' — so it only ever collected reports the AI
   had already labelled something else. Any report already stored with
   category 'elevator' still displays; getCategoryLabel() falls back to
   the raw id for ids it does not recognise.
   ============================================================ */

import { CATEGORY_ICONS } from './icons.js';
import { supabase } from './supabase-client.js';

export const CATEGORIES = [
  { id: 'electrical', label: 'Electrical', icon: CATEGORY_ICONS.electrical },
  { id: 'plumbing', label: 'Plumbing', icon: CATEGORY_ICONS.plumbing },
  { id: 'hvac', label: 'Air Conditioning', icon: CATEGORY_ICONS.hvac },
  { id: 'structural', label: 'Structural', icon: CATEGORY_ICONS.structural },
  { id: 'fire_safety', label: 'Fire Safety', icon: CATEGORY_ICONS.fire_safety },
  { id: 'housekeeping', label: 'Housekeeping', icon: CATEGORY_ICONS.housekeeping },
  { id: 'other', label: 'Other', icon: CATEGORY_ICONS.other },
];

export const PRIORITY_LEVELS = [
  { id: 'critical', label: 'Critical', color: '#dc2626', bg: '#fef2f2' },
  { id: 'high', label: 'High', color: '#eab308', bg: '#fefce8' },
  { id: 'medium', label: 'Medium', color: '#3b82f6', bg: '#eff6ff' },
  { id: 'low', label: 'Low', color: '#22c55e', bg: '#f0fdf4' },
];

/* Severity rank for ordering: higher number = more severe.
   Derived from PRIORITY_LEVELS so the order can never drift from the list the
   badges and filters use.

   WHY THIS EXISTS: the kanban used to order cards by ai_priority_score, but the
   coloured dot renders ai_priority_level, and the two are computed differently
   by the model — the level is the argmax (single most likely class) while the
   score is a probability-weighted mean across all four bands. A report the
   model called Low at 33% confidence, with 24% still sitting on Critical,
   scores 54 and so outranked genuine Mediums scoring 52. The board looked
   wrong because a green dot sat above blue ones. Ordering by level first makes
   the sequence agree with the colour a reviewer actually sees; the score is
   kept as the tiebreaker inside each band, so the finer signal is not lost. */
export const PRIORITY_RANK = Object.fromEntries(
  PRIORITY_LEVELS.map((p, i) => [p.id, PRIORITY_LEVELS.length - 1 - i])
);

/** Severity rank for a level id. Unknown/missing levels sort last. */
export function getPriorityRank(levelId) {
  const r = PRIORITY_RANK[levelId];
  return r === undefined ? -1 : r;
}

/* Maintenance staff specialties.
   Single source of truth: the two dropdowns and the two avatar-initial maps in
   shared.js all previously repeated this list, and the avatar map had already
   drifted out of step with the dropdown once.

   `covers` records which CATEGORIES a trade is the natural fit for. Nothing
   uses it to route work today — assignment stays a human choice — but it
   documents why each trade exists and makes the gap obvious if a category is
   ever added without a matching specialist.

   `initials` MUST be exactly two characters: profiles.avatar_initials carries
   a CHECK (char_length = 2) constraint. */
export const TRADES = [
  { id: 'Electrician',  label: 'Electrician',       initials: 'EL', covers: ['electrical'] },
  { id: 'Plumber',      label: 'Plumber',           initials: 'PL', covers: ['plumbing'] },
  { id: 'HVAC',         label: 'HVAC',              initials: 'HV', covers: ['hvac'] },
  { id: 'Carpenter',    label: 'Carpenter / Mason', initials: 'CP', covers: ['structural'] },
  { id: 'Fire Safety',  label: 'Fire Safety',       initials: 'FS', covers: ['fire_safety'] },
  { id: 'Housekeeping', label: 'Housekeeping',      initials: 'HK', covers: ['housekeeping'] },
  { id: 'General',      label: 'General',           initials: 'GN', covers: ['other'] },
];

/* Security was removed on 2026-08-18. It was a leftover from the 8-class
   taxonomy that dropped the Security CATEGORY on 2026-08-13 — no report can be
   classified as security work, so no report could ever be routed to a security
   specialist. Every trade above now maps to a live category. */

export const DEFAULT_TRADE = 'General';

/** Two-letter avatar initials for a trade. Falls back to General's. */
export function getTradeInitials(tradeId) {
  const t = TRADES.find(t => t.id === tradeId);
  return t ? t.initials : 'GN';
}

/** Display label for a trade id — 'Carpenter' reads as 'Carpenter / Mason'.
    Unknown ids fall back to the id itself rather than to a default: a profile
    still carrying a retired trade (the removed 'Security', say) should show
    what it actually holds, not silently read as something else. Empty for a
    missing trade, so callers can pick their own fallback. */
export function getTradeLabel(tradeId) {
  const t = TRADES.find(t => t.id === tradeId);
  return t ? t.label : (tradeId || '');
}

/** <option> markup for a trade dropdown, marking `selected` as the chosen one.
    Joined with no separator: whitespace between <option> tags is not
    rendered, so there is nothing to gain from formatting it. */
export function tradeOptionsHTML(selected) {
  const chosen = selected || DEFAULT_TRADE;
  return TRADES
    .map(t => `<option value="${t.id}"${t.id === chosen ? ' selected' : ''}>${t.label}</option>`)
    .join('');
}

export const STATUS_LIST = [
  { id: 'awaiting_review', label: 'Awaiting Review', color: '#f59e0b' },
  { id: 'in_progress', label: 'In Progress', color: '#0ea5e9' },
  { id: 'resolved', label: 'Resolved', color: '#22c55e' },
];

/* ---------- Supabase Helpers: Profiles ---------- */

/** Fetch all admin/staff profiles from Supabase */
export async function getUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) { console.error('getUsers error:', error); return []; }
  if (!data) return [];
  return data.map(p => ({
    id: p.id,
    name: p.full_name,
    email: p.email,
    role: p.role,
    trade: p.trade,
    avatar: p.avatar_initials,
  }));
}

/** Fetch a single staff member by UUID */
export async function getStaffById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .eq('role', 'staff')
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.full_name,
    email: data.email,
    role: data.role,
    trade: data.trade,
    avatar: data.avatar_initials,
  };
}


/* ---------- Static Helpers ---------- */

export function getCategoryLabel(catId) {
  const c = CATEGORIES.find(c => c.id === catId);
  return c ? c.label : catId;
}

export function getCategoryIcon(catId) {
  const c = CATEGORIES.find(c => c.id === catId);
  return c ? c.icon : CATEGORY_ICONS.other;
}

export function getStatusInfo(statusId) {
  return STATUS_LIST.find(s => s.id === statusId) || STATUS_LIST[0];
}

export function getPriorityInfo(levelId) {
  return PRIORITY_LEVELS.find(p => p.id === levelId) || PRIORITY_LEVELS[3];
}
