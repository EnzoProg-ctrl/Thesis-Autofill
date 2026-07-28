/* ============================================================
   Admin Dashboard — KPIs, Kanban, Table, Slide-Over, Filters
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { loadIssues, updateIssue, formatDate, formatRelativeTime, showToast, showModal, closeModal, showSlideOver, closeSlideOver, escapeHtml, openCreateUserModal, openEditAdminProfileModal } from './shared.js';
import { CATEGORIES, PRIORITY_LEVELS, STATUS_LIST, getCategoryLabel, getCategoryIcon, getStatusInfo, getPriorityInfo, getUsers } from './mock-data.js';

/* ---------- Auth Guard ---------- */
// Allow both admin and staff roles to access admin pages.
if (!(await checkAuth(['admin', 'staff']))) {
  throw new Error('Not authenticated');
}

/* ---------- Current User ---------- */
let currentUser = null;
try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }

/* ---------- State ---------- */

let issues = [];
let staffMap = {};
let currentView = 'kanban';          // 'kanban' | 'table'
let sortColumn = 'submitted';
let sortAsc = false;
let filters = { category: '', priority: '', status: '' };
let refreshTimer = null;

/* ---------- Status column ordering ---------- */

const STATUS_COLUMNS = ['awaiting_review', 'in_progress', 'resolved'];

/* ---------- Bootstrap ---------- */

async function initDashboard() {
  try {
    issues = await loadIssues();
  } catch (err) {
    console.error('Issues load error:', err);
    issues = [];
    showToast('Failed to load issues: ' + err.message, 'error');
  }

  try {
    const staffList = await getUsers();
    if (staffList) {
      staffList.forEach(s => staffMap[s.id] = s);
    }
  } catch (err) {
    console.error('Staff load error:', err);
  }

  applyRBAC();
  populateFilters();
  renderKPIs();
  renderCurrentView();
  updateHITLBadge();
  bindEvents();
  startAutoRefresh();
  personalizeTopbar();
}

/* ==========================================================
   RBAC — Role-Based Access Control
   ========================================================== */

function applyRBAC() {
  if (!currentUser) return;

  if (currentUser.role === 'staff') {
    // Hide HITL Review, Manage Users, and Analytics links for staff
    const hitlLink = document.getElementById('hitl-link');
    if (hitlLink) hitlLink.classList.add('hidden');

    const manageUsersLink = document.getElementById('manage-users-link');
    if (manageUsersLink) manageUsersLink.classList.add('hidden');

    const analyticsLink = document.querySelector('a[href="analytics.html"]');
    if (analyticsLink) analyticsLink.classList.add('hidden');
  }
}

function personalizeTopbar() {
  if (!currentUser) return;
  const avatarEl = document.querySelector('.topbar-avatar');
  const nameEl = document.querySelector('.topbar-user span:last-child');
  if (avatarEl) avatarEl.textContent = currentUser.avatar || currentUser.name.substring(0, 3);
  if (nameEl) nameEl.textContent = currentUser.name || 'User';
}

/* ==========================================================
   KPI Calculation
   ========================================================== */

function renderKPIs() {
  const openIssues = issues.filter(i => i.status !== 'resolved');
  const criticalIssues = issues.filter(i => i.aiPriorityLevel === 'critical' && i.status !== 'resolved');

  // Avg resolution time (from resolved issues that have submittedAt and updatedAt)
  const resolved = issues.filter(i => i.status === 'resolved');
  let avgHours = 0;
  if (resolved.length > 0) {
    const totalHrs = resolved.reduce((sum, i) => {
      const submitted = new Date(i.submittedAt);
      const updated = new Date(i.updatedAt);
      return sum + (updated - submitted) / 3600000;
    }, 0);
    avgHours = Math.round(totalHrs / resolved.length);
  }

  // AI accuracy (validated issues where aiCategory === category chosen by user)
  const validated = issues.filter(i => i.validated);
  let accuracy = 0;
  if (validated.length > 0) {
    const correct = validated.filter(i => i.aiCategory === i.category);
    accuracy = Math.round((correct.length / validated.length) * 100);
  }

  document.getElementById('kpi-open').textContent = openIssues.length;
  document.getElementById('kpi-critical').textContent = criticalIssues.length;
  document.getElementById('kpi-resolution').textContent = avgHours + 'h';
  document.getElementById('kpi-accuracy').textContent = accuracy + '%';

  // Trend indicators
  setTrend('kpi-open-trend', openIssues.length, 'issues open', true);
  setTrend('kpi-critical-trend', criticalIssues.length, 'need attention', true);
  setTrend('kpi-resolution-trend', avgHours, 'hrs average', false);
  setTrend('kpi-accuracy-trend', accuracy, '% validated match', false);
}

