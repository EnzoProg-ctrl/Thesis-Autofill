/* ============================================================
   Shared Utilities — Supabase Data Ops, Navigation, Toast, Helpers
   ============================================================ */

import { supabase } from './supabase-client.js';
import { getUsers, tradeOptionsHTML, getTradeInitials, getTradeLabel, getPriorityInfo } from './app-data.js';

/* ---------- Supabase Issue Operations (async) ---------- */

/* Every column the list views need — deliberately NOT image_url.
 *
 * Photos are stored as base64 data: URIs inside the issues table, so a
 * select('*') pulled every photo ever uploaded on every call. The dashboards
 * re-run this on a 30s timer, and none of the list views (kanban cards, table
 * rows) actually display the photo — so that traffic bought nothing. With
 * fifty 3 MB photos that was roughly 200 MB per refresh, per open tab.
 *
 * The photo is fetched one at a time, only when someone opens the report,
 * via loadIssueImage(). See ISSUE_LIST_LIMIT below for the other half.
 */
const ISSUE_LIST_COLUMNS = [
  'id', 'ticket_number', 'tenant_id', 'store_name', 'contact_person',
  'phone_number', 'category', 'text', 'status', 'assigned_to',
  'ai_category', 'ai_confidence', 'ai_priority_score', 'ai_priority_level',
  'ai_language', 'validated', 'validated_by', 'validated_at',
  'overridden', 'override_notes', 'pre_override_priority_level',
  'text_edited_at', 'submitted_at', 'updated_at',
  /* Priority provenance. Written on every submission since
     migration_002_ai_provenance, and until now fetched by nothing — so the
     HITL queue could not tell a reviewer that a report had been floored by a
     keyword rule rather than judged by the model, or that the model never ran
     at all. See generateReasoning() in hitl.js. */
  'ai_priority_source', 'ai_safety_terms', 'ai_model_priority',
].join(',');

/* Newest 500 reports. The dashboards render every row they are given into the
 * DOM, so an unbounded query is a rendering problem as well as a transfer one.
 * Raise it if the mall ever genuinely needs more on screen at once — but the
 * right answer then is pagination, not a bigger number. */
const ISSUE_LIST_LIMIT = 500;

export async function loadIssues() {
  const { data, error } = await supabase
    .from('issues')
    .select(ISSUE_LIST_COLUMNS)
    .order('submitted_at', { ascending: false })
    .limit(ISSUE_LIST_LIMIT);
  if (error) {
    console.error('loadIssues error:', error);
    return [];
  }
  // Map DB column names → legacy JS property names for compatibility
  return data.map(mapIssueFromDB);
}

/**
 * Fetch the photo for ONE issue, on demand.
 *
 * Returns the data: URI, or null when the report has no photo (or the read
 * fails — callers just show nothing rather than breaking the page).
 */
export async function loadIssueImage(issueId) {
  if (!issueId) return null;
  const { data, error } = await supabase
    .from('issues')
    .select('image_url')
    .eq('id', issueId)
    .single();
  if (error) {
    console.error('loadIssueImage error:', error);
    return null;
  }
  return data?.image_url || null;
}

/**
 * Ids of reports that have a photo attached.
 *
 * Selecting only `id` keeps this tiny — it tells the list views which reports
 * should offer a "view photo" affordance without transferring any photo data.
 */
export async function loadIssueIdsWithImages() {
  const { data, error } = await supabase
    .from('issues')
    .select('id')
    .not('image_url', 'is', null)
    .limit(ISSUE_LIST_LIMIT);
  if (error) {
    console.error('loadIssueIdsWithImages error:', error);
    return new Set();
  }
  return new Set(data.map(r => r.id));
}

export async function addIssue(issue) {
  const dbRow = mapIssueToDB(issue);
  const { data, error } = await supabase
    .from('issues')
    .insert(dbRow)
    .select()
    .single();
  if (error) {
    console.error('addIssue error:', error);
    throw error;
  }
  return mapIssueFromDB(data);
}

