/* ============================================================
   Shared Utilities — Navigation, Toast, Storage, Helpers
   ============================================================ */

import { SAMPLE_ISSUES, getUsers } from './mock-data.js';

/* ---------- LocalStorage Persistence ---------- */

const STORAGE_KEY = 'nepomall_issues_v2';

export function loadIssues() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch (e) { /* ignore */ }
  // Initialize with sample data on first load
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SAMPLE_ISSUES));
  return [...SAMPLE_ISSUES];
}

export function saveIssues(issues) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(issues));
}

export function addIssue(issue) {
  const issues = loadIssues();
  issues.unshift(issue);
  saveIssues(issues);
  return issues;
}

export function updateIssue(issueId, updates) {
  const issues = loadIssues();
  const idx = issues.findIndex(i => i.id === issueId);
  if (idx !== -1) {
    issues[idx] = { ...issues[idx], ...updates, updatedAt: new Date().toISOString() };
    saveIssues(issues);
  }
  return issues;
}


/* ---------- ID Generator ---------- */

export function generateId() {
  const issues = loadIssues();
  const num = issues.length + 1;
  return `ISS-${String(num).padStart(3, '0')}`;
}


/* ---------- Date / Time Formatting ---------- */

export function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function formatRelativeTime(isoString) {
  const now = new Date();
  const then = new Date(isoString);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHrs < 24) return `${diffHrs}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(isoString);
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

  // Close on overlay click or X button
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
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


/* ---------- Debounce ---------- */

export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
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
        <input type="password" id="newUserPassword" class="form-input" placeholder="Min. 4 characters">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" for="newUserRole">Account Role <span style="color:var(--danger-500)">*</span></label>
        <select class="form-select" id="newUserRole">
          <option value="admin">PMO Admin</option>
          <option value="staff" selected>Maintenance Staff</option>
        </select>
      </div>
      <div class="form-group" id="tradeGroup" style="margin-bottom:0">
        <label class="form-label" for="newUserTrade">Trade / Specialty</label>
        <select class="form-select" id="newUserTrade">
          <option value="Electrician">Electrician</option>
          <option value="Plumber">Plumber</option>
          <option value="HVAC">HVAC</option>
          <option value="General" selected>General</option>
          <option value="Security">Security</option>
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

  // Cancel
  overlay.querySelector('#createUserCancel').addEventListener('click', closeModal);

  // Save
  overlay.querySelector('#createUserSave').addEventListener('click', () => {
    const name = overlay.querySelector('#newUserName').value.trim();
    const email = overlay.querySelector('#newUserEmail').value.trim().toLowerCase();
    const password = overlay.querySelector('#newUserPassword').value;
    const role = overlay.querySelector('#newUserRole').value;
    const trade = overlay.querySelector('#newUserTrade').value;

    // Validation
    if (!name) { showToast('Please enter a name.', 'error'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('Please enter a valid email.', 'error'); return; }
    if (!password || password.length < 4) { showToast('Password must be at least 4 characters.', 'error'); return; }

    // Check for duplicate email
    const existingUsers = getUsers();
    if (existingUsers.find(u => u.email.toLowerCase() === email)) {
      showToast('A user with this email already exists.', 'error');
      return;
    }

    // Generate unique ID
    const maxNum = existingUsers.reduce((max, u) => {
      const n = parseInt(u.id.replace(/\D/g, ''), 10);
      return n > max ? n : max;
    }, 0);
    const newId = 'U' + String(maxNum + 1).padStart(2, '0');

    // Avatar based on trade/role
    const tradeAvatars = {
      'Electrician': 'EL', 'Plumber': 'PL', 'HVAC': 'HV',
      'General': 'GN', 'Security': 'SC'
    };
    const avatar = role === 'staff' ? (tradeAvatars[trade] || 'GN') : 'SA';

    const newUser = {
      id: newId,
      name: name,
      email: email,
      password: password,
      role: role,
      avatar: avatar,
    };

    if (role === 'staff') {
      newUser.trade = trade;
    }

    existingUsers.push(newUser);
    localStorage.setItem('firs_users', JSON.stringify(existingUsers));

    closeModal();
    showToast(`Account created for ${name} (${role})`, 'success');
  });
}

/* ---------- Edit Profile Modal (Globalized) ---------- */

export function openEditAdminProfileModal() {
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
        <option value="Electrician" ${currentUser.trade === 'Electrician' ? 'selected' : ''}>Electrician</option>
        <option value="Plumber" ${currentUser.trade === 'Plumber' ? 'selected' : ''}>Plumber</option>
        <option value="HVAC" ${currentUser.trade === 'HVAC' ? 'selected' : ''}>HVAC</option>
        <option value="General" ${currentUser.trade === 'General' ? 'selected' : ''}>General</option>
        <option value="Security" ${currentUser.trade === 'Security' ? 'selected' : ''}>Security</option>
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
        <input type="password" id="editProfilePassword" class="form-input" placeholder="Leave blank to keep current password">
      </div>
      ${tradeDropdownHTML}
    </div>
  `;

  const footerHTML = `
    <button class="btn btn-secondary" id="editProfileCancel">Cancel</button>
    <button class="btn btn-primary" id="editProfileSave">Save Changes</button>
  `;

  const overlay = showModal('Edit Profile', bodyHTML, footerHTML);

  // Cancel
  overlay.querySelector('#editProfileCancel').addEventListener('click', closeModal);

  // Save
  overlay.querySelector('#editProfileSave').addEventListener('click', () => {
    const name = overlay.querySelector('#editProfileName').value.trim();
    const newPassword = overlay.querySelector('#editProfilePassword').value;
    const trade = isStaff ? overlay.querySelector('#editProfileTrade').value : null;

    if (!name) {
      showToast('Please enter a name.', 'error');
      return;
    }

    // Retrieve firs_users array from localStorage
    let users = [];
    try {
      users = JSON.parse(localStorage.getItem('firs_users') || '[]');
    } catch (e) {
      users = [];
    }

    const idx = users.findIndex(u => u.id === currentUser.id);
    if (idx === -1) {
      showToast('User not found in storage.', 'error');
      return;
    }

    // Update locally stored user
    users[idx].name = name;
    if (newPassword) {
      users[idx].password = newPassword;
    }
    if (isStaff) {
      users[idx].trade = trade;
      // Avatar based on trade
      const tradeAvatars = {
        'Electrician': 'EL', 'Plumber': 'PL', 'HVAC': 'HV',
        'General': 'GN', 'Security': 'SC'
      };
      users[idx].avatar = tradeAvatars[trade] || 'GN';
    }

    localStorage.setItem('firs_users', JSON.stringify(users));

    // Update session storage object
    const updatedUser = {
      ...currentUser,
      name: name,
      avatar: users[idx].avatar || currentUser.avatar || 'SA'
    };
    if (isStaff) {
      updatedUser.trade = trade;
    }
    sessionStorage.setItem('firs_user', JSON.stringify(updatedUser));

    // Close modal & show toast
    closeModal();
    showToast('Profile updated successfully', 'success');

    // Dynamically update the topbar UI
    const avatarEl = document.querySelector('.topbar-avatar');
    const nameEl = document.querySelector('.topbar-user span:last-child');
    if (avatarEl) {
      avatarEl.textContent = updatedUser.avatar || name.substring(0, 3);
    }
    if (nameEl) {
      nameEl.textContent = name;
    }
  });
}
