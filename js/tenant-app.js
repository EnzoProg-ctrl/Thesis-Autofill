/* ============================================================
   Tenant Portal — Report Form Logic (Refactored)
   ============================================================ */

import { TENANTS, CATEGORIES, getCategoryLabel, getCategoryIcon } from './mock-data.js';
import { loadIssues, addIssue, generateId, showModal, closeModal, showToast, escapeHtml } from './shared.js';
import { analyzeText } from './mock-bert.js';

/* ---------- DOM References ---------- */
const storeNameInput      = document.getElementById('storeName');
const storeNameError      = document.getElementById('storeNameError');
const contactPersonInput  = document.getElementById('contactPerson');
const phoneNumberInput    = document.getElementById('phoneNumber');
const categorySelect      = document.getElementById('categorySelect');
const categoryError       = document.getElementById('categoryError');
const descriptionText     = document.getElementById('descriptionText');
const charCounter         = document.getElementById('charCounter');
const descriptionError    = document.getElementById('descriptionError');
const fileDropZone        = document.getElementById('fileDropZone');
const fileInput           = document.getElementById('fileInput');
const filePreview         = document.getElementById('filePreview');
const previewThumb        = document.getElementById('previewThumb');
const previewName         = document.getElementById('previewName');
const previewSize         = document.getElementById('previewSize');
const fileRemove          = document.getElementById('fileRemove');
const reportForm          = document.getElementById('reportForm');

/* ---------- State ---------- */
let resolvedTenantId = null;
let selectedFile     = null;


/* ==========================================================
   1. Auto-Fill from Session
   ========================================================== */

function autoFillFromSession() {
  const raw = sessionStorage.getItem('firs_user');
  if (!raw) return;

  let user;
  try { user = JSON.parse(raw); } catch(e) { return; }

  const userEmail = (user.email || '').toLowerCase();

  // 1) Check if session already has a tenantId
  if (user.tenantId) {
    resolvedTenantId = user.tenantId;
  }

  // 2) Try matching registered tenants by exact email
  if (!resolvedTenantId) {
    const registered = JSON.parse(localStorage.getItem('firs_registered_tenants') || '[]');
    const regMatch = registered.find(t => t.email && t.email.toLowerCase() === userEmail);
    if (regMatch) {
      resolvedTenantId = regMatch.id;
      storeNameInput.value = regMatch.name || '';
      contactPersonInput.value = regMatch.contact || '';
      phoneNumberInput.value = regMatch.phone || '';
      return;
    }
  }

  // 3) Try matching built-in TENANTS by exact name
  if (!resolvedTenantId) {
    const sessionName = (user.storeName || user.name || '').toLowerCase();
    if (sessionName) {
      const builtIn = TENANTS.find(t => t.name.toLowerCase() === sessionName);
      if (builtIn) {
        resolvedTenantId = builtIn.id;
        storeNameInput.value = builtIn.name;
        contactPersonInput.value = builtIn.contact;
        phoneNumberInput.value = builtIn.phone;
        return;
      }
    }
  }

  // 4) Fallback: populate from session data if available
  storeNameInput.value = user.storeName || user.name || '';
  contactPersonInput.value = user.contact || '';
  phoneNumberInput.value = user.phone || '';
}

autoFillFromSession();


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
   4. File Upload (Click + Drag-and-Drop)
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
   5. Form Validation
   ========================================================== */

function validateForm() {
  let valid = true;

  // Store name
  if (!storeNameInput.value.trim()) {
    storeNameError.classList.remove('hidden');
    storeNameInput.classList.add('error');
    valid = false;
  } else {
    storeNameError.classList.add('hidden');
    storeNameInput.classList.remove('error');
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

// Clear errors on input
storeNameInput.addEventListener('input', () => {
  if (storeNameInput.value.trim()) {
    storeNameError.classList.add('hidden');
    storeNameInput.classList.remove('error');
  }
});


/* ==========================================================
   6. Submit Flow
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
      <div class="processing-text">Processing your description with BERT AI...</div>
    </div>
  `);

  // Prevent closing during processing
  const closeBtn = overlay.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  overlay.onclick = null;

  try {
    // Resolve the tenant ID from the store name if not already set
    let tenantId = resolvedTenantId;
    if (!tenantId) {
      // Try to find by the entered store name
      const enteredName = storeNameInput.value.trim().toLowerCase();
      const match = TENANTS.find(t => t.name.toLowerCase() === enteredName);
      if (match) {
        tenantId = match.id;
      } else {
        // Check registered tenants
        const registered = JSON.parse(localStorage.getItem('firs_registered_tenants') || '[]');
        const regMatch = registered.find(t => t.name && t.name.toLowerCase() === enteredName);
        tenantId = regMatch ? regMatch.id : 'T-SELF';
      }
    }

    // Run BERT analysis (no selfAssessment parameter)
    const aiResult = await analyzeText(
      descriptionText.value.trim(),
      categorySelect.value
    );

    const issueId = generateId();
    const now = new Date().toISOString();

    // Build the issue object
    const issue = {
      id: issueId,
      tenantId: tenantId,
      storeName: storeNameInput.value.trim(),
      contactPerson: contactPersonInput.value.trim(),
      phoneNumber: phoneNumberInput.value.trim(),
      category: categorySelect.value,
      selfAssessment: null,
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

    // Priority badge class
    const priorityBadgeClass = `priority-badge ${aiResult.priorityLevel}`;

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

    // Update modal header
    const modalHeader = overlay.querySelector('.modal-header h3');
    if (modalHeader) modalHeader.textContent = 'Report Confirmed';

    // Add footer
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
      clearFormForNext();
    });

    // Allow closing overlay again
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) closeModal();
    });

    showToast('Issue report submitted successfully!', 'success');

  } catch (err) {
    closeModal();
    showToast('Something went wrong. Please try again.', 'error');
    console.error(err);
  }
});


/**
 * Clear only the issue-specific fields for submitting another report.
 * Keeps tenant info filled since it's the same user.
 */
function clearFormForNext() {
  // Clear issue fields only
  categorySelect.value = '';
  descriptionText.value = '';
  selectedFile = null;

  // Reset file preview
  filePreview.classList.add('hidden');
  fileDropZone.classList.remove('hidden');
  previewThumb.src = '';
  fileInput.value = '';

  // Reset char counter
  charCounter.textContent = '0 / 1,000';
  charCounter.classList.remove('warning', 'limit');

  // Clear any validation errors
  storeNameError.classList.add('hidden');
  categoryError.classList.add('hidden');
  descriptionError.classList.add('hidden');
  storeNameInput.classList.remove('error');
  categorySelect.classList.remove('error');
  descriptionText.classList.remove('error');
}