export async function updateIssue(issueId, updates) {
  const dbUpdates = {};
  // Map JS keys → DB column names
  if ('status' in updates) dbUpdates.status = updates.status;
  if ('assignedTo' in updates) dbUpdates.assigned_to = updates.assignedTo;
  if ('category' in updates) dbUpdates.category = updates.category;
  if ('text' in updates) dbUpdates.text = updates.text;
  if ('validated' in updates) dbUpdates.validated = updates.validated;
  if ('validatedBy' in updates) dbUpdates.validated_by = updates.validatedBy;
  if ('validatedAt' in updates) dbUpdates.validated_at = updates.validatedAt;
  if ('overridden' in updates) dbUpdates.overridden = updates.overridden;
  if ('overrideNotes' in updates) dbUpdates.override_notes = updates.overrideNotes;
  if ('aiCategory' in updates) dbUpdates.ai_category = updates.aiCategory;
  if ('aiPriorityLevel' in updates) dbUpdates.ai_priority_level = updates.aiPriorityLevel;
  // Written once, by the HITL override, to keep the model's own priority
  // auditable after a reviewer changes it. See hitl.js handleOverride.
  if ('preOverridePriorityLevel' in updates)
    dbUpdates.pre_override_priority_level = updates.preOverridePriorityLevel;

  /* The remaining AI fields were previously write-once, set at submission by
     addIssue() and never updatable. That is why editing a report left the old
     priority in place: the new text was saved, the classification was not.
     The tenant edit flow re-runs the model and writes these back. */
  if ('aiConfidence' in updates) dbUpdates.ai_confidence = updates.aiConfidence;
  if ('aiPriority' in updates) dbUpdates.ai_priority_score = updates.aiPriority;
  if ('aiLanguage' in updates) dbUpdates.ai_language = updates.aiLanguage;
  if ('aiPrioritySource' in updates) dbUpdates.ai_priority_source = updates.aiPrioritySource;
  if ('aiSafetyTerms' in updates) dbUpdates.ai_safety_terms = updates.aiSafetyTerms;
  if ('aiModelPriority' in updates) dbUpdates.ai_model_priority = updates.aiModelPriority;
  if ('textEditedAt' in updates) dbUpdates.text_edited_at = updates.textEditedAt;

  const { data, error } = await supabase
    .from('issues')
    .update(dbUpdates)
    .eq('id', issueId)
    .select()
    .single();
  if (error) {
    console.error('updateIssue error:', error);
    throw error;
  }
  return mapIssueFromDB(data);
}

export async function deleteIssue(issueId) {
  const { error } = await supabase
    .from('issues')
    .delete()
    .eq('id', issueId);
  if (error) {
    console.error('deleteIssue error:', error);
    throw error;
  }
}


/* ---------- Field Mapping Helpers ---------- */

/**
 * Maps a Supabase DB row → legacy JS issue object
 * so existing UI code works without changes.
 */
