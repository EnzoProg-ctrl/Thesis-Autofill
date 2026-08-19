/* ============================================================
   Staff Dashboard — Kanban + Table View (mirrors admin layout)
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { loadIssues, updateIssue, formatDate, formatRelativeTime, formatActivityTime, getLatestActivityTime, renderTopbarUser, initSidebarToggle, showToast, showSlideOver, closeSlideOver, escapeHtml, openEditAdminProfileModal } from './shared.js';
import { CATEGORIES, PRIORITY_LEVELS, STATUS_LIST, getCategoryLabel, getCategoryIcon, getStatusInfo, getPriorityInfo, getPriorityRank, getUsers } from './app-data.js';

/* ---------- Auth Guard — staff only ---------- */
if (!(await checkAuth('staff'))) {
  throw new Error('Not authenticated');
}

/* ---------- State ---------- */
let currentUser = null;
try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }

let issues = [];
let staffMap = {};                   // id -> profile, for the Assigned To column
let currentView = 'kanban';
let sortColumn = 'submitted';
let sortAsc = false;
let filters = { category: '', priority: '', status: '' };
let refreshTimer = null;

const STATUS_COLUMNS = ['awaiting_review', 'in_progress', 'resolved'];

/* ---------- Bootstrap ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    issues = await loadIssues();
  } catch (err) {
    console.error('Data load error:', err);
    issues = [];
  }

  // Needed to resolve assignedTo ids into names for the table's Assigned To
  // column. Non-fatal: an empty staffMap just renders every row "Unassigned".
  try {
    const staffList = await getUsers();
    if (staffList) staffList.forEach(s => staffMap[s.id] = s);
  } catch (err) {
    console.error('Staff load error:', err);
  }

  populateFilters();
  renderKPIs();
  renderCurrentView();
  bindEvents();
  startAutoRefresh();
  personalizeTopbar();
});

/* ---------- Topbar Personalization ---------- */
/* The role pill (.topbar-role) is static markup; only the name is filled in.
   See admin-dashboard.js for why the old initials rewrite was dropped. */
function personalizeTopbar() { renderTopbarUser(); }

/* ---------- KPIs ---------- */
function renderKPIs() {
  const myIssues = issues.filter(i => i.assignedTo === currentUser?.id);
  const inProgress = myIssues.filter(i => i.status === 'in_progress');
  const resolved = myIssues.filter(i => i.status === 'resolved');
  const critical = myIssues.filter(i => i.aiPriorityLevel === 'critical' && i.status !== 'resolved');

  document.getElementById('kpi-assigned').textContent = myIssues.filter(i => i.status !== 'resolved').length;
  document.getElementById('kpi-inprogress').textContent = inProgress.length;
  document.getElementById('kpi-resolved').textContent = resolved.length;
  document.getElementById('kpi-critical').textContent = critical.length;
}

/* ---------- Filter Population ---------- */
function populateFilters() {
  const catSelect = document.getElementById('filter-category');
  CATEGORIES.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.label;
    catSelect.appendChild(opt);
  });

  const priSelect = document.getElementById('filter-priority');
  PRIORITY_LEVELS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    priSelect.appendChild(opt);
  });

  const statusSelect = document.getElementById('filter-status');
  STATUS_LIST.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    statusSelect.appendChild(opt);
  });
}

function getFilteredIssues() {
  return issues.filter(i => {
    if (filters.category && i.aiCategory !== filters.category) return false;
    if (filters.priority && i.aiPriorityLevel !== filters.priority) return false;
    if (filters.status && i.status !== filters.status) return false;
    return true;
  });
}

/* ---------- View Toggle ---------- */
function renderCurrentView() {
  const kanbanEl = document.getElementById('kanban-board');
  const tableEl = document.getElementById('table-container');
  if (currentView === 'kanban') {
    kanbanEl.classList.remove('hidden');
    tableEl.classList.add('hidden');
    renderKanban();
  } else {
    kanbanEl.classList.add('hidden');
    tableEl.classList.remove('hidden');
    renderTable();
  }
}

/* ==========================================================
   Kanban Board
   ========================================================== */

