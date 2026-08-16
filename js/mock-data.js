/* ============================================================
   Data Constants — Categories, Priorities, Statuses, Analytics
   ============================================================ */

import { CATEGORY_ICONS } from './icons.js';
import { supabase } from './supabase-client.js';

export const CATEGORIES = [
  { id: 'electrical', label: 'Electrical', icon: CATEGORY_ICONS.electrical },
  { id: 'plumbing', label: 'Plumbing', icon: CATEGORY_ICONS.plumbing },
  { id: 'hvac', label: 'Air Conditioning', icon: CATEGORY_ICONS.hvac },
  { id: 'structural', label: 'Structural', icon: CATEGORY_ICONS.structural },
  { id: 'elevator', label: 'Escalator', icon: CATEGORY_ICONS.elevator },
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

export const STATUS_LIST = [
  { id: 'awaiting_review', label: 'Awaiting Review', color: '#f59e0b' },
  { id: 'in_progress', label: 'In Progress', color: '#0ea5e9' },
  { id: 'resolved', label: 'Resolved', color: '#22c55e' },
];

/* ---------- Historical Data for Analytics (Weekly — 7 days, Mon–Sun) ---------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const HISTORICAL_DATA = {
  days: DAY_LABELS,
  issuesByDay: [0, 0, 0, 0, 0, 0, 0],
  categoryTrends: {
    electrical: [0, 0, 0, 0, 0, 0, 0],
    plumbing: [0, 0, 0, 0, 0, 0, 0],
    hvac: [0, 0, 0, 0, 0, 0, 0],
    structural: [0, 0, 0, 0, 0, 0, 0],
    pest: [0, 0, 0, 0, 0, 0, 0],
    elevator: [0, 0, 0, 0, 0, 0, 0],
    fire_safety: [0, 0, 0, 0, 0, 0, 0],
    housekeeping: [0, 0, 0, 0, 0, 0, 0],
    it_network: [0, 0, 0, 0, 0, 0, 0],
  },
  priorityTrends: {
    critical: [0, 0, 0, 0, 0, 0, 0],
    high: [0, 0, 0, 0, 0, 0, 0],
    medium: [0, 0, 0, 0, 0, 0, 0],
    low: [0, 0, 0, 0, 0, 0, 0],
  },
  avgResolutionTime: {
    electrical: 0, plumbing: 0, hvac: 0, structural: 0,
    pest: 0, elevator: 0, fire_safety: 0, housekeeping: 0,
    it_network: 0,
  },
  aiAccuracy: [0, 0, 0, 0, 0, 0, 0],
  budgetByCategory: {
    electrical: 0, plumbing: 0, hvac: 0, structural: 0,
    pest: 0, elevator: 0, fire_safety: 0, housekeeping: 0,
    it_network: 0,
  },
};


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