function mapIssueFromDB(row) {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    tenantId: row.tenant_id,
    storeName: row.store_name || '',
    contactPerson: row.contact_person || '',
    phoneNumber: row.phone_number || '',
    category: row.category,
    text: row.text,
    imageUrl: row.image_url,
    status: row.status,
    assignedTo: row.assigned_to,
    aiCategory: row.ai_category,
    aiConfidence: row.ai_confidence,
    aiPriority: row.ai_priority_score,
    aiPriorityLevel: row.ai_priority_level,
    aiLanguage: row.ai_language,
    validated: row.validated,
    validatedBy: row.validated_by,
    validatedAt: row.validated_at,
    overridden: row.overridden,
    overrideNotes: row.override_notes,
    // The level as it stood before a human changed it in the HITL queue.
    // NULL unless a reviewer actually altered the priority.
    preOverridePriorityLevel: row.pre_override_priority_level,
    /* How the priority was actually reached:
         'model'        the model's own priority head
         'keyword'      the inference service was unreachable and the weak
                        fallback scorer triaged this report
         'safety_floor' a danger term overrode a lower model prediction
       aiSafetyTerms is populated whenever danger terms are present, even when
       the model had already reached High unaided; aiModelPriority holds what
       the model said, but only when the floor actually overrode it. */
    aiPrioritySource: row.ai_priority_source,
    aiSafetyTerms: row.ai_safety_terms,
    aiModelPriority: row.ai_model_priority,
    // Set only when the tenant edits the description — NOT bumped by
    // status changes or validation, unlike updatedAt.
    textEditedAt: row.text_edited_at,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps a JS issue object → Supabase DB column names for INSERT.
 */
function mapIssueToDB(issue) {
  const row = {};
  if (issue.tenantId) row.tenant_id = issue.tenantId;
  if (issue.storeName) row.store_name = issue.storeName;
  if (issue.contactPerson) row.contact_person = issue.contactPerson;
  if (issue.phoneNumber) row.phone_number = issue.phoneNumber;
  if (issue.category) row.category = issue.category;
  if (issue.text) row.text = issue.text;
  if (issue.imageUrl) row.image_url = issue.imageUrl;
  if (issue.status) row.status = issue.status;
  if (issue.assignedTo) row.assigned_to = issue.assignedTo;
  if (issue.aiCategory) row.ai_category = issue.aiCategory;
  if (issue.aiConfidence != null) row.ai_confidence = issue.aiConfidence;
  if (issue.aiPriority != null) row.ai_priority_score = issue.aiPriority;
  if (issue.aiPriorityLevel) row.ai_priority_level = issue.aiPriorityLevel;
  if (issue.aiLanguage) row.ai_language = issue.aiLanguage;
  // Provenance of the priority score. Without these, a day when the inference
  // service was down looks identical to a normal day, and a report escalated
  // by the keyword safety floor is indistinguishable from one the model
  // judged. See supabase/migration_002_ai_provenance.sql.
  if (issue.aiPrioritySource) row.ai_priority_source = issue.aiPrioritySource;
  if (issue.aiSafetyTerms) row.ai_safety_terms = issue.aiSafetyTerms;
  if (issue.aiModelPriority) row.ai_model_priority = issue.aiModelPriority;
  if (issue.validated != null) row.validated = issue.validated;

  return row;
}


/* ---------- Date / Time Formatting ---------- */

export function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffSecs < 60) return `${Math.max(diffSecs, 1)}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(isoString);
}

/**
 * Returns a formatted activity string for an issue.
 * If updated_at is meaningfully newer than submitted_at, returns "Updated Xm ago".
 * Otherwise returns "Submitted Xh ago" (original submission time).
 */
export function formatActivityTime(issue) {
  if (!issue) return '—';
  const submitted = issue.submittedAt ? new Date(issue.submittedAt).getTime() : 0;
  const updated = issue.updatedAt ? new Date(issue.updatedAt).getTime() : 0;

  // Consider the report "edited" if updated_at is more than 2 seconds after submitted_at
  const wasEdited = updated > 0 && (updated - submitted) > 2000;

  if (wasEdited) {
    return `Updated ${formatRelativeTime(issue.updatedAt).replace(' ago', '')} ago`;
  }
  return formatRelativeTime(issue.submittedAt);
}

/**
 * Returns the latest activity timestamp (updated_at or submitted_at) for sorting.
 */
export function getLatestActivityTime(issue) {
  if (!issue) return 0;
  const submitted = issue.submittedAt ? new Date(issue.submittedAt).getTime() : 0;
  const updated = issue.updatedAt ? new Date(issue.updatedAt).getTime() : 0;
  return Math.max(submitted, updated);
}


/* ---------- Topbar ---------- */

/**
 * Fill in the signed-in user's name and role pill.
 *
 * One implementation for every admin page. Each page used to carry its own
 * copy, which is how hitl.html ended up with a name that was hardcoded in the
 * markup and never updated at all.
 *
 * Both slots are left EMPTY in the HTML rather than seeded with a placeholder.
 * An empty slot filling in reads as the page finishing loading; a placeholder
 * being swapped for a different value reads as the page changing its mind,
 * which is what the old placeholder -> "SA" flip looked like.
 *
 * THE PILL
 * --------
 * For staff it shows their TRADE — Electrician, Plumber, HVAC — rather than
 * the generic word "Staff", which told a technician nothing they did not
 * already know.
 *
 * It was static markup until 2026-08-19, and being static it was also wrong:
 * applyRBAC() only hides links, so a staff member can open admin/index.html,
 * where the pill was hardcoded "Admin". They were shown someone else's role.
 * Reading it from the session fixes the label and that mislabelling together.
 *
 * Falls back to "Staff" when a profile carries no trade, and to "Admin" for
 * every non-staff role, so the pill is never blank once the session resolves.
 */
export function renderTopbarUser() {
  const nameEl = document.querySelector('.topbar-name');
  if (!nameEl) return;                    // page has no topbar user block
  let user = null;
  try { user = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }
  nameEl.textContent = user?.name || '';

  const roleEl = document.querySelector('.topbar-role');
  if (!roleEl || !user) return;           // no pill, or nothing to say yet
  roleEl.textContent = user.role === 'staff'
    ? (getTradeLabel(user.trade) || 'Staff')
    : 'Admin';
}


/**
 * Wire the mobile hamburger button to the sidebar.
 *
 * The close-on-outside-click handler MUST ignore clicks on the toggle itself.
 * The button lives inside <main class="admin-content">, so a handler bound to
 * that container receives the very click that opened the sidebar — it opened
 * and then closed again within one click, and the panel never appeared. That
 * was the bug on index.html and staff.html; hitl and analytics had the guard
 * and worked.
 *
 * Clicks inside the sidebar are ignored too, so tapping a nav link or the logo
 * does not dismiss the panel before the navigation happens.
 *
 * Accepts both id spellings in use: 'sidebar-toggle' on most pages,
 * 'sidebarToggle' on analytics.html.
 */
export function initSidebarToggle() {
  const toggle = document.getElementById('sidebar-toggle')
              || document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');
  if (!toggle || !sidebar) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    sidebar.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!sidebar.classList.contains('open')) return;
    if (sidebar.contains(e.target) || toggle.contains(e.target)) return;
    sidebar.classList.remove('open');
  });

  // An open sidebar is a modal overlay on mobile; Escape should dismiss it.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') sidebar.classList.remove('open');
  });
}


/* ---------- Toast Notification System ---------- */

let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}


/* ---------- Modal Helpers ---------- */

export function showModal(title, bodyHTML, footerHTML = '') {
  const existing = document.querySelector('.modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="btn-icon btn-ghost modal-close-btn" style="font-size:20px;">×</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.modal-close-btn')) {
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
  return overlay;
}

export function closeModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
}


/* ---------- Image Lightbox ---------- */

/**
 * Open an attached photo in an overlay instead of a new tab.
 *
 * The previous behaviour was onclick="window.open(this.src,'_blank')", which
 * never worked: photos are stored as data: URIs (tenant-app.js reads them with
 * FileReader.readAsDataURL), and Chrome blocks top-level navigation to data:
 * URLs outright — window.open returns null and nothing happens at all.
 *
 * Uses a delegated listener so it works for markup injected later by the
 * slide-over and the HITL queue, which render their HTML as strings. Call
 * initImageLightbox() once per page; any <img data-lightbox> is then clickable.
 */
export function initImageLightbox() {
  if (document.body.dataset.lightboxReady) return;   // idempotent
  document.body.dataset.lightboxReady = '1';

  document.addEventListener('click', (e) => {
    const img = e.target.closest('img[data-lightbox]');
    if (!img) return;
    e.preventDefault();
    openLightbox(img.src, img.alt || 'Attached photo');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });
}

function openLightbox(src, alt) {
  closeLightbox();
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  /* src is a data: URI or storage URL already rendered in an <img> on this
     page; alt is escaped because it lands in an attribute. */
  overlay.innerHTML = `
    <button class="lightbox-close" aria-label="Close photo">&times;</button>
    <img class="lightbox-img" alt="${escapeHtml(alt)}">
  `;
  overlay.querySelector('.lightbox-img').src = src;

  // Click the backdrop or the close button to dismiss; clicking the photo
  // itself must NOT close it, so people can inspect without losing the view.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.lightbox-close')) closeLightbox();
  });

  document.body.appendChild(overlay);
}

function closeLightbox() {
  const el = document.querySelector('.lightbox-overlay');
  if (el) el.remove();
}


/* ---------- Slide-Over Panel ---------- */

export function showSlideOver(title, bodyHTML) {
  closeSlideOver();

  const overlayEl = document.createElement('div');
  overlayEl.className = 'slide-over-overlay';

  const panel = document.createElement('div');
  panel.className = 'slide-over';
  panel.innerHTML = `
    <div class="slide-over-header">
      <h3>${title}</h3>
      <button class="btn-icon btn-ghost slide-over-close" style="font-size:20px;">×</button>
    </div>
    <div class="slide-over-body">${bodyHTML}</div>
  `;

  overlayEl.addEventListener('click', () => closeSlideOver());
  panel.querySelector('.slide-over-close').addEventListener('click', () => closeSlideOver());

  document.body.appendChild(overlayEl);
  document.body.appendChild(panel);
  return panel;
}

export function closeSlideOver() {
  document.querySelectorAll('.slide-over-overlay').forEach(el => el.remove());
  document.querySelectorAll('.slide-over').forEach(el => el.remove());
}


/* ---------- Escape HTML ---------- */

export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


/* ---------- Priority provenance ----------

   Says who actually decided the priority on a report, in prose.

   ai_priority_source, ai_safety_terms and ai_model_priority have been written
   on every submission since migration_002_ai_provenance and were displayed
   nowhere at all, which left the two cases that most need a second opinion
   looking exactly like an ordinary model prediction:

     * the safety floor raised the priority on a danger word, and the model
       itself had said something lower
     * the inference service was unreachable, so the keyword fallback triaged
       the report and the model never ran

   Lives here rather than in hitl.js because the HITL queue and the admin
   detail panel both need it, and every other thing this codebase wrote out
   twice has since drifted apart.

   Returns an HTML string, or '' when there is nothing worth saying. */
export function priorityProvenanceNote(issue) {
  const priInfo = getPriorityInfo(issue.aiPriorityLevel);
  const score = issue.aiPriority;

  if (issue.aiPrioritySource === 'safety_floor') {
    const modelSaid = issue.aiModelPriority
      ? getPriorityInfo(issue.aiModelPriority).label
      : null;
    return `Priority <strong>${priInfo.label}</strong> (severity index ${score}/100) was set by the `
      + `<strong>safety floor</strong>, not by the model`
      + (modelSaid ? ` — the model scored this ${modelSaid}` : '')
      /* "forcing" rather than "which force(s)": formatSafetyTerms returns
         either a singular or a plural phrase, and a finite verb would have to
         agree with whichever it produced. A participle sidesteps the
         agreement entirely and reads the same either way. */
      + `. The report contains ${formatSafetyTerms(issue.aiSafetyTerms)}, forcing a minimum `
      + `of High. The floor does not read negation, so "walang usok" trips it too.`;
  }

  if (issue.aiPrioritySource === 'keyword') {
    return `<strong>The model did not run on this report.</strong> The inference service was `
      + `unreachable, so the priority of <strong>${priInfo.label}</strong> (severity index `
      + `${score}/100) came from the keyword fallback, which is markedly weaker on Taglish. `
      + `Treat it as unscored.`;
  }

  /* Danger terms present, but the model reached High on its own. Worth saying:
     a reviewer who spots the words and sees no note may assume the floor acted
     when it did not. */
  if (issue.aiSafetyTerms) {
    return `Contains ${formatSafetyTerms(issue.aiSafetyTerms)} — the model had already reached `
      + `the High floor unaided, so the safety floor changed nothing here.`;
  }

  return '';
}


/** Danger terms as a readable, quoted, escaped list. ai_safety_terms is a
    free-text column that a tenant's own session can write, so it is never
    interpolated raw. */
export function formatSafetyTerms(terms) {
  const list = String(terms || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => `"${escapeHtml(t)}"`);
  if (list.length === 0) return 'a safety keyword';
  if (list.length === 1) return `the safety keyword ${list[0]}`;
  return `the safety keywords ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}


