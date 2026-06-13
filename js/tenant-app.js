/* ============================================================
   Tenant Portal — Report Form Logic
   ============================================================ */

import { TENANTS, CATEGORIES, getTenantById, getCategoryLabel, getCategoryIcon, getStatusInfo } from './mock-data.js';
import { loadIssues, addIssue, generateId, formatRelativeTime, showModal, closeModal, showToast, escapeHtml, debounce } from './shared.js';
import { analyzeText } from './mock-bert.js';

/* ---------- DOM References ---------- */
const tenantSearchInput   = document.getElementById('tenantSearch');
const tenantDropdown      = document.getElementById('tenantDropdown');
const tenantIdInput       = document.getElementById('tenantId');
const tenantError         = document.getElementById('tenantError');
const contactPersonInput  = document.getElementById('contactPerson');
const phoneNumberInput    = document.getElementById('phoneNumber');
const categorySelect      = document.getElementById('categorySelect');
const categoryError       = document.getElementById('categoryError');
const descriptionText     = document.getElementById('descriptionText');
const charCounter         = document.getElementById('charCounter');
const descriptionError    = document.getElementById('descriptionError');
const urgencyToggle       = document.getElementById('urgencyToggle');
const fileDropZone        = document.getElementById('fileDropZone');
const fileInput           = document.getElementById('fileInput');
const filePreview         = document.getElementById('filePreview');
const previewThumb        = document.getElementById('previewThumb');
const previewName         = document.getElementById('previewName');
const previewSize         = document.getElementById('previewSize');
const fileRemove          = document.getElementById('fileRemove');
const reportForm          = document.getElementById('reportForm');
const recentToggle        = document.getElementById('recentToggle');
const recentArrow         = document.getElementById('recentArrow');
const recentList          = document.getElementById('recentList');

/* ---------- State ---------- */
let selectedTenantId = '';
let selectedUrgency  = 'medium';
let selectedFile     = null;
let recentOpen       = false;


/* ==========================================================
   1. Searchable Tenant Dropdown
   ========================================================== */

function renderTenantDropdown(filter = '') {
  const lowerFilter = filter.toLowerCase().trim();
  const filtered = lowerFilter
    ? TENANTS.filter(t =>
        t.name.toLowerCase().includes(lowerFilter) ||
        t.id.toLowerCase().includes(lowerFilter) ||
        t.type.toLowerCase().includes(lowerFilter) ||
        t.floor.toLowerCase().includes(lowerFilter)
      )
    : TENANTS;

  if (filtered.length === 0) {
    tenantDropdown.innerHTML = '<div class="search-dropdown-item" style="color:var(--gray-400);cursor:default;">No tenants found</div>';
  } else {
    tenantDropdown.innerHTML = filtered.map(t => `
      <div class="search-dropdown-item ${t.id === selectedTenantId ? 'selected' : ''}" data-id="${t.id}">
        <div>${escapeHtml(t.name)}</div>
        <div class="item-sub">${t.floor}, Zone ${t.zone} · ${escapeHtml(t.type)}</div>
      </div>
    `).join('');
  }

  tenantDropdown.classList.add('open');
}

function selectTenant(tenantId) {
  const tenant = getTenantById(tenantId);
  if (!tenant) return;

  selectedTenantId = tenant.id;
  tenantIdInput.value = tenant.id;
  tenantSearchInput.value = tenant.name;
  contactPersonInput.value = tenant.contact;
  phoneNumberInput.value = tenant.phone;
  tenantDropdown.classList.remove('open');
  tenantError.classList.add('hidden');
  tenantSearchInput.classList.remove('error');

  // Refresh recent submissions for this tenant
  renderRecentSubmissions();
}

tenantSearchInput.addEventListener('focus', () => {
  renderTenantDropdown(tenantSearchInput.value);
});

tenantSearchInput.addEventListener('input', debounce(() => {
  selectedTenantId = '';
  tenantIdInput.value = '';
  contactPersonInput.value = '';
  phoneNumberInput.value = '';
  renderTenantDropdown(tenantSearchInput.value);
}, 150));