function renderKanban() {
  const board = document.getElementById('kanban-board');
  const filtered = getFilteredIssues();
  board.innerHTML = '';

  STATUS_COLUMNS.forEach(statusId => {
    const statusInfo = getStatusInfo(statusId);
    const colIssues = filtered.filter(i => i.status === statusId);

    const col = document.createElement('div');
    col.className = 'kanban-column';
    col.dataset.status = statusId;

    col.innerHTML = `
      <div class="kanban-column-header">
        <span class="kanban-column-title">${escapeHtml(statusInfo.label)}</span>
        <span class="kanban-column-count">${colIssues.length}</span>
      </div>
      <div class="kanban-column-body" data-status="${statusId}"></div>
    `;

    const body = col.querySelector('.kanban-column-body');

    // Drag-and-drop zone events
    body.addEventListener('dragover', handleDragOver);
    body.addEventListener('dragenter', handleDragEnter);
    body.addEventListener('dragleave', handleDragLeave);
    body.addEventListener('drop', handleDrop);

    // Same ordering as the admin board (admin-dashboard.js): priority level,
    // then score, then latest activity. See that file for why the level has to
    // lead — the card's dot renders the level, and the model's level and score
    // can disagree, which made a Low card sort above Mediums.
    colIssues.sort((a, b) => {
      // Level first, so the order agrees with the coloured dot on each card.
      const lvlDiff = getPriorityRank(b.aiPriorityLevel) - getPriorityRank(a.aiPriorityLevel);
      if (lvlDiff !== 0) return lvlDiff;
      // Then the model's score, which separates cards inside one band.
      const priDiff = (b.aiPriority || 0) - (a.aiPriority || 0);
      return priDiff !== 0 ? priDiff : getLatestActivityTime(b) - getLatestActivityTime(a);
    });

    if (colIssues.length === 0) {
      body.innerHTML = `<div class="empty-state" style="padding: var(--sp-6) var(--sp-2);"><div class="empty-state-text">No issues</div></div>`;
    } else {
      colIssues.forEach(issue => {
        body.appendChild(createKanbanCard(issue));
      });
    }

    board.appendChild(col);
  });
}

function createKanbanCard(issue) {
  const priorityInfo = getPriorityInfo(issue.aiPriorityLevel);
  const isAssignedToMe = issue.assignedTo === currentUser?.id;

  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.draggable = true;
  card.dataset.issueId = issue.id;

  const priorityLabel = priorityInfo ? priorityInfo.label : (issue.aiPriorityLevel || 'Unknown');
  const tenantDisplay = escapeHtml(issue.storeName || 'Unknown');

  card.innerHTML = `
    <span class="priority-dot ${issue.aiPriorityLevel || 'low'}" title="Priority: ${escapeHtml(priorityLabel)}"></span>
    <div class="kanban-card-header">
      <span class="kanban-card-id">${escapeHtml(issue.ticketNumber || issue.id.slice(0, 8))}</span>
    </div>
    <div class="kanban-card-title">${escapeHtml(issue.text || '')}</div>
    <div class="kanban-card-meta">
      <span>${tenantDisplay}</span>
      <span class="badge badge-gray">${getCategoryIcon(issue.aiCategory)} ${escapeHtml(getCategoryLabel(issue.aiCategory))}</span>
      ${issue.textEditedAt ? `<span class="badge badge-warning" title="The tenant changed the description after submitting. Priority was re-checked against the new text.">Edited</span>` : ''}
      <span>${formatRelativeTime(issue.submittedAt)}</span>
    </div>
    ${isAssignedToMe ? `<div style="margin-top:var(--sp-1);"><span style="font-size:10px; background:var(--primary-50); color:var(--primary-700); padding:2px 8px; border-radius:100px; font-weight:600;">✓ Assigned to me</span></div>` : ''}
  `;

  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);
  card.addEventListener('click', () => openIssueDetail(issue.id));

  return card;
}

/* ---------- Drag-and-Drop ---------- */
let draggedIssueId = null;

function handleDragStart(e) {
  draggedIssueId = e.currentTarget.dataset.issueId;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggedIssueId);
}

function handleDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  draggedIssueId = null;
  document.querySelectorAll('.kanban-column-body.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e) {
  e.preventDefault();
  const dropZone = e.currentTarget;
  dropZone.classList.remove('drag-over');

  const newStatus = dropZone.dataset.status;
  if (!draggedIssueId || !newStatus) return;

  const issue = issues.find(i => i.id === draggedIssueId);
  if (!issue || issue.status === newStatus) return;

  try {
    await updateIssue(issue.id, { status: newStatus });
    issue.status = newStatus;
    renderKPIs();
    renderCurrentView();
    showToast(`Moved to ${getStatusInfo(newStatus).label}`, 'success');
  } catch (err) {
    showToast('Failed to update status.', 'error');
  }
}

/* ==========================================================
   Data Table
   ========================================================== */

/* Kept deliberately identical to admin-dashboard.js renderTable() — same
   columns, same cell markup, same sort keys. The two used to drift: this one
   sorted Category by the raw id ("hvac") instead of the visible label ("Air
   Conditioning"), and Status alphabetically ("awaiting_review" < "in_progress"
   < "resolved" only by luck) rather than by workflow order. */