/* ---------- Debounce ---------- */

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}


/* ---------- Password Toggle Helper ---------- */

const EYE_OPEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
const EYE_OFF_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"></path><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"></path><line x1="1" y1="1" x2="23" y2="23"></line><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"></path></svg>';

function setupPasswordToggle(overlay, inputId, toggleId) {
  const toggleBtn = overlay.querySelector(`#${toggleId}`);
  const pwInput = overlay.querySelector(`#${inputId}`);
  if (!toggleBtn || !pwInput) return;
  toggleBtn.addEventListener('click', () => {
    const isHidden = pwInput.type === 'password';
    pwInput.type = isHidden ? 'text' : 'password';
    toggleBtn.innerHTML = isHidden ? EYE_OFF_SVG : EYE_OPEN_SVG;
    toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  });
}


/* ---------- User Creation Modal (Globalized) ---------- */

export function openCreateUserModal() {
  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-4);">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="newUserName">Full Name <span style="color:var(--danger-500)">*</span></label>
        <input type="text" id="newUserName" class="form-input" placeholder="e.g., Juan Dela Cruz">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="newUserEmail">Email Address <span style="color:var(--danger-500)">*</span></label>
        <input type="email" id="newUserEmail" class="form-input" placeholder="user@example.com">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="newUserPassword">Password <span style="color:var(--danger-500)">*</span></label>
        <div class="password-wrapper">
          <input type="password" id="newUserPassword" class="form-input" placeholder="At least 8 characters">
          <button type="button" class="password-toggle" id="toggleNewUserPw" aria-label="Show password">
            ${EYE_OPEN_SVG}
          </button>
        </div>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="newUserRole">Account Role <span style="color:var(--danger-500)">*</span></label>
        <select class="form-select" id="newUserRole">
          <option value="admin">Admin</option>
          <option value="staff" selected>Maintenance Staff</option>
        </select>
      </div>
      <div class="form-group" id="tradeGroup" style="margin-bottom:0">
        <label class="form-label" for="newUserTrade">Trade / Specialty</label>
        <select class="form-select" id="newUserTrade">
          ${tradeOptionsHTML()}
        </select>
      </div>
    </div>
  `;

  const footerHTML = `
    <button class="btn btn-secondary" id="createUserCancel">Cancel</button>
    <button class="btn btn-primary" id="createUserSave">Create Account</button>
  `;

  const overlay = showModal('Create New User', bodyHTML, footerHTML);

  // Conditional trade field visibility
  const roleSelect = overlay.querySelector('#newUserRole');
  const tradeGroup = overlay.querySelector('#tradeGroup');

  function toggleTradeVisibility() {
    tradeGroup.style.display = roleSelect.value === 'staff' ? '' : 'none';
  }
  toggleTradeVisibility();
  roleSelect.addEventListener('change', toggleTradeVisibility);

  // Password toggle
  setupPasswordToggle(overlay, 'newUserPassword', 'toggleNewUserPw');

  // Cancel
  overlay.querySelector('#createUserCancel').addEventListener('click', closeModal);

  // Save — Create user via Supabase Auth + profiles table
  overlay.querySelector('#createUserSave').addEventListener('click', async () => {
    const name = overlay.querySelector('#newUserName').value.trim();
    const email = overlay.querySelector('#newUserEmail').value.trim().toLowerCase();
    const password = overlay.querySelector('#newUserPassword').value;
    const role = overlay.querySelector('#newUserRole').value;
    const trade = overlay.querySelector('#newUserTrade').value;

    // Validation
    if (!name) { showToast('Please enter a name.', 'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Please enter a valid email.', 'error'); return; }
    if (!password || password.length < 8) { showToast('Password must be at least 8 characters.', 'error'); return; }

    const saveBtn = overlay.querySelector('#createUserSave');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating...';

    try {
      // 1. Save current admin session
      const { data: { session: adminSession } } = await supabase.auth.getSession();

      // 2. Sign up the new user via Supabase Auth
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) throw signUpError;

      // 3. Restore admin session immediately
      if (adminSession) {
        await supabase.auth.setSession({
          access_token: adminSession.access_token,
          refresh_token: adminSession.refresh_token,
        });
      }

      // 4. Avatar based on trade/role. Initials come from TRADES in
      //    app-data.js — this used to be a second copy of the list and had
      //    already drifted from the dropdown once.
      const avatar = role === 'staff' ? getTradeInitials(trade) : 'SA';

      // 5. Insert into profiles table (via RPC to bypass RLS)
      const { error: profileError } = await supabase.rpc('admin_create_profile', {
        p_user_id: signUpData.user.id,
        p_full_name: name,
        p_email: email,
        p_role: role,
        p_trade: role === 'staff' ? trade : null,
        p_avatar_initials: avatar,
      });

      if (profileError) throw profileError;

      closeModal();
      showToast(`Account created for ${name} (${role})`, 'success');

    } catch (err) {
      console.error('Create user error:', err);
      showToast(err.message || 'Failed to create account.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Create Account';
    }
  });
}


/* ---------- Edit Profile Modal (Globalized) ---------- */

export async function openEditAdminProfileModal() {
  const rawUser = sessionStorage.getItem('firs_user');
  if (!rawUser) return;

  let currentUser;
  try {
    currentUser = JSON.parse(rawUser);
  } catch (e) {
    return;
  }

  const isStaff = currentUser.role === 'staff';

  const tradeDropdownHTML = isStaff ? `
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label" for="editProfileTrade">Trade / Specialty</label>
      <select class="form-select" id="editProfileTrade">
        ${tradeOptionsHTML(currentUser.trade)}
      </select>
    </div>
  ` : '';

  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--sp-4);">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="editProfileName">Full Name <span style="color:var(--danger-500)">*</span></label>
        <input type="text" id="editProfileName" class="form-input" value="${escapeHtml(currentUser.name || '')}">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="editProfilePassword">New Password</label>
        <div class="password-wrapper">
          <input type="password" id="editProfilePassword" class="form-input" placeholder="Leave blank to keep current password (min. 8)">
          <button type="button" class="password-toggle" id="toggleEditProfilePw" aria-label="Show password">
            ${EYE_OPEN_SVG}
          </button>
        </div>
      </div>
      ${tradeDropdownHTML}
    </div>
  `;

  const footerHTML = `
    <button class="btn btn-secondary" id="editProfileCancel">Cancel</button>
    <button class="btn btn-primary" id="editProfileSave">Save Changes</button>
  `;

  const overlay = showModal('Edit Profile', bodyHTML, footerHTML);

  // Password toggle
  setupPasswordToggle(overlay, 'editProfilePassword', 'toggleEditProfilePw');

  // Cancel
  overlay.querySelector('#editProfileCancel').addEventListener('click', closeModal);

  // Save
  overlay.querySelector('#editProfileSave').addEventListener('click', async () => {
    const name = overlay.querySelector('#editProfileName').value.trim();
    const newPassword = overlay.querySelector('#editProfilePassword').value;
    const trade = isStaff ? overlay.querySelector('#editProfileTrade').value : null;

    if (!name) {
      showToast('Please enter a name.', 'error');
      return;
    }

    /* The password field is optional here — blank means "keep the current
       one" — but when it IS filled it was previously written straight to
       Supabase with no length check at all, so an admin could set a
       one-character password on their own account. Only validated when
       non-empty, so leaving it blank still works. */
    if (newPassword && newPassword.length < 8) {
      showToast('Password must be at least 8 characters.', 'error');
      return;
    }

    try {
      // Update profiles table in Supabase
      const profileUpdates = { full_name: name };
      if (isStaff && trade) {
        profileUpdates.trade = trade;
        profileUpdates.avatar_initials = getTradeInitials(trade);
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update(profileUpdates)
        .eq('id', currentUser.id);

      if (profileError) throw profileError;

      // Update password via Supabase Auth if provided
      if (newPassword) {
        const { error: pwError } = await supabase.auth.updateUser({ password: newPassword });
        if (pwError) throw pwError;
      }

      // Update session storage
      const updatedUser = {
        ...currentUser,
        name: name,
        avatar: profileUpdates.avatar_initials || currentUser.avatar || 'SA',
      };
      if (isStaff) updatedUser.trade = trade;
      sessionStorage.setItem('firs_user', JSON.stringify(updatedUser));

      closeModal();
      showToast('Profile updated successfully', 'success');

      // Refresh the topbar name from the session we just wrote. The role pill
      // is static markup and is deliberately not touched. avatar_initials is
      // still saved to the profile above — it is used elsewhere (staff lists),
      // it just no longer drives the topbar.
      renderTopbarUser();

    } catch (err) {
      console.error('Edit profile error:', err);
      showToast(err.message || 'Failed to update profile.', 'error');
    }
  });
}
