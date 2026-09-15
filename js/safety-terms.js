/* ============================================================
   Safety Terms — admin management of the safety-floor vocabulary

   Reads and writes public.safety_terms (migration_008). RLS limits every
   write to admins, and a database trigger refuses to leave zero active danger
   terms, so this page's own checks are for a clear message, not for safety.

   Matching comes from safety-floor.js — the same module the tenant client
   floors real submissions with — so the preview and the test box show exactly
   what a submission would get.
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { loadIssues, renderTopbarUser, initSidebarToggle, showToast, showModal, closeModal,
         escapeHtml, openCreateUserModal, openEditAdminProfileModal } from './shared.js';
import { BUILTIN_SAFETY_TERMS, compileSafetyTerms, matchSafetyTerms, validateTerm } from './safety-floor.js';

/* ---------- Auth Guard ---------- */
if (!(await checkAuth('admin'))) {
  throw new Error('Not authenticated');
}

let currentUser = null;
try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }

/* ---------- State ---------- */
let rows = [];               // every term, active or not
let dbAvailable = false;     // false = table missing or unreadable; page is read-only
let issues = [];             // recent reports, for "past reports" counts and previews

/* Above this share of recent reports, a new danger term is probably part of
   ordinary words — "ilaw" would floor every lighting report to High. */
const BROAD_TERM_SHARE = 0.15;

const MATCH_LABELS = {
  substring: 'Part of a word',
  word: 'Whole word',
  phrase: 'Phrase',
};