function renderTable() {
  const tbody = document.getElementById('table-body');
  const filtered = getFilteredIssues();

  // Copy before sorting: getFilteredIssues() returns a fresh array today, but
  // sorting in place would reorder the caller's data if that ever changes.
  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;
    switch (sortColumn) {
      case 'id':
        // Sort by the ticket number the cell actually displays, not the UUID.
        aVal = (a.ticketNumber || '').toLowerCase();
        bVal = (b.ticketNumber || '').toLowerCase();
        break;
      case 'tenant':
        aVal = (a.storeName || '').toLowerCase();
        bVal = (b.storeName || '').toLowerCase();
        break;
      case 'category':
        aVal = getCategoryLabel(a.aiCategory).toLowerCase();
        bVal = getCategoryLabel(b.aiCategory).toLowerCase();
        break;
      case 'priority':
        aVal = a.aiPriority; bVal = b.aiPriority; break;
      case 'status':
        aVal = STATUS_COLUMNS.indexOf(a.status);
        bVal = STATUS_COLUMNS.indexOf(b.status);
        break;
      case 'submitted':
        aVal = getLatestActivityTime(a);
        bVal = getLatestActivityTime(b);
        break;
      case 'assigned':
        // 'zzz' parks unassigned rows at the end of an ascending sort.
        aVal = (staffMap[a.assignedTo]?.name || 'zzz').toLowerCase();
        bVal = (staffMap[b.assignedTo]?.name || 'zzz').toLowerCase();
        break;
      default:
        aVal = a.id; bVal = b.id;
    }
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    // Tiebreaker: most severe first, matching the kanban columns.
    return (b.aiPriority || 0) - (a.aiPriority || 0);
  });

  tbody.innerHTML = '';

  if (sorted.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted p-6">No issues match the current filters.</td></tr>`;
    return;
  }

  sorted.forEach(issue => {
    const tenantDisplay = escapeHtml(issue.storeName || '—');
    const priorityInfo = getPriorityInfo(issue.aiPriorityLevel);
    const statusInfo = getStatusInfo(issue.status);
    const staff = issue.assignedTo ? staffMap[issue.assignedTo] : null;

    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td><span class="font-semibold">${escapeHtml(issue.ticketNumber || issue.id)}</span></td>
      <td>${tenantDisplay}</td>
      <td><span class="badge badge-gray">${getCategoryIcon(issue.aiCategory)} ${escapeHtml(getCategoryLabel(issue.aiCategory))}</span></td>
      <td>
        <div class="flex items-center gap-2">
          <span class="priority-dot ${issue.aiPriorityLevel}"></span>
          <span class="font-semibold" style="color:${priorityInfo.color}">${issue.aiPriority}</span>
        </div>
      </td>
      <td><span class="status-badge" style="color:${statusInfo.color}">${escapeHtml(statusInfo.label)}</span></td>
      <td class="text-sm text-muted">${formatActivityTime(issue)}</td>
      <td>${staff ? escapeHtml(staff.name) : '<span class="text-muted">Unassigned</span>'}</td>
    `;
    tr.addEventListener('click', () => openIssueDetail(issue.id));
    tbody.appendChild(tr);
  });

  // Update sort header styling. This was missing here, so the staff table's
  // arrows stayed "↕" no matter which column was sorted.
  document.querySelectorAll('#data-table th').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === sortColumn);
    const icon = th.querySelector('.sort-icon');
    if (icon) {
      icon.textContent = th.dataset.sort === sortColumn ? (sortAsc ? '↑' : '↓') : '↕';
    }
  });
}

/* ==========================================================
   Issue Detail Slide-Over
   ========================================================== */

function openIssueDetail(issueId) {
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;

  const priorityInfo = getPriorityInfo(issue.aiPriorityLevel);

  const bodyHTML = `
    <div style="display:flex; flex-direction:column; gap: var(--sp-4);">
      <div style="display:flex; gap: var(--sp-2); align-items:center; flex-wrap:wrap;">
        <span class="status-badge ${escapeHtml(issue.status)}">${escapeHtml(getStatusInfo(issue.status).label)}</span>
        <span class="priority-badge ${escapeHtml(issue.aiPriorityLevel)}">${escapeHtml(priorityInfo.label)}</span>
        <span style="font-size:var(--text-xs); color:var(--gray-400); margin-left:auto;">${formatRelativeTime(issue.submittedAt)}</span>
      </div>

      <div>
        <div style="font-size:var(--text-xs); font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.05em; margin-bottom:var(--sp-2);">Issue Description</div>
        <div style="background:var(--gray-50); border:1px solid var(--gray-200); border-radius:var(--radius-md); padding:var(--sp-3); font-size:var(--text-sm); line-height:1.6; color:var(--gray-800);">
          ${escapeHtml(issue.text || '')}
        </div>
      </div>

      <div>
        <div style="font-size:var(--text-xs); font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.05em; margin-bottom:var(--sp-2);">Tenant</div>
        <div style="font-size:var(--text-sm); color:var(--gray-800);">
          <div style="font-weight:600;">${escapeHtml(issue.storeName || '—')}</div>
          <div style="color:var(--gray-500);">${escapeHtml(issue.contactPerson || '')} ${issue.phoneNumber ? '• ' + escapeHtml(issue.phoneNumber) : ''}</div>
        </div>
      </div>

      <div>
        <div style="font-size:var(--text-xs); font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.05em; margin-bottom:var(--sp-2);">AI Analysis</div>
        <div style="display:flex; flex-direction:column; gap:var(--sp-1); font-size:var(--text-sm);">
          <div><span style="color:var(--gray-500);">Category:</span> <strong>${getCategoryIcon(issue.aiCategory)} ${escapeHtml(getCategoryLabel(issue.aiCategory))}</strong></div>
          <div><span style="color:var(--gray-500);">Confidence:</span> <strong>${issue.aiConfidence ?? '—'}%</strong></div>
          <div><span style="color:var(--gray-500);">Priority:</span> <strong style="color:${escapeHtml(priorityInfo.color)}">${escapeHtml(priorityInfo.label)}</strong></div>
          <div><span style="color:var(--gray-500);">Language:</span> <strong>${escapeHtml(issue.aiLanguage || '—')}</strong></div>
        </div>
      </div>

      <div style="display:flex; flex-direction:column; gap:var(--sp-2);">
        <div style="font-size:var(--text-xs); font-weight:600; color:var(--gray-500); text-transform:uppercase; letter-spacing:.05em; margin-bottom:var(--sp-1);">Update Status</div>
        <select class="form-select" id="so-status-select">
          <option value="awaiting_review" ${issue.status === 'awaiting_review' ? 'selected' : ''}>Awaiting Review</option>
          <option value="in_progress" ${issue.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
          <option value="resolved" ${issue.status === 'resolved' ? 'selected' : ''}>Resolved</option>
        </select>
        <button class="btn btn-primary w-full" id="so-save-btn">Save Changes</button>
      </div>
    </div>
  `;

  const panel = showSlideOver(`${escapeHtml(issue.ticketNumber || 'Issue')} — ${escapeHtml(getCategoryLabel(issue.category))}`, bodyHTML);

  panel.querySelector('#so-save-btn').addEventListener('click', async () => {
    const newStatus = panel.querySelector('#so-status-select').value;
    try {
      await updateIssue(issue.id, { status: newStatus });
      issue.status = newStatus;
      showToast('Status updated!', 'success');
      closeSlideOver();
      renderKPIs();
      renderCurrentView();
    } catch (err) {
      showToast('Failed to update status.', 'error');
    }
  });


}

/* ==========================================================
   Event Bindings
   ========================================================== */

function bindEvents() {
  // View toggle
  document.querySelectorAll('#view-toggle .segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#view-toggle .segmented-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      renderCurrentView();
    });
  });

  // Filters
  document.getElementById('filter-category')?.addEventListener('change', (e) => {
    filters.category = e.target.value;
    renderCurrentView();
  });
  document.getElementById('filter-priority')?.addEventListener('change', (e) => {
    filters.priority = e.target.value;
    renderCurrentView();
  });
  document.getElementById('filter-status')?.addEventListener('change', (e) => {
    filters.status = e.target.value;
    renderCurrentView();
  });

  // Table sort
  document.querySelectorAll('#data-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) { sortAsc = !sortAsc; } else { sortColumn = col; sortAsc = true; }
      renderTable();
    });
  });

  // Mobile sidebar
  initSidebarToggle();

  // Edit profile
  document.getElementById('edit-profile-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await openEditAdminProfileModal();
  });

  // Sign out
  document.getElementById('sign-out-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await supabase.auth.signOut(); } catch (err) { /* ignore */ }
    sessionStorage.removeItem('firs_user');
    window.location.replace('../index.html');
  });
}

/* ---------- Auto-Refresh ---------- */
function startAutoRefresh() {
  refreshTimer = setInterval(async () => {
    try {
      issues = await loadIssues();
      renderKPIs();
      renderCurrentView();
    } catch (err) {
      console.error('Auto-refresh error:', err);
    }
  }, 30000);
}