tenantDropdown.addEventListener('click', (e) => {
  const item = e.target.closest('.search-dropdown-item');
  if (item && item.dataset.id) {
    selectTenant(item.dataset.id);
  }
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-select-wrapper')) {
    tenantDropdown.classList.remove('open');
  }
});


/* ==========================================================
   2. Category Dropdown
   ========================================================== */

function populateCategories() {
  CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = `${cat.icon}  ${cat.label}`;
    categorySelect.appendChild(opt);
  });
}

populateCategories();

categorySelect.addEventListener('change', () => {
  categoryError.classList.add('hidden');
  categorySelect.classList.remove('error');
});


/* ==========================================================
   3. Character Counter
   ========================================================== */

function updateCharCounter() {
  const len = descriptionText.value.length;
  charCounter.textContent = `${len.toLocaleString()} / 1,000`;

  charCounter.classList.remove('warning', 'limit');
  if (len >= 1000) {
    charCounter.classList.add('limit');
  } else if (len >= 800) {
    charCounter.classList.add('warning');
  }
}

descriptionText.addEventListener('input', () => {
  updateCharCounter();
  if (descriptionText.value.trim().length >= 10) {
    descriptionError.classList.add('hidden');
    descriptionText.classList.remove('error');
  }
});


/* ==========================================================
   4. Urgency Toggle
   ========================================================== */

urgencyToggle.addEventListener('click', (e) => {
  const option = e.target.closest('.urgency-option');
  if (!option) return;

  urgencyToggle.querySelectorAll('.urgency-option').forEach(o => o.classList.remove('active'));
  option.classList.add('active');
  selectedUrgency = option.dataset.value;
});


/* ==========================================================
   5. File Upload (Click + Drag-and-Drop)
   ========================================================== */

fileDropZone.addEventListener('click', () => fileInput.click());

fileDropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  fileDropZone.classList.add('drag-over');
});

fileDropZone.addEventListener('dragleave', () => {
  fileDropZone.classList.remove('drag-over');
});

fileDropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  fileDropZone.classList.remove('drag-over');
  const files = e.dataTransfer.files;
  if (files.length > 0) handleFile(files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please upload an image file.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File size must be under 10 MB.', 'error');
    return;
  }

  selectedFile = file;

  // Build thumbnail
  const reader = new FileReader();
  reader.onload = (e) => {
    previewThumb.src = e.target.result;
  };
  reader.readAsDataURL(file);

  previewName.textContent = file.name;
  previewSize.textContent = formatFileSize(file.size);

  fileDropZone.classList.add('hidden');
  filePreview.classList.remove('hidden');
}

fileRemove.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  previewThumb.src = '';
  previewName.textContent = '';
  previewSize.textContent = '';
  filePreview.classList.add('hidden');
  fileDropZone.classList.remove('hidden');
});

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}


/* ==========================================================
   6. Form Validation
   ========================================================== */

function validateForm() {
  let valid = true;

  // Tenant
  if (!selectedTenantId) {
    tenantError.classList.remove('hidden');
    tenantSearchInput.classList.add('error');
    valid = false;
  } else {
    tenantError.classList.add('hidden');
    tenantSearchInput.classList.remove('error');
  }

  // Category
  if (!categorySelect.value) {
    categoryError.classList.remove('hidden');
    categorySelect.classList.add('error');
    valid = false;
  } else {
    categoryError.classList.add('hidden');
    categorySelect.classList.remove('error');
  }

  // Description
  if (descriptionText.value.trim().length < 10) {
    descriptionError.classList.remove('hidden');
    descriptionText.classList.add('error');
    valid = false;
  } else {
    descriptionError.classList.add('hidden');
    descriptionText.classList.remove('error');
  }

  return valid;
}


/* ==========================================================
   7. Submit Flow
   ========================================================== */

reportForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (!validateForm()) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  // Show processing modal
  const overlay = showModal('Processing Report', `
    <div class="processing-overlay">
      <div class="spinner spinner-lg"></div>
      <div class="processing-title">Analyzing your report...</div>
      <div class="processing-text">Analyzing your report with BERT AI...</div>
    </div>
  `);

  // Prevent closing during processing
  const modalEl = overlay.querySelector('.modal');
  const closeBtn = overlay.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  overlay.onclick = null;

  try {
    // Run BERT analysis
    const aiResult = await analyzeText(
      descriptionText.value.trim(),
      categorySelect.value,
      selectedUrgency
    );

    const issueId = generateId();
    const now = new Date().toISOString();

    // Build the issue object
    const issue = {
      id: issueId,
      tenantId: selectedTenantId,
      category: categorySelect.value,
      selfAssessment: selectedUrgency,
      status: 'awaiting_review',
      assignedTo: null,
      text: descriptionText.value.trim(),
      aiCategory: aiResult.category,
      aiConfidence: aiResult.confidence,
      aiPriority: aiResult.priorityScore,
      aiPriorityLevel: aiResult.priorityLevel,
      aiLanguage: aiResult.language,
      validated: false,
      validatedBy: null,
      submittedAt: now,
      updatedAt: now,
    };

    // Save to localStorage
    addIssue(issue);

    // Determine estimated response time
    const responseTimeMap = {
      critical: '30 minutes – 1 hour',
      high: '1 – 4 hours',
      medium: '4 – 24 hours',
      low: '1 – 3 business days',
    };
    const estimatedResponse = responseTimeMap[aiResult.priorityLevel] || '4 – 24 hours';

    // Priority badge colors
    const priorityColorMap = {
      critical: 'priority-badge critical',
      high: 'priority-badge high',
      medium: 'priority-badge medium',
      low: 'priority-badge low',
    };
    const priorityBadgeClass = priorityColorMap[aiResult.priorityLevel] || 'priority-badge medium';

    // Confidence bar class
    let confBarClass = 'high';
    if (aiResult.confidence < 70) confBarClass = 'low';
    else if (aiResult.confidence < 85) confBarClass = 'medium';

    // Update modal with confirmation
    const modalBody = overlay.querySelector('.modal-body');
    modalBody.innerHTML = `
      <div style="text-align:center;margin-bottom:var(--sp-6);">
        <div style="font-size:40px;margin-bottom:var(--sp-2);">✅</div>
        <div style="font-size:var(--text-lg);font-weight:600;color:var(--gray-900);">Report Submitted Successfully</div>
        <div style="font-size:var(--text-sm);color:var(--gray-500);margin-top:var(--sp-1);">Your issue has been logged and sent for review.</div>
      </div>
      <div class="confirmation-detail">
        <span class="label">Issue ID</span>
        <span class="value" style="font-family:monospace;">${escapeHtml(issueId)}</span>
      </div>
      <div class="confirmation-detail">
        <span class="label">AI-Detected Category</span>
        <span class="value">${getCategoryIcon(aiResult.category)} ${escapeHtml(getCategoryLabel(aiResult.category))}</span>
      </div>
      <div class="confirmation-detail">
        <span class="label">AI Confidence</span>
        <span class="value">${aiResult.confidence}%</span>
      </div>
      <div class="confirmation-detail" style="border-bottom:none;padding-bottom:0;">
        <span class="label" style="align-self:center;">Confidence</span>
        <span class="value" style="flex:1;max-width:180px;">
          <div class="confidence-bar">
            <div class="confidence-bar-fill ${confBarClass}" style="width:${aiResult.confidence}%"></div>
          </div>
        </span>
      </div>
      <div class="confirmation-detail">
        <span class="label">Priority Level</span>
        <span class="value"><span class="${priorityBadgeClass}">${aiResult.priorityLevel.charAt(0).toUpperCase() + aiResult.priorityLevel.slice(1)}</span></span>
      </div>
      <div class="confirmation-detail">
        <span class="label">Detected Language</span>
        <span class="value">${escapeHtml(aiResult.language)}</span>
      </div>
      <div class="confirmation-detail">
        <span class="label">Est. Response Time</span>
        <span class="value">${estimatedResponse}</span>
      </div>
    `;

    // Re-show close button
    if (closeBtn) closeBtn.style.display = '';

    // Add footer with Submit Another button
    const modalHeader = overlay.querySelector('.modal-header h3');
    if (modalHeader) modalHeader.textContent = 'Report Confirmed';

    const modalContainer = overlay.querySelector('.modal');
    const existingFooter = modalContainer.querySelector('.modal-footer');
    if (existingFooter) existingFooter.remove();

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    footer.innerHTML = `
      <button class="btn btn-secondary" id="modalCloseBtn">Close</button>
      <button class="btn btn-primary" id="submitAnotherBtn">Submit Another</button>
    `;
    modalContainer.appendChild(footer);

    footer.querySelector('#modalCloseBtn').addEventListener('click', () => {
      closeModal();
    });

    footer.querySelector('#submitAnotherBtn').addEventListener('click', () => {
      closeModal();
      resetForm();
    });

    // Allow closing overlay again
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) closeModal();
    });

    // Refresh recent submissions
    renderRecentSubmissions();

    showToast('Issue report submitted successfully!', 'success');

  } catch (err) {
    closeModal();
    showToast('Something went wrong. Please try again.', 'error');
    console.error(err);
  }
});

