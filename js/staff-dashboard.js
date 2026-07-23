/* ============================================================
   Staff Dashboard — Kanban + Table View (mirrors admin layout)
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { loadIssues, updateIssue, formatDate, formatRelativeTime, showToast, showSlideOver, closeSlideOver, escapeHtml, openEditAdminProfileModal } from './shared.js';
import { CATEGORIES, PRIORITY_LEVELS, STATUS_LIST, getCategoryLabel, getCategoryIcon, getStatusInfo, getPriorityInfo } from './mock-data.js';

/* ---------- Auth Guard — staff only ---------- */
if (!(await checkAuth('staff'))) {
  throw new Error('Not authenticated');
}

/* ---------- State ---------- */
let currentUser = null;
try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }

let issues = [];
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

  populateFilters();
  renderKPIs();
  renderCurrentView();
  bindEvents();
  startAutoRefresh();
  personalizeTopbar();
});

/* ---------- Topbar Personalization ---------- */
function personalizeTopbar() {
  if (!currentUser) return;
  const avatarEl = document.querySelector('.topbar-avatar');
  const nameEl = document.querySelector('.topbar-user span:last-child');
  if (avatarEl) avatarEl.textContent = currentUser.avatar || currentUser.name?.substring(0, 2) || 'ST';
  if (nameEl) nameEl.textContent = currentUser.name || 'Staff';
}

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

    colIssues.sort((a, b) => (b.aiPriority || 0) - (a.aiPriority || 0));

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

  const tenantDisplay = escapeHtml(issue.storeName || 'Unknown');

  card.innerHTML = `
    <div class="kanban-card-header">
      <span class="kanban-card-id">${escapeHtml(issue.ticketNumber || issue.id.slice(0, 8))}</span>
      <span class="priority-dot ${issue.aiPriorityLevel || 'low'}"></span>
    </div>
    <div class="kanban-card-title">${escapeHtml(issue.text || '')}</div>
    <div class="kanban-card-meta">
      <span>${tenantDisplay}</span>
      <span class="badge badge-gray">${getCategoryIcon(issue.aiCategory)} ${getCategoryLabel(issue.aiCategory)}</span>
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

function renderTable() {
  const tbody = document.getElementById('table-body');
  let filtered = getFilteredIssues();

  // Sort
  filtered.sort((a, b) => {
    let valA, valB;
    switch (sortColumn) {
      case 'id': valA = a.ticketNumber || ''; valB = b.ticketNumber || ''; break;
      case 'tenant': valA = a.storeName || ''; valB = b.storeName || ''; break;
      case 'category': valA = a.aiCategory || ''; valB = b.aiCategory || ''; break;
      case 'priority': valA = a.aiPriority || 0; valB = b.aiPriority || 0; break;
      case 'status': valA = a.status || ''; valB = b.status || ''; break;
      case 'submitted': valA = a.submittedAt || ''; valB = b.submittedAt || ''; break;
      default: valA = ''; valB = '';
    }
    if (typeof valA === 'number') return sortAsc ? valA - valB : valB - valA;
    return sortAsc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:var(--sp-8); color:var(--gray-400);">No issues found</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(issue => {
    const priorityInfo = getPriorityInfo(issue.aiPriorityLevel);
    const statusInfo = getStatusInfo(issue.status);
    return `
      <tr data-id="${escapeHtml(issue.id)}" style="cursor:pointer;">
        <td style="font-family:monospace; font-size:var(--text-xs);">${escapeHtml(issue.ticketNumber || issue.id.slice(0, 8))}</td>
        <td>${escapeHtml(issue.storeName || '—')}</td>
        <td>${getCategoryIcon(issue.aiCategory)} ${escapeHtml(getCategoryLabel(issue.aiCategory))}</td>
        <td><span class="priority-badge ${issue.aiPriorityLevel}">${escapeHtml(priorityInfo.label)}</span></td>
        <td><span class="status-badge ${issue.status}">${escapeHtml(statusInfo.label)}</span></td>
        <td>${formatRelativeTime(issue.submittedAt)}</td>
      </tr>
    `;
  }).join('');

  // Row click
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openIssueDetail(row.dataset.id));
  });
}

/* ==========================================================
   Issue Detail Slide-Over
   ========================================================== */

function openIssueDetail(issueId) {
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;

  const priorityInfo = getPriorityInfo(issue.aiPriorityLevel);
  const isAssignedToMe = issue.assignedTo === currentUser?.id;

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
        <div style="display:flex; gap:var(--sp-2); flex-wrap:wrap;">
          ${!isAssignedToMe ? `<button class="btn btn-secondary" id="so-claim-btn" style="flex:1;">Claim Issue</button>` : ''}
          <button class="btn btn-primary" id="so-save-btn" style="flex:2;">Save Changes</button>
        </div>
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

  const claimBtn = panel.querySelector('#so-claim-btn');
  if (claimBtn) {
    claimBtn.addEventListener('click', async () => {
      try {
        await updateIssue(issue.id, { assignedTo: currentUser.id, status: 'in_progress' });
        issue.assignedTo = currentUser.id;
        issue.status = 'in_progress';
        showToast('Issue claimed and set to In Progress!', 'success');
        closeSlideOver();
        renderKPIs();
        renderCurrentView();
      } catch (err) {
        showToast('Failed to claim issue.', 'error');
      }
    });
  }
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
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.querySelector('.admin-content')?.addEventListener('click', () => {
      if (sidebar.classList.contains('open')) sidebar.classList.remove('open');
    });
  }

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