const MATCH_HINTS = {
  substring: 'Also matches longer words containing it — "usok" matches "umuusok". Best for Tagalog roots.',
  word: 'Matches only the exact word — "spark" does not match "sparkling". Add other forms (sparks, sparked) separately.',
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const form = $('terms-add-form');
const kindEl = $('term-kind');
const matchEl = $('term-match');
const termEl = $('term-text');
const labelEl = $('term-label');
const noteEl = $('term-note');
const errorEl = $('term-error');
const previewEl = $('term-preview');
const addBtn = $('term-add-btn');
const testInput = $('terms-test-input');
const testResult = $('terms-test-result');


/* ---------- Data ---------- */

async function loadTerms() {
  const { data, error } = await supabase
    .from('safety_terms')
    .select('id, kind, match_type, term, label, active, sort_order, note')
    .order('kind')
    .order('sort_order')
    .order('term');

  if (error) {
    console.error('safety_terms load error:', error);
    dbAvailable = false;
    rows = BUILTIN_SAFETY_TERMS.map((r) => ({ ...r, id: null, active: true, note: null }));
    return;
  }
  dbAvailable = true;
  rows = data;
}

const activeRows = (list = rows) => list.filter((r) => r.active);

function flaggedSet(termRows) {
  const compiled = compileSafetyTerms(termRows);
  const set = new Set();
  if (!compiled) return set;
  for (const issue of issues) {
    if (matchSafetyTerms(issue.text, compiled).length) set.add(issue.id);
  }
  return set;
}

/* How many recent reports each row accounts for.
   Danger term: reports containing it (after exclusions are blanked).
   Exclusion:   reports it stops from being flagged. */
function pastReportCount(row) {
  const exclusions = activeRows().filter((r) => r.kind === 'exclusion' && r.id !== row.id);
  if (row.kind === 'danger') {
    return flaggedSet([{ ...row, active: true }, ...exclusions]).size;
  }
  const danger = activeRows().filter((r) => r.kind === 'danger');
  const without = flaggedSet([...danger, ...exclusions]);
  const withIt = flaggedSet([...danger, ...exclusions, row]);
  return [...without].filter((id) => !withIt.has(id)).length;
}


/* ---------- Render: lists ---------- */

function renderSource() {
  const el = $('terms-source');
  if (dbAvailable) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = 'terms-source terms-source-warning';
  el.innerHTML = `
    <strong>Editing is unavailable.</strong>
    The safety terms table could not be read, so this page is showing the built-in list, which is what
    reports are using right now. If the table has not been created yet, run
    <code>supabase/migration_008_safety_terms.sql</code> in the Supabase SQL editor.`;
  form.querySelectorAll('input, select, button').forEach((el) => { el.disabled = true; });
}

function termRowHtml(row, count, withMatch) {
  const inactive = row.active ? '' : ' is-inactive';
  const disabled = dbAvailable ? '' : ' disabled';
  const countCell = issues.length
    ? `<span class="terms-count${count ? '' : ' is-zero'}">${count}</span>`
    : '<span class="terms-count is-zero">—</span>';
  return `
    <tr class="terms-row${inactive}" data-id="${escapeHtml(row.id || '')}">
      <td>
        <span class="terms-term">${escapeHtml(row.term)}</span>
        ${row.note ? `<div class="terms-note">${escapeHtml(row.note)}</div>` : ''}
      </td>
      ${withMatch ? `<td class="terms-muted">${MATCH_LABELS[row.match_type] || escapeHtml(row.match_type)}</td>` : ''}
      <td class="terms-muted">${row.label === row.term ? '—' : escapeHtml(row.label)}</td>
      <td>${countCell}</td>
      <td>
        <label class="terms-switch" title="${row.active ? 'Turn off' : 'Turn on'}">
          <input type="checkbox" data-action="toggle"${row.active ? ' checked' : ''}${disabled}
            aria-label="${row.active ? 'Turn off' : 'Turn on'} ${escapeHtml(row.term)}">
          <span class="terms-switch-track"></span>
        </label>
      </td>
      <td class="terms-actions">
        ${dbAvailable ? `<button type="button" class="btn btn-ghost btn-sm terms-delete" data-action="delete">Delete</button>` : ''}
      </td>
    </tr>`;
}

function renderLists() {
  const danger = rows.filter((r) => r.kind === 'danger');
  const exclusions = rows.filter((r) => r.kind === 'exclusion');

  $('danger-count').textContent = `${activeRows(danger).length} active`;
  $('exclusion-count').textContent = `${activeRows(exclusions).length} active`;

  $('danger-body').innerHTML = danger.length
    ? danger.map((r) => termRowHtml(r, pastReportCount(r), true)).join('')
    : '<tr><td colspan="6" class="terms-empty">No danger terms.</td></tr>';
  $('exclusion-body').innerHTML = exclusions.length
    ? exclusions.map((r) => termRowHtml(r, pastReportCount(r), false)).join('')
    : '<tr><td colspan="5" class="terms-empty">No exclusion phrases.</td></tr>';
}


/* ---------- Row actions ---------- */

function describeWriteError(error) {
  if (error?.code === '23514' && /active danger term/i.test(error.message || '')) {
    return 'At least one danger term must stay on — the safety floor cannot be empty.';
  }
  if (error?.code === '23505') return 'That term is already in the list.';
  if (error?.code === '42501') return 'Only admins can change safety terms.';
  return error?.message || 'Something went wrong. Try again.';
}

async function toggleRow(row, checkbox) {
  checkbox.disabled = true;
  const { error } = await supabase
    .from('safety_terms')
    .update({ active: !row.active })
    .eq('id', row.id);
  if (error) {
    checkbox.checked = row.active;
    checkbox.disabled = false;
    showToast(describeWriteError(error), 'error', 6000);
    return;
  }
  showToast(`"${escapeHtml(row.term)}" turned ${row.active ? 'off' : 'on'}.`, 'success');
  await refresh();
}

function confirmDelete(row) {
  const overlay = showModal(
    'Delete term?',
    `<p>Delete <strong>${escapeHtml(row.term)}</strong> from the ${row.kind === 'danger' ? 'danger terms' : 'exclusion phrases'}?</p>
     <p class="terms-modal-sub">This cannot be undone. Turning it off instead keeps it in the list for later.</p>`,
    `<button type="button" class="btn btn-secondary" data-modal="cancel">Cancel</button>
     <button type="button" class="btn btn-danger" data-modal="confirm">Delete</button>`
  );
  overlay.querySelector('[data-modal="cancel"]').addEventListener('click', closeModal);
  const confirmBtn = overlay.querySelector('[data-modal="confirm"]');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    const { error } = await supabase.from('safety_terms').delete().eq('id', row.id);
    closeModal();
    if (error) {
      showToast(describeWriteError(error), 'error', 6000);
      return;
    }
    showToast(`"${escapeHtml(row.term)}" deleted.`, 'success');
    await refresh();
  });
}

