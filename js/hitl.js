/* ============================================================
   HITL (Human-in-the-Loop) Validation — JS Module
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { loadIssues, loadIssueImage, loadIssueIdsWithImages, updateIssue, renderTopbarUser, initSidebarToggle, initImageLightbox, showToast, formatRelativeTime, escapeHtml, priorityProvenanceNote, openCreateUserModal, openEditAdminProfileModal } from './shared.js';
import { CATEGORIES, getCategoryLabel, getCategoryIcon, getPriorityInfo, getUsers } from './app-data.js';

/* ---------- Auth Guard ---------- */
if (!(await checkAuth('admin'))) {
  throw new Error('Not authenticated');
}

/* ---------- Current User ---------- */
let currentUser = null;
try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }

/* ---------- State ---------- */
let allIssues = [];
let unvalidated = [];
let issuesWithImages = new Set();   // ids that have a photo, without fetching any
let currentCardIndex = 0;

/* ---------- DOM refs ---------- */
const reviewContainer = document.getElementById('review-cards');
const queueCountEl = document.getElementById('queue-count');
const sidebarBadgeEl = document.getElementById('sidebar-badge');

// Stats
const statTotalEl = document.getElementById('stat-total');
const statAgreementEl = document.getElementById('stat-agreement');
const statOverriddenEl = document.getElementById('stat-overridden-cat');
const statAvgConfEl = document.getElementById('stat-avg-conf');
const statTodayEl = document.getElementById('stat-today');

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  applyRBAC();
  initSidebarToggle();
  initImageLightbox();
  renderTopbarUser();

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

  // Sign out link
  const signOutLink = document.querySelector('#sign-out-link') || document.querySelector('a[onclick*="sessionStorage.removeItem"]');
  if (signOutLink) {
    signOutLink.removeAttribute('onclick');
    signOutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await supabase.auth.signOut(); } catch (err) {}
      sessionStorage.removeItem('firs_user');
      window.location.replace('../index.html');
    });
  }

  await refresh();
});

/* ---------- Refresh all data ---------- */
async function refresh() {
  allIssues = await loadIssues();
  // ids only — tells the cards which reports have a photo to offer, without
  // pulling any photo data into the queue.
  try {
    issuesWithImages = await loadIssueIdsWithImages();
  } catch (err) {
    console.error('Image index load error:', err);
  }
  unvalidated = allIssues.filter(i => i.validated === false && i.status !== 'resolved');
  renderCards();
  updateStats();
  updateBadge();
}

/* One delegated handler for every "View photo" button in the queue. Fetches
   that single report's photo, swaps the button for the image, and lets the
   existing lightbox take over from there. */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-load-photo]');
  if (!btn) return;
  const id = btn.dataset.loadPhoto;
  const slot = document.querySelector(`[data-photo-slot="${CSS.escape(id)}"]`);
  btn.disabled = true;
  btn.textContent = 'Loading…';
  const src = await loadIssueImage(id);
  if (!slot) return;
  if (src) {
    slot.innerHTML = `<img src="${src}" alt="Issue photo" data-lightbox title="Click to enlarge" style="max-width:100%; margin-top:var(--sp-2); border-radius:var(--radius-md); border:1px solid var(--gray-200); cursor:zoom-in;">`;
    btn.remove();
  } else {
    btn.textContent = 'Photo unavailable';
  }
});

