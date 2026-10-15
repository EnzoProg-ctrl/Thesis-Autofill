/* ============================================================
   Tenant Portal — Report Form Logic (Refactored)
   ============================================================ */

import { checkAuth } from './auth-guard.js';
import { CATEGORIES, getCategoryLabel, getCategoryIcon } from './app-data.js';
import { loadIssues, addIssue, showModal, closeModal, showToast, escapeHtml } from './shared.js';
// Real XLM-RoBERTa classifier. Falls back to the keyword engine in
// keyword-classifier.js automatically if the inference service is
// unreachable, so a submission is never blocked by the model being down.
import { analyzeText } from './bert-api.js';
import { supabase } from './supabase-client.js';

(async () => {
/* ---------- Auth Guard ---------- */
if (!await checkAuth('tenant')) {
  throw new Error('Not authenticated');
}

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
let selectedFileBase64 = null;
/* Resolves when the picked photo has finished compressing. Submitting is fast
   and compression is not instant, so the submit handler awaits this — without
   it a quick tenant could submit before the resize finished and the photo
   would be dropped silently. */
let imageReady = Promise.resolve();


/* ==========================================================
   1. Auto-Fill from Session
   ========================================================== */

async function autoFillFromSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  
  resolvedTenantId = session.user.id;
  
  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('id', session.user.id)
    .single();
    
  if (tenant) {
    storeNameInput.value = tenant.store_name || '';
    contactPersonInput.value = tenant.contact_person || '';
    phoneNumberInput.value = tenant.phone_number || '';
  } else {
    // Fallback to session storage if tenant query fails
    const raw = sessionStorage.getItem('firs_user');
    if (raw) {
      try {
        const user = JSON.parse(raw);
        storeNameInput.value = user.storeName || user.name || '';
        contactPersonInput.value = user.contact || '';
        phoneNumberInput.value = user.phone || '';
      } catch (e) {}
    }
  }
}

await autoFillFromSession();


/* ==========================================================
   2. Category Dropdown
   ========================================================== */

function populateCategories() {
  CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.label;
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
  if (files.length > 0) imageReady = handleFile(files[0]);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) imageReady = handleFile(fileInput.files[0]);
});

/* Photos are stored as base64 inside the issues table, and base64 is ~33%
   larger than the file it encodes. A 10 MB phone photo therefore became ~13 MB
   of database row, fetched again on every dashboard refresh.

   Downscaling to fit within 1600px and re-encoding as JPEG at 0.75 quality
   turns a typical phone photo into 200-400 KB with no meaningful loss of
   detail for judging a leak or a cracked tile. The original file is never
   uploaded — only this resized version is. */
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_QUALITY = 0.75;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode the image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          const scale = MAX_IMAGE_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // White backdrop: transparent PNGs would otherwise go black as JPEG.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please upload an image file.', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('File size must be under 10 MB.', 'error');
    return;
  }

  selectedFile = file;
  previewName.textContent = file.name;
  previewSize.textContent = formatFileSize(file.size);
  fileDropZone.classList.add('hidden');
  filePreview.classList.remove('hidden');

  try {
    selectedFileBase64 = await compressImage(file);
    previewThumb.src = selectedFileBase64;
    // Show what will actually be stored, not what was picked — a 6 MB photo
    // becoming 280 KB is worth the tenant seeing.
    const storedBytes = Math.round((selectedFileBase64.length - 22) * 0.75);
    previewSize.textContent = formatFileSize(storedBytes);
  } catch (err) {
    // Fall back to the original bytes rather than losing the photo entirely.
    console.warn('[tenant] image compression failed, storing original:', err.message);
    const reader = new FileReader();
    reader.onload = (e) => {
      selectedFileBase64 = e.target.result;
      previewThumb.src = selectedFileBase64;
    };
    reader.readAsDataURL(file);
  }
}

fileRemove.addEventListener('click', () => {
  selectedFile = null;
  selectedFileBase64 = null;
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
      <div class="processing-text">Processing your description with XLM-RoBERTa AI...</div>
    </div>
  `);

  // Prevent closing during processing
  const closeBtn = overlay.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.style.display = 'none';
  overlay.onclick = null;

  try {
    // Make sure a picked photo has finished compressing before we read
    // selectedFileBase64 below, or a fast submit would silently drop it.
    await imageReady;

    let tenantId = resolvedTenantId;

    // Run XLM-RoBERTa analysis (no selfAssessment parameter)
    const aiResult = await analyzeText(
      descriptionText.value.trim(),
      categorySelect.value
    );

    const now = new Date().toISOString();

    // Build the issue object (camelCase, mapped to snake_case by shared.js mapIssueToDB/addIssue)
    const issuePayload = {
      tenantId: tenantId,
      storeName: storeNameInput.value.trim(),
      contactPerson: contactPersonInput.value.trim(),
      phoneNumber: phoneNumberInput.value.trim(),
      category: categorySelect.value,
      status: 'awaiting_review',
      text: descriptionText.value.trim(),
      aiCategory: aiResult.category,
      aiConfidence: aiResult.confidence,
      aiPriority: aiResult.priorityScore,
      aiPriorityLevel: aiResult.priorityLevel,
      aiLanguage: aiResult.language,
      // How the priority was actually reached. 'keyword' means the inference
      // service was unreachable and the weak fallback scorer triaged this
      // report; 'safety_floor' means danger keywords overrode a lower model
      // prediction. Both need to be visible to whoever reviews the queue.
      aiPrioritySource: aiResult.prioritySource || null,
      aiSafetyTerms: aiResult.safetyOverride?.matchedTerms?.length
        ? aiResult.safetyOverride.matchedTerms.join(',')
        : null,
      aiModelPriority: aiResult.safetyOverride?.applied
        ? aiResult.safetyOverride.modelPriorityLevel
        : null,
      validated: false,
      submittedAt: now,
      updatedAt: now,
      imageUrl: selectedFileBase64 || null,
    };

    // Save to database
    const savedIssue = await addIssue(issuePayload);
    const issueId = savedIssue.ticketNumber;

    // Determine estimated response time
    const responseTimeMap = {
      critical: '5 – 15 minutes',
      high: '20 – 30 minutes',
      medium: '30 minutes – 1 hour',
      low: '1 – 2 hours',
    };
    const estimatedResponse = responseTimeMap[aiResult.priorityLevel] || '30 minutes – 1 hour';

    // Priority badge class
    const priorityBadgeClass = `priority-badge ${aiResult.priorityLevel}`;

    // Confidence is deliberately NOT shown to tenants — it is an internal
    // review signal for the HITL queue, not something a reporter can act on.
    // It is still saved to the database (aiConfidence above) and still drives
    // the admin review screens.

    // Update modal with confirmation
    const modalBody = overlay.querySelector('.modal-body');
    modalBody.innerHTML = `
      <div style="text-align:center;margin-bottom:var(--sp-6);">
        <div style="margin-bottom:var(--sp-2);color:var(--success-600);"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>
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
      window.location.href = 'home.html';
    });

    footer.querySelector('#submitAnotherBtn').addEventListener('click', () => {
      closeModal();
      clearFormForNext();
    });

    // Allow closing overlay again
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) {
        closeModal();
        window.location.href = 'home.html';
      }
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
  selectedFileBase64 = null;

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

})();
