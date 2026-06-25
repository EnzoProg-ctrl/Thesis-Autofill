/* ============================================================
   HITL (Human-in-the-Loop) Validation — JS Module
   ============================================================ */

import { checkAuth } from './auth-guard.js';
import { loadIssues, updateIssue, showToast, formatRelativeTime, escapeHtml, openCreateUserModal, openEditAdminProfileModal } from './shared.js';
import { CATEGORIES, TENANTS, getTenantById, getCategoryLabel, getCategoryIcon, getPriorityInfo } from './mock-data.js';

/* ---------- Auth Guard ---------- */
if (!checkAuth('admin')) {
  throw new Error('Not authenticated');
}

/* ---------- Current User ---------- */
let currentUser = null;
try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch(e) { /* ignore */ }

/* ---------- State ---------- */
let allIssues = [];
let unvalidated = [];
let currentCardIndex = 0;

/* ---------- DOM refs ---------- */
const reviewContainer = document.getElementById('review-cards');
const queueCountEl    = document.getElementById('queue-count');
const sidebarBadgeEl  = document.getElementById('sidebar-badge');

// Stats
const statTotalEl      = document.getElementById('stat-total');
const statAgreementEl  = document.getElementById('stat-agreement');
const statOverriddenEl = document.getElementById('stat-overridden-cat');
const statAvgConfEl    = document.getElementById('stat-avg-conf');
const statTodayEl      = document.getElementById('stat-today');

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  applyRBAC();
  initSidebarToggle();
  
  // Manage Users link listener
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

  refresh();
});

/* ---------- Refresh all data ---------- */
function refresh() {
  allIssues = loadIssues();
  unvalidated = allIssues.filter(i => i.validated === false);
  renderCards();
  updateStats();
  updateBadge();
}

