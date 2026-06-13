/* ============================================================
   Shared Utilities — Navigation, Toast, Storage, Helpers
   ============================================================ */

import { SAMPLE_ISSUES } from './mock-data.js';

/* ---------- LocalStorage Persistence ---------- */

const STORAGE_KEY = 'nepomall_issues';

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