function resetForm() {
  reportForm.reset();
  selectedTenantId = '';
  tenantIdInput.value = '';
  contactPersonInput.value = '';
  phoneNumberInput.value = '';
  selectedUrgency = 'medium';
  selectedFile = null;

  // Reset urgency toggle
  urgencyToggle.querySelectorAll('.urgency-option').forEach(o => o.classList.remove('active'));
  urgencyToggle.querySelector('[data-value="medium"]').classList.add('active');

  // Reset file preview
  filePreview.classList.add('hidden');
  fileDropZone.classList.remove('hidden');
  previewThumb.src = '';
  fileInput.value = '';

  // Reset char counter
  charCounter.textContent = '0 / 1,000';
  charCounter.classList.remove('warning', 'limit');

  // Clear errors
  tenantError.classList.add('hidden');
  categoryError.classList.add('hidden');
  descriptionError.classList.add('hidden');
  tenantSearchInput.classList.remove('error');
  categorySelect.classList.remove('error');
  descriptionText.classList.remove('error');
}


/* ==========================================================
   8. Recent Submissions
   ========================================================== */

function renderRecentSubmissions() {
  if (!selectedTenantId) {
    recentList.innerHTML = '<div class="empty-state" style="padding:var(--sp-6);"><div class="empty-state-text">Select a store to see recent submissions.</div></div>';
    return;
  }

  const issues = loadIssues();
  const tenantIssues = issues
    .filter(i => i.tenantId === selectedTenantId)
    .slice(0, 10);

  if (tenantIssues.length === 0) {
    recentList.innerHTML = '<div class="empty-state" style="padding:var(--sp-6);"><div class="empty-state-icon">📭</div><div class="empty-state-text">No submissions yet for this store.</div></div>';
    return;
  }

  recentList.innerHTML = tenantIssues.map(issue => {
    const statusInfo = getStatusInfo(issue.status);
    const truncatedText = issue.text.length > 100 ? issue.text.slice(0, 100) + '...' : issue.text;

    return `
      <div class="recent-item">
        <div class="recent-content">
          <div class="recent-id">${escapeHtml(issue.id)}</div>
          <div class="recent-text">${escapeHtml(truncatedText)}</div>
          <div class="recent-meta">
            <span class="status-badge" style="color:${statusInfo.color};">${escapeHtml(statusInfo.label)}</span>
            <span>${formatRelativeTime(issue.submittedAt)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

recentToggle.addEventListener('click', () => {
  recentOpen = !recentOpen;
  recentList.classList.toggle('hidden', !recentOpen);
  recentArrow.classList.toggle('open', recentOpen);

  if (recentOpen) {
    renderRecentSubmissions();
  }
});

// Initial render
renderRecentSubmissions();