function onListEvent(e) {
  const target = e.target.closest('[data-action]');
  if (!target || !dbAvailable) return;
  const tr = target.closest('tr[data-id]');
  const row = rows.find((r) => r.id === tr?.dataset.id);
  if (!row) return;
  if (target.dataset.action === 'toggle' && e.type === 'change') toggleRow(row, target);
  if (target.dataset.action === 'delete' && e.type === 'click') confirmDelete(row);
}


/* ---------- Add form ---------- */

function readForm() {
  const kind = kindEl.value;
  const matchType = kind === 'exclusion' ? 'phrase' : matchEl.value;
  const term = termEl.value.trim().toLowerCase().replace(/\s+/g, ' ');
  const label = labelEl.value.trim().toLowerCase().replace(/\s+/g, ' ') || term;
  const note = noteEl.value.trim() || null;
  return { kind, match_type: matchType, term, label, note };
}

function formProblem(candidate) {
  if (!candidate.term) return null;           // empty: nothing to say yet
  const termError = validateTerm(candidate.term, candidate.match_type);
  if (termError) return termError;
  if (candidate.label.length < 3 || candidate.label.length > 60) {
    return '"Show it as" must be 3 to 60 characters.';
  }
  const existing = rows.find((r) => r.kind === candidate.kind
    && r.match_type === candidate.match_type && r.term === candidate.term);
  if (existing) {
    return existing.active
      ? 'That term is already in the list.'
      : 'That term is already in the list but turned off — switch it on below.';
  }
  return null;
}

function syncFormFields() {
  const isExclusion = kindEl.value === 'exclusion';
  $('term-match-group').hidden = isExclusion;
  $('term-match-hint').textContent = MATCH_HINTS[matchEl.value] || '';
  termEl.placeholder = isExclusion ? 'e.g. fire drill' : (matchEl.value === 'word' ? 'e.g. flooding' : 'e.g. kislap');
  addBtn.textContent = isExclusion ? 'Add phrase' : 'Add term';
}