/* ---------- Render review cards ---------- */
function renderCards() {
  queueCountEl.textContent = unvalidated.length;

  if (unvalidated.length === 0) {
    reviewContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon" style="color:var(--success-600)"><svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
        <div class="empty-state-title">All Caught Up!</div>
        <div class="empty-state-text">No issues awaiting validation. Great work!</div>
      </div>
    `;
    return;
  }

  reviewContainer.innerHTML = unvalidated.map((issue, idx) => {
    const tenantName = escapeHtml(issue.storeName || 'Unknown Tenant');
    const tenantContact = issue.contactPerson || '';
    const tenantPhone = issue.phoneNumber || '';
    const submittedAgo = formatRelativeTime(issue.submittedAt);

    const aiCatLabel = getCategoryLabel(issue.aiCategory);
    const aiCatIcon = getCategoryIcon(issue.aiCategory);
    const aiPriInfo = getPriorityInfo(issue.aiPriorityLevel);
    const confidence = issue.aiConfidence || 0;
    const confLevel = confidence >= 85 ? 'high' : confidence >= 65 ? 'medium' : 'low';
    const priorityScore = issue.aiPriority || 0;

    // Generate reasoning from AI analysis data
    const aiReasoning = generateReasoning(issue);

    // Category dropdown options
    const catOptions = CATEGORIES.map(c =>
      `<option value="${c.id}" ${c.id === issue.aiCategory ? 'selected' : ''}>${c.label}</option>`
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
    const parts = [];
    if (tenantContact) parts.push(escapeHtml(tenantContact));
    if (tenantPhone) parts.push(escapeHtml(tenantPhone));
    tenantMetaStr = parts.length > 0 ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>` + parts.join(' • ') : '';

    return `
      <div class="hitl-card" id="card-${issue.id}" data-issue-id="${issue.id}">
        <div class="hitl-card-header">
          <span class="issue-id">${escapeHtml(issue.ticketNumber || issue.id)}</span>
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
            ${issue.textEditedAt ? `
            <div class="badge badge-warning" style="margin-bottom:var(--sp-2);">
              Edited by tenant ${formatRelativeTime(issue.textEditedAt)} — re-classified, needs review again
            </div>` : ''}
            <div class="hitl-original-text">${escapeHtml(issue.text)}</div>
          </div>

          ${issuesWithImages.has(issue.id) ? `
          <!-- Attached Photo. This is a QUEUE, so the photos are loaded one at
               a time on request rather than inlined into every card — the list
               query no longer carries any image data at all. -->
          <div class="hitl-card-section">
            <div class="section-label">Attached Photo</div>
            <button type="button" class="btn btn-secondary btn-sm" data-load-photo="${escapeHtml(issue.id)}">
              View photo
            </button>
            <div class="photo-slot" data-photo-slot="${escapeHtml(issue.id)}"></div>
          </div>
          ` : ''}

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
                <div class="detail-label" title="Weighted across all four priority levels. Diagnostic only — the priority badge is the operational level.">AI Severity Index</div>
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


/* ---------- AI Reasoning generator ----------

   What the reviewer is told about how this report was triaged.

   The previous version of this function described a keyword matcher — "strong
   keyword signals in the report text", "primary category keywords detected" —
   for a classifier that is an XLM-RoBERTa transformer and reads no keyword
   lists at all. It also invented its confidence narrative rather than reading
   anything, and branched on issue.selfAssessment, a field the tenant form
   stopped sending. Every sentence it produced was decoration.

   This version states only what is recorded on the row, and says the things a
   reviewer needs in order to distrust the answer in front of them:

     * the priority may not be the MODEL'S priority. The deterministic safety
       floor can raise Low to High on a danger word alone, and a reviewer
       looking at "High" cannot otherwise tell that the model said Low.
     * the model may not have run AT ALL. When the inference service is
       unreachable the keyword fallback triages the report, and that path is
       markedly worse on Taglish. It looks identical on screen.
     * a human may have been here already, on a re-validation.

   All three were being written to the database on every submission and shown
   to nobody. */
function generateReasoning(issue) {
  /* getCategoryLabel falls back to the raw id for ids it does not recognise,
     and ai_category is a column the tenant's own session can write. Escape it
     rather than trusting that the id came from the model. */
  const catLabel = escapeHtml(getCategoryLabel(issue.aiCategory));
  const priInfo = getPriorityInfo(issue.aiPriorityLevel);
  const conf = issue.aiConfidence || 0;
  const source = issue.aiPrioritySource;

  const parts = [];

  /* ---- Category ---- */
  parts.push(`Classified as <strong>${catLabel}</strong> at ${conf}% confidence.`);

  if (conf >= 85) {
    parts.push('Clear separation from the other categories.');
  } else if (conf >= 65) {
    parts.push('Moderate confidence — the runner-up was not far behind.');
  } else {
    parts.push('<strong>Low confidence</strong> — the wording may not resemble anything in the training data. Worth a careful look.');
  }

  /* The tenant picked a category too. Disagreement is not an error on either
     side, but it is the cheapest signal that something is ambiguous. */
  if (issue.category && issue.aiCategory && issue.category !== issue.aiCategory) {
    parts.push(`The tenant filed this under <strong>${escapeHtml(getCategoryLabel(issue.category))}</strong>, which disagrees with the model.`);
  }

  /* ---- Priority, and who actually decided it ----
     The floored and keyword-fallback wordings live in shared.js so the admin
     detail panel says the same thing; only the plain model case is phrased
     here, because it is the one the panel states in its own layout. */
  if (source !== 'safety_floor' && source !== 'keyword') {
    /* Attribute to the model only when the row actually says so. NULL means
       the report predates migration_002_ai_provenance and nothing recorded
       which path scored it — claiming the model did would be a guess. */
    parts.push(
      `Priority assessed as <strong>${priInfo.label}</strong> `
      + `(severity index ${issue.aiPriority}/100)`
      + (source === 'model' ? ' by the model, read from the description.' : '.')
    );
  }

  const provenance = priorityProvenanceNote(issue);
  if (provenance) parts.push(provenance);

  /* ---- A human has already changed this once ---- */
  if (issue.preOverridePriorityLevel) {
    parts.push(
      `A reviewer previously changed the priority from `
      + `<strong>${getPriorityInfo(issue.preOverridePriorityLevel).label}</strong> to the level shown.`
    );
  }

  return parts.join(' ');
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


/* Every validation is signed. validated_by is a uuid with a foreign key to
   profiles, so the old fallback — the literal string 'Admin' when currentUser
   was missing — could never be stored: Postgres rejects it, updateIssue
   throws, and the reviewer sees the button do nothing at all. Refuse up front
   and say why instead. */
function reviewerId() {
  if (currentUser && currentUser.id) return currentUser.id;
  showToast('Your session has expired. Sign in again to validate reports.', 'error');
  return null;
}


/* ---------- Agree with AI ---------- */
async function handleAgree(issueId) {
  const issue = allIssues.find(i => i.id === issueId);
  if (!issue) return;

  const reviewer = reviewerId();
  if (!reviewer) return;

  try {
    await updateIssue(issueId, {
      validated: true,
      validatedBy: reviewer,
      validatedAt: new Date().toISOString(),
      overridden: false,
    });
  } catch (err) {
    // Without this the card simply stayed put and nothing was said.
    showToast(`Could not save validation: ${err.message}`, 'error');
    return;
  }

  animateCardOut(issueId, () => {
    showToast(`✓ ${issue.ticketNumber || issueId} validated — AI classification agreed`, 'success');
    refresh();
  });
}


/* ---------- Override & Validate ---------- */
async function handleOverride(issueId) {
  const issue = allIssues.find(i => i.id === issueId);
  if (!issue) return;

  const catSelect = document.getElementById(`cat-${issueId}`);
  const newCategory = catSelect.value;

  const segmented = document.getElementById(`priority-seg-${issueId}`);
  const activeBtn = segmented.querySelector('.priority-seg-btn.active');
  const newPriority = activeBtn ? activeBtn.dataset.priority : issue.aiPriorityLevel;

  const notesEl = document.getElementById(`notes-${issueId}`);
  const notes = notesEl ? notesEl.value.trim() : '';

  const reviewer = reviewerId();
  if (!reviewer) return;

  const wasOverridden = (newCategory !== issue.aiCategory) || (newPriority !== issue.aiPriorityLevel);
  const priorityChanged = newPriority !== issue.aiPriorityLevel;

  const patch = {
    validated: true,
    validatedBy: reviewer,
    validatedAt: new Date().toISOString(),
    overridden: wasOverridden,
    overrideNotes: notes || null,
    // Update the actual category/priority if overridden
    category: newCategory,
    aiPriorityLevel: newPriority,
  };

  /* Keep the model's own priority before overwriting it.
     Without this the reviewer's answer replaced the model's and there was no
     way left to ask how often, or in which direction, reviewers disagree —
     the one measurement a human-in-the-loop design exists to produce. The
     deterministic safety floor already preserves its pre-override value in
     ai_model_priority; this is the human equivalent.
     Written only when the priority actually changed, and only if it has not
     been recorded before, so re-validating a report cannot overwrite the
     original model prediction with an earlier reviewer's correction.
     ai_priority_score is untouched by overrides, so it still carries the
     model's original score. */
  if (priorityChanged && !issue.preOverridePriorityLevel) {
    patch.preOverridePriorityLevel = issue.aiPriorityLevel;
  }

  try {
    await updateIssue(issueId, patch);
  } catch (err) {
    showToast(`Could not save override: ${err.message}`, 'error');
    return;
  }

  animateCardOut(issueId, () => {
    if (wasOverridden) {
      showToast(`${issue.ticketNumber || issueId} validated with expert override`, 'info');
    } else {
      showToast(`✓ ${issue.ticketNumber || issueId} validated — matches AI classification`, 'success');
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
async function updateStats() {
  allIssues = await loadIssues();
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
function applyRBAC() {
  if (!currentUser) return;

  if (currentUser.role === 'staff') {
    const manageUsersLink = document.getElementById('manage-users-link');
    if (manageUsersLink) manageUsersLink.classList.add('hidden');

    const analyticsLink = document.querySelector('a[href="analytics.html"]');
    if (analyticsLink) analyticsLink.classList.add('hidden');
  }
}