/* ---------- Render review cards ---------- */
function renderCards() {
  queueCountEl.textContent = unvalidated.length;

  if (unvalidated.length === 0) {
    reviewContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">✅</div>
        <div class="empty-state-title">All Caught Up!</div>
        <div class="empty-state-text">No issues awaiting validation. Great work!</div>
      </div>
    `;
    return;
  }

  reviewContainer.innerHTML = unvalidated.map((issue, idx) => {
    const tenant = getTenantById(issue.tenantId);
    const tenantName    = tenant ? escapeHtml(tenant.name) : escapeHtml(issue.storeName || 'Unknown Tenant');
    const tenantFloor   = tenant ? tenant.floor : '—';
    const tenantZone    = tenant ? tenant.zone : '';
    const tenantContact = tenant ? (tenant.contact || '') : (issue.contactPerson || '');
    const tenantPhone   = tenant ? (tenant.phone || '') : (issue.phoneNumber || '');
    const submittedAgo  = formatRelativeTime(issue.submittedAt);

    const aiCatLabel  = getCategoryLabel(issue.aiCategory);
    const aiCatIcon   = getCategoryIcon(issue.aiCategory);
    const aiPriInfo   = getPriorityInfo(issue.aiPriorityLevel);
    const confidence  = issue.aiConfidence || 0;
    const confLevel   = confidence >= 85 ? 'high' : confidence >= 65 ? 'medium' : 'low';
    const priorityScore = issue.aiPriority || 0;

    // Generate reasoning from AI analysis data
    const aiReasoning = generateReasoning(issue);

    // Category dropdown options
    const catOptions = CATEGORIES.map(c =>
      `<option value="${c.id}" ${c.id === issue.aiCategory ? 'selected' : ''}>${c.icon} ${c.label}</option>`
    ).join('');

    // Priority segmented control
    const priorityLevels = ['critical', 'high', 'medium', 'low'];
    const priorityButtons = priorityLevels.map(lvl => {
      const info = getPriorityInfo(lvl);
      const isActive = lvl === issue.aiPriorityLevel ? 'active' : '';
      return `<button type="button" class="priority-seg-btn ${isActive}" data-priority="${lvl}" data-issue="${issue.id}">${info.label}</button>`;
    }).join('');

    // Build tenant meta string
    let tenantMetaStr = '';
    if (tenant) {
      tenantMetaStr = `📍 ${tenantFloor}${tenantZone ? ', Zone ' + tenantZone : ''}`;
    } else {
      const parts = [];
      if (tenantContact) parts.push(escapeHtml(tenantContact));
      if (tenantPhone) parts.push(escapeHtml(tenantPhone));
      tenantMetaStr = parts.length > 0 ? '👤 ' + parts.join(' • ') : '';
    }

    return `
      <div class="hitl-card" id="card-${issue.id}" data-issue-id="${issue.id}">
        <div class="hitl-card-header">
          <span class="issue-id">${escapeHtml(issue.id)}</span>
          <span class="badge badge-warning">Awaiting Validation</span>
        </div>
        <div class="hitl-card-body">

          <!-- Tenant Info -->
          <div class="hitl-card-section">
            <div class="section-label">Tenant Info</div>
            <div class="tenant-row">
              <span class="tenant-name">${tenantName}</span>
              <span class="tenant-meta">${tenantMetaStr}</span>
              <span class="tenant-meta">🕐 ${submittedAgo}</span>
            </div>
          </div>

          <!-- Original Text -->
          <div class="hitl-card-section">
            <div class="section-label">Original Report (${escapeHtml(issue.aiLanguage || 'Taglish')})</div>
            <div class="hitl-original-text">${escapeHtml(issue.text)}</div>
          </div>

          <!-- AI Analysis -->
          <div class="hitl-card-section">
            <div class="section-label">AI Analysis</div>
            <div class="ai-detail-row">
              <div class="ai-detail-item">
                <div class="detail-label">AI Suggested Category</div>
                <span class="priority-badge ${issue.aiPriorityLevel}" style="margin-bottom:var(--sp-2);">${aiCatIcon} ${aiCatLabel}</span>
                <div class="confidence-bar mt-2">
                  <div class="confidence-bar-fill ${confLevel}" style="width:${confidence}%"></div>
                </div>
                <div class="text-xs text-muted mt-1">${confidence}% confidence</div>
              </div>
              <div class="ai-detail-item">
                <div class="detail-label">AI Priority Score</div>
                <div class="priority-gauge">
                  <div class="priority-gauge-bar">
                    <div class="priority-gauge-fill" style="width:${priorityScore}%; background:${aiPriInfo.color}"></div>
                  </div>
                  <span class="priority-gauge-label" style="color:${aiPriInfo.color}">${priorityScore}</span>
                </div>
                <div class="text-xs mt-1">
                  <span class="priority-badge ${issue.aiPriorityLevel}">${aiPriInfo.label}</span>
                </div>
              </div>
            </div>
            <div class="ai-reasoning">${aiReasoning}</div>
          </div>

          <!-- Expert Override Controls -->
          <div class="hitl-card-section">
            <div class="section-label">Expert Override Controls</div>
            <div class="override-grid">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label" for="cat-${issue.id}">Category</label>
                <select class="form-select" id="cat-${issue.id}" data-issue="${issue.id}">
                  ${catOptions}
                </select>
              </div>
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Priority Level</label>
                <div class="priority-segmented" id="priority-seg-${issue.id}">
                  ${priorityButtons}
                </div>
              </div>
            </div>
            <div class="form-group mt-4" style="margin-bottom:0">
              <label class="form-label" for="notes-${issue.id}">Notes <span class="text-muted font-medium">(optional — override justification)</span></label>
              <textarea class="form-textarea" id="notes-${issue.id}" rows="2" style="min-height:60px" placeholder="Reason for override..."></textarea>
            </div>
          </div>

        </div>

        <!-- Card Actions -->
        <div class="hitl-actions">
          <button class="btn btn-success" data-action="agree" data-issue="${issue.id}">✓ Agree with AI</button>
          <button class="btn btn-primary" data-action="override" data-issue="${issue.id}">Override &amp; Validate</button>
          <button class="btn btn-ghost" data-action="skip" data-issue="${issue.id}" data-idx="${idx}">Skip</button>
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners
  attachCardListeners();
}


/* ---------- AI Reasoning generator ---------- */
function generateReasoning(issue) {
  const catLabel = getCategoryLabel(issue.aiCategory);
  const priInfo  = getPriorityInfo(issue.aiPriorityLevel);
  const conf = issue.aiConfidence || 0;

  let reasoning = `The model classified this as <strong>${catLabel}</strong> with ${conf}% confidence. `;

  if (conf >= 90) {
    reasoning += `High-confidence match based on strong keyword signals in the report text. `;
  } else if (conf >= 75) {
    reasoning += `Moderate-to-high confidence — primary category keywords detected with some ambiguity. `;
  } else {
    reasoning += `Lower confidence — the description may span multiple categories. Expert review recommended. `;
  }

  reasoning += `Priority assessed as <strong>${priInfo.label}</strong> (score ${issue.aiPriority}/100)`;

  if (issue.selfAssessment === 'urgent') {
    reasoning += `, factoring in the tenant's self-assessed urgency.`;
  } else {
    reasoning += ` based on contextual severity indicators.`;
  }

  return reasoning;
}


/* ---------- Attach card event listeners ---------- */
function attachCardListeners() {
  // Priority segmented buttons
  document.querySelectorAll('.priority-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const issueId = btn.dataset.issue;
      const segmented = document.getElementById(`priority-seg-${issueId}`);
      segmented.querySelectorAll('.priority-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Action buttons
  document.querySelectorAll('[data-action="agree"]').forEach(btn => {
    btn.addEventListener('click', () => handleAgree(btn.dataset.issue));
  });

  document.querySelectorAll('[data-action="override"]').forEach(btn => {
    btn.addEventListener('click', () => handleOverride(btn.dataset.issue));
  });

  document.querySelectorAll('[data-action="skip"]').forEach(btn => {
    btn.addEventListener('click', () => handleSkip(btn.dataset.issue, parseInt(btn.dataset.idx)));
  });
}


/* ---------- Agree with AI ---------- */
function handleAgree(issueId) {
  const issue = allIssues.find(i => i.id === issueId);
  if (!issue) return;

  updateIssue(issueId, {
    validated: true,
    validatedBy: 'Admin',
    validatedAt: new Date().toISOString(),
    overridden: false,
  });

  animateCardOut(issueId, () => {
    showToast(`✓ ${issueId} validated — AI classification agreed`, 'success');
    refresh();
  });
}


/* ---------- Override & Validate ---------- */
function handleOverride(issueId) {
  const issue = allIssues.find(i => i.id === issueId);
  if (!issue) return;

  const catSelect = document.getElementById(`cat-${issueId}`);
  const newCategory = catSelect.value;

  const segmented = document.getElementById(`priority-seg-${issueId}`);
  const activeBtn = segmented.querySelector('.priority-seg-btn.active');
  const newPriority = activeBtn ? activeBtn.dataset.priority : issue.aiPriorityLevel;

  const notesEl = document.getElementById(`notes-${issueId}`);
  const notes = notesEl ? notesEl.value.trim() : '';

  const wasOverridden = (newCategory !== issue.aiCategory) || (newPriority !== issue.aiPriorityLevel);

  updateIssue(issueId, {
    validated: true,
    validatedBy: 'Admin',
    validatedAt: new Date().toISOString(),
    overridden: wasOverridden,
    overrideNotes: notes || null,
    // Update the actual category/priority if overridden
    category: newCategory,
    aiPriorityLevel: newPriority,
  });

  animateCardOut(issueId, () => {
    if (wasOverridden) {
      showToast(`⚡ ${issueId} validated with expert override`, 'info');
    } else {
      showToast(`✓ ${issueId} validated — matches AI classification`, 'success');
    }
    refresh();
  });
}


/* ---------- Skip ---------- */
function handleSkip(issueId, idx) {
  const card = document.getElementById(`card-${issueId}`);
  if (!card) return;

  // Scroll to next card or show toast if last
  const nextCard = card.nextElementSibling;
  if (nextCard && nextCard.classList.contains('hitl-card')) {
    nextCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else {
    // Wrap around to the first card
    const firstCard = reviewContainer.querySelector('.hitl-card');
    if (firstCard && firstCard.id !== `card-${issueId}`) {
      firstCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  showToast('Skipped — moved to next issue', 'warning');
}


/* ---------- Card animation ---------- */
function animateCardOut(issueId, callback) {
  const card = document.getElementById(`card-${issueId}`);
  if (!card) {
    callback();
    return;
  }
  card.style.transition = 'all 0.3s ease';
  card.style.opacity = '0';
  card.style.transform = 'translateX(-30px)';
  card.style.maxHeight = card.offsetHeight + 'px';
  card.style.overflow = 'hidden';
  setTimeout(() => {
    card.style.maxHeight = '0';
    card.style.padding = '0';
    card.style.margin = '0';
    card.style.borderWidth = '0';
  }, 200);
  setTimeout(callback, 400);
}


/* ---------- Update validation statistics ---------- */
function updateStats() {
  allIssues = loadIssues();
  const validated = allIssues.filter(i => i.validated === true);
  const totalValidated = validated.length;

  // Total validated
  statTotalEl.textContent = totalValidated;

  // AI agreement rate: validated issues where overridden is not true
  if (totalValidated > 0) {
    const agreed = validated.filter(i => !i.overridden).length;
    const rate = Math.round((agreed / totalValidated) * 100);
    statAgreementEl.textContent = rate + '%';
  } else {
    statAgreementEl.textContent = '—';
  }

  // Most overridden category
  const overridden = validated.filter(i => i.overridden === true);
  if (overridden.length > 0) {
    const catCounts = {};
    overridden.forEach(i => {
      const cat = i.aiCategory || 'other';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
    });
    const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0];
    statOverriddenEl.textContent = getCategoryLabel(topCat[0]);
  } else {
    statOverriddenEl.textContent = '—';
  }

  // Avg confidence of overrides
  if (overridden.length > 0) {
    const totalConf = overridden.reduce((sum, i) => sum + (i.aiConfidence || 0), 0);
    statAvgConfEl.textContent = Math.round(totalConf / overridden.length) + '%';
  } else {
    statAvgConfEl.textContent = '—';
  }

  // Today's validations
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = validated.filter(i => {
    const vDate = i.validatedAt || i.updatedAt || '';
    return vDate.slice(0, 10) === today;
  }).length;
  statTodayEl.textContent = todayCount;
}


/* ---------- Sidebar badge ---------- */
function updateBadge() {
  const count = unvalidated.length;
  sidebarBadgeEl.textContent = count;
  sidebarBadgeEl.style.display = count > 0 ? '' : 'none';
}


/* ---------- Mobile sidebar toggle ---------- */
function initSidebarToggle() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) &&
          !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }
}

function applyRBAC() {
  if (!currentUser) return;

  if (currentUser.role === 'staff') {
    const manageUsersLink = document.getElementById('manage-users-link');
    if (manageUsersLink) manageUsersLink.classList.add('hidden');

    const analyticsLink = document.querySelector('a[href="analytics.html"]');
    if (analyticsLink) analyticsLink.classList.add('hidden');
  }
}