function snippet(text, max = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function renderPreview() {
  const candidate = readForm();
  const problem = formProblem(candidate);

  errorEl.hidden = !problem;
  errorEl.textContent = problem || '';
  termEl.classList.toggle('error', Boolean(problem));

  if (!candidate.term || problem || !dbAvailable) {
    previewEl.hidden = true;
    return;
  }
  previewEl.hidden = false;

  if (!issues.length) {
    previewEl.className = 'terms-preview';
    previewEl.textContent = 'No past reports loaded to preview against.';
    return;
  }

  const before = flaggedSet(activeRows());
  const after = flaggedSet([...activeRows(), { ...candidate, active: true }]);
  const total = issues.length;

  if (candidate.kind === 'danger') {
    const added = issues.filter((i) => after.has(i.id) && !before.has(i.id));
    const containing = flaggedSet([{ ...candidate, active: true },
      ...activeRows().filter((r) => r.kind === 'exclusion')]).size;
    const broad = containing / total > BROAD_TERM_SHARE;
    previewEl.className = `terms-preview${broad ? ' is-warning' : ''}`;
    previewEl.innerHTML = `
      <div>Appears in <strong>${containing}</strong> of the last ${total} reports
        — <strong>${added.length}</strong> of them not already flagged.</div>
      ${broad ? `<div class="terms-preview-warn">That is a lot of reports. Check it is not part of everyday words,
        or it will push routine reports into High.</div>` : ''}
      ${added.length ? `<ul class="terms-preview-list">${added.slice(0, 3)
        .map((i) => `<li>${escapeHtml(snippet(i.text))}</li>`).join('')}</ul>` : ''}`;
  } else {
    const removed = issues.filter((i) => before.has(i.id) && !after.has(i.id));
    previewEl.className = 'terms-preview';
    previewEl.innerHTML = removed.length
      ? `<div>Would have stopped <strong>${removed.length}</strong> of the last ${total} reports from being flagged.</div>
         <ul class="terms-preview-list">${removed.slice(0, 3)
           .map((i) => `<li>${escapeHtml(snippet(i.text))}</li>`).join('')}</ul>`
      : `<div>Would not have changed any of the last ${total} reports. An exclusion only matters when the
           phrase contains a danger term, like &ldquo;smoke&rdquo; in &ldquo;smoke detector&rdquo;.</div>`;
  }
}

async function onSubmit(e) {
  e.preventDefault();
  if (!dbAvailable) return;
  const candidate = readForm();
  const problem = candidate.term ? formProblem(candidate) : 'Enter a term.';
  if (problem) {
    errorEl.hidden = false;
    errorEl.textContent = problem;
    termEl.classList.add('error');
    termEl.focus();
    return;
  }

  addBtn.disabled = true;
  const { error } = await supabase.from('safety_terms').insert(candidate);
  addBtn.disabled = false;
  if (error) {
    showToast(describeWriteError(error), 'error', 6000);
    return;
  }
  showToast(`"${escapeHtml(candidate.term)}" added.`, 'success');
  termEl.value = '';
  labelEl.value = '';
  noteEl.value = '';
  await refresh();
  renderPreview();
  termEl.focus();
}


/* ---------- Test box ---------- */

function renderTest() {
  const text = testInput.value;
  if (!text.trim()) {
    testResult.innerHTML = '<span class="terms-test-idle">Results appear as you type.</span>';
    return;
  }
  const compiled = compileSafetyTerms(activeRows());
  const hits = matchSafetyTerms(text, compiled);
  testResult.innerHTML = hits.length
    ? `<div class="terms-test-hit">
         <span class="priority-dot high"></span>
         <span>Raised to at least <strong>High</strong></span>
       </div>
       <div class="terms-test-terms">Matched: ${hits.map((h) => `<span class="terms-chip">${escapeHtml(h)}</span>`).join(' ')}</div>`
    : `<div class="terms-test-miss">No danger term found — the AI's priority would stand.</div>`;
}


/* ---------- Refresh ---------- */

async function refresh() {
  await loadTerms();
  renderSource();
  renderLists();
  renderTest();
}


/* ---------- Init ---------- */

function initChrome() {
  initSidebarToggle();
  renderTopbarUser();

  $('manage-users-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (currentUser?.role === 'admin') openCreateUserModal();
  });
  $('edit-profile-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    openEditAdminProfileModal();
  });
  $('sign-out-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await supabase.auth.signOut(); } catch (err) { /* ignore */ }
    sessionStorage.removeItem('firs_user');
    window.location.replace('../index.html');
  });
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 150);
}

initChrome();
syncFormFields();
kindEl.addEventListener('change', () => { syncFormFields(); renderPreview(); });
matchEl.addEventListener('change', () => { syncFormFields(); renderPreview(); });
[termEl, labelEl].forEach((el) => el.addEventListener('input', schedulePreview));
form.addEventListener('submit', onSubmit);
testInput.addEventListener('input', renderTest);
['danger-body', 'exclusion-body'].forEach((id) => {
  $(id).addEventListener('change', onListEvent);
  $(id).addEventListener('click', onListEvent);
});

/* Terms first so the lists appear straight away; the report counts fill in
   once the reports arrive. */
await refresh();
issues = (await loadIssues()).filter((i) => i.text);
renderLists();
renderPreview();