function setTrend(id, value, label, isUpBad) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value > 0) {
    el.textContent = `${value} ${label}`;
    el.className = 'kpi-trend';
  } else {
    el.textContent = `0 ${label}`;
    el.className = 'kpi-trend';
  }
}

/* ==========================================================
   HITL Badge
   ========================================================== */

function updateHITLBadge() {
  const count = issues.filter(i => i.validated === false && i.status !== 'resolved').length;
  sessionStorage.setItem('firs_badge_count', count);
  const badge = document.getElementById('hitl-badge');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
  }
}

/* ==========================================================
   Filter Population & Logic
   ========================================================== */

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
  let result = issues.filter(i => {
    if (filters.category && i.aiCategory !== filters.category) return false;
    if (filters.priority && i.aiPriorityLevel !== filters.priority) return false;
    if (filters.status && i.status !== filters.status) return false;
    return true;
  });

  // RBAC: Staff see validated issues assigned to them AND any issue with status 'awaiting_review'
  if (currentUser && currentUser.role === 'staff') {
    result = result.filter(i => i.status === 'awaiting_review' || (i.validated === true && i.assignedTo === currentUser.id));
  }

  return result;
}

/* ==========================================================
   View Toggle
   ========================================================== */

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

    // Sort by aiPriority descending (highest priority first)
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

  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.draggable = true;
  card.dataset.issueId = issue.id;

  const priorityLabel = priorityInfo ? priorityInfo.label : (issue.aiPriorityLevel || 'Unknown');
  const tenantDisplay = escapeHtml(issue.storeName || 'Unknown');

  card.innerHTML = `
    <span class="priority-dot ${issue.aiPriorityLevel || ''}" title="Priority: ${escapeHtml(priorityLabel)}"></span>
    <div class="kanban-card-header">
      <span class="kanban-card-id">${escapeHtml(issue.ticketNumber || issue.id)}</span>
    </div>
    <div class="kanban-card-title">${escapeHtml(issue.text)}</div>
    <div class="kanban-card-meta">
      <span>${tenantDisplay}</span>
      <span class="badge badge-gray">${getCategoryIcon(issue.aiCategory)} ${getCategoryLabel(issue.aiCategory)}</span>
      <span>${formatRelativeTime(issue.submittedAt)}</span>
    </div>
  `;

  // Drag events
  card.addEventListener('dragstart', handleDragStart);
  card.addEventListener('dragend', handleDragEnd);

  // Click to open slide-over
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
  // Remove all drag-over highlights
  document.querySelectorAll('.kanban-column-body.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  const body = e.currentTarget.closest('.kanban-column-body') || e.currentTarget;
  if (body.classList.contains('kanban-column-body')) {
    body.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  const body = e.currentTarget;
  // Only remove if truly leaving the container
  if (!body.contains(e.relatedTarget)) {
    body.classList.remove('drag-over');
  }
}

async function handleDrop(e) {
  e.preventDefault();
  const body = e.currentTarget;
  body.classList.remove('drag-over');

  const issueId = e.dataTransfer.getData('text/plain');
  const newStatus = body.dataset.status;

  if (!issueId || !newStatus) return;

  const issue = issues.find(i => i.id === issueId);
  if (!issue || issue.status === newStatus) return;

  // Update issue status
  const updatedIssue = await updateIssue(issueId, { status: newStatus });
  const idx = issues.findIndex(i => i.id === issueId);
  if (idx !== -1) issues[idx] = updatedIssue;
  renderKanban();
  renderKPIs();
  updateHITLBadge();
  showToast(`${issue.ticketNumber || issueId} moved to ${getStatusInfo(newStatus).label}`, 'success');
}

/* ==========================================================
   Data Table
   ========================================================== */

function renderTable() {
  const tbody = document.getElementById('table-body');
  const filtered = getFilteredIssues();

  // Sort — default secondary sort by aiPriority descending
  const sorted = [...filtered].sort((a, b) => {
    let aVal, bVal;
    switch (sortColumn) {
      case 'id':
        aVal = a.id; bVal = b.id; break;
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
        aVal = new Date(a.submittedAt).getTime();
        bVal = new Date(b.submittedAt).getTime();
        break;
      case 'assigned':
        aVal = (staffMap[a.assignedTo]?.name || 'zzz').toLowerCase();
        bVal = (staffMap[b.assignedTo]?.name || 'zzz').toLowerCase();
        break;
      default:
        aVal = a.id; bVal = b.id;
    }
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    // Tiebreaker: sort by aiPriority descending
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
      <td><span class="badge badge-gray">${getCategoryIcon(issue.aiCategory)} ${getCategoryLabel(issue.aiCategory)}</span></td>
      <td>
        <div class="flex items-center gap-2">
          <span class="priority-dot ${issue.aiPriorityLevel}"></span>
          <span class="font-semibold" style="color:${priorityInfo.color}">${issue.aiPriority}</span>
        </div>
      </td>
      <td><span class="status-badge" style="color:${statusInfo.color}">${escapeHtml(statusInfo.label)}</span></td>
      <td class="text-sm text-muted">${formatRelativeTime(issue.submittedAt)}</td>
      <td>${staff ? escapeHtml(staff.name) : '<span class="text-muted">Unassigned</span>'}</td>
    `;
    tr.addEventListener('click', () => openIssueDetail(issue.id));
    tbody.appendChild(tr);
  });

  // Update sort header styling
  document.querySelectorAll('#data-table th').forEach(th => {
    th.classList.toggle('sorted', th.dataset.sort === sortColumn);
    const icon = th.querySelector('.sort-icon');
    if (icon) {
      icon.textContent = th.dataset.sort === sortColumn ? (sortAsc ? '↑' : '↓') : '↕';
    }
  });
}

/* ==========================================================
   Slide-Over Detail Panel
   ========================================================== */

function openIssueDetail(issueId) {
  const issue = issues.find(i => i.id === issueId);
  if (!issue) return;

  const statusInfo = getStatusInfo(issue.status);
  const priorityInfo = getPriorityInfo(issue.aiPriorityLevel);
  const staff = issue.assignedTo ? staffMap[issue.assignedTo] : null;

  // Confidence bar level
  let confLevel = 'low';
  if (issue.aiConfidence >= 85) confLevel = 'high';
  else if (issue.aiConfidence >= 70) confLevel = 'medium';

  // Priority gauge color
  let gaugeColor = priorityInfo.color;

  // Staff options
  const staffList = Object.values(staffMap).filter(s => s.role === 'staff');
  const staffOptions = staffList.map(s =>
    `<option value="${s.id}" ${issue.assignedTo === s.id ? 'selected' : ''}>${s.name} — ${s.trade || 'Staff'}</option>`
  ).join('');

  // Status options
  const statusOptions = STATUS_LIST.map(s =>
    `<option value="${s.id}" ${issue.status === s.id ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  const showControls = currentUser && currentUser.role !== 'staff';
  const controlsHTML = showControls ? `
    <!-- Assignment -->
    <div class="form-group">
      <label class="form-label">Assign To</label>
      <select class="form-select" id="detail-assign">
        <option value="">— Unassigned —</option>
        ${staffOptions}
      </select>
    </div>

    <!-- Status -->
    <div class="form-group">
      <label class="form-label">Status</label>
      <select class="form-select" id="detail-status">
        ${statusOptions}
      </select>
    </div>

    <button class="btn btn-primary w-full" id="detail-save" style="margin-top: var(--sp-2);">Save Changes</button>
  ` : '';

  const bodyHTML = `
    <div style="margin-bottom: var(--sp-5);">
      <div class="flex items-center gap-3" style="margin-bottom: var(--sp-4);">
        <span class="font-semibold" style="font-size: var(--text-lg);">${escapeHtml(issue.ticketNumber || issue.id)}</span>
        <span class="status-badge" style="color:${statusInfo.color}">${escapeHtml(statusInfo.label)}</span>
        ${issue.validated ? '<span class="badge badge-success">✓ Validated</span>' : '<span class="badge badge-warning">Pending Review</span>'}
      </div>
      ${issue.storeName
      ? `<div class="text-sm text-muted" style="margin-bottom: var(--sp-2);">${escapeHtml(issue.storeName)}${issue.contactPerson ? ' • ' + escapeHtml(issue.contactPerson) : ''}${issue.phoneNumber ? ' • ' + escapeHtml(issue.phoneNumber) : ''}</div>`
      : ''
    }
    </div>

    <!-- Original Text -->
    <div style="margin-bottom: var(--sp-5);">
      <div class="text-xs font-semibold text-muted" style="text-transform:uppercase; letter-spacing:0.05em; margin-bottom: var(--sp-2);">Original Text</div>
      <div class="hitl-original-text">${escapeHtml(issue.text)}</div>
    </div>

    ${issue.imageUrl ? `
    <!-- Attached Photo -->
    <div style="margin-bottom: var(--sp-5);">
      <div class="text-xs font-semibold text-muted" style="text-transform:uppercase; letter-spacing:0.05em; margin-bottom: var(--sp-2);">Attached Photo</div>
      <img src="${issue.imageUrl}" alt="Issue photo" style="max-width:100%; border-radius:var(--radius-md); border:1px solid var(--gray-200); cursor:pointer;" onclick="window.open(this.src,'_blank')">
    </div>
    ` : ''}

    <!-- AI Analysis -->
    <div style="margin-bottom: var(--sp-5);">
      <div class="text-xs font-semibold text-muted" style="text-transform:uppercase; letter-spacing:0.05em; margin-bottom: var(--sp-3);">AI Analysis</div>

      <div class="flex items-center gap-3" style="margin-bottom: var(--sp-3);">
        <span class="lang-badge">🌐 ${escapeHtml(issue.aiLanguage || 'Unknown')}</span>
      </div>

      <div style="margin-bottom: var(--sp-3);">
        <div class="text-sm font-medium" style="margin-bottom: var(--sp-1);">Category: <span class="badge badge-primary">${getCategoryIcon(issue.aiCategory)} ${getCategoryLabel(issue.aiCategory)}</span></div>
        <div class="text-xs text-muted" style="margin-bottom: 4px;">Confidence: ${issue.aiConfidence}%</div>
        <div class="confidence-bar">
          <div class="confidence-bar-fill ${confLevel}" style="width: ${issue.aiConfidence}%;"></div>
        </div>
      </div>

      <div>
        <div class="text-sm font-medium" style="margin-bottom: var(--sp-1);">Priority Score</div>
        <div class="priority-gauge">
          <div class="priority-gauge-bar">
            <div class="priority-gauge-fill" style="width: ${issue.aiPriority}%; background: ${gaugeColor};"></div>
          </div>
          <span class="priority-gauge-label" style="color: ${gaugeColor};">${issue.aiPriority}</span>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <span class="priority-badge ${issue.aiPriorityLevel}"><span class="priority-dot ${issue.aiPriorityLevel}"></span> ${priorityInfo.label}</span>
        </div>
      </div>
    </div>

    ${controlsHTML}
  `;

  const panel = showSlideOver(`Issue Detail`, bodyHTML);

  // Bind save
  const saveBtn = panel.querySelector('#detail-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const newAssign = panel.querySelector('#detail-assign').value || null;
      const newStatus = panel.querySelector('#detail-status').value;

      const updatedIssue = await updateIssue(issue.id, {
        assignedTo: newAssign,
        status: newStatus,
      });
      const idx = issues.findIndex(i => i.id === issue.id);
      if (idx !== -1) issues[idx] = updatedIssue;

      closeSlideOver();
      renderKPIs();
      renderCurrentView();
      updateHITLBadge();
      showToast(`${issue.ticketNumber || issue.id} updated successfully`, 'success');
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
  document.getElementById('filter-category').addEventListener('change', (e) => {
    filters.category = e.target.value;
    renderCurrentView();
  });
  document.getElementById('filter-priority').addEventListener('change', (e) => {
    filters.priority = e.target.value;
    renderCurrentView();
  });
  document.getElementById('filter-status').addEventListener('change', (e) => {
    filters.status = e.target.value;
    renderCurrentView();
  });

  // Table sort
  document.querySelectorAll('#data-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) {
        sortAsc = !sortAsc;
      } else {
        sortColumn = col;
        sortAsc = true;
      }
      renderTable();
    });
  });

  // Mobile sidebar
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
    document.querySelector('.admin-content').addEventListener('click', () => {
      if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
      }
    });
  }

  // Manage Users — admin only
  const manageUsersLink = document.getElementById('manage-users-link');
  if (manageUsersLink) {
    manageUsersLink.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentUser && currentUser.role === 'admin') {
        openCreateUserModal();
      }
    });
  }

  // Edit Profile link
  const editProfileLink = document.getElementById('edit-profile-link');
  if (editProfileLink) {
    editProfileLink.addEventListener('click', (e) => {
      e.preventDefault();
      openEditAdminProfileModal();
    });
  }

  // Sign out link
  const signOutLink = document.querySelector('#sign-out-link') || document.querySelector('a[onclick*="sessionStorage.removeItem"]');
  if (signOutLink) {
    signOutLink.removeAttribute('onclick');
    signOutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await supabase.auth.signOut();
      } catch (err) { }
      sessionStorage.removeItem('firs_user');
      window.location.replace('../index.html');
    });
  }
}



/* ==========================================================
   Auto-Refresh (every 30 seconds)
   ========================================================== */

function startAutoRefresh() {
  refreshTimer = setInterval(async () => {
    issues = await loadIssues();
    renderKPIs();
    renderCurrentView();
    updateHITLBadge();
  }, 30000);
}

/* ---------- Init ---------- */
await initDashboard();
