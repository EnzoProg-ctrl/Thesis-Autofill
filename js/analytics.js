/* ============================================================
   Analytics Dashboard — Charts, KPIs, Time-Range Filtering
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { HISTORICAL_DATA, CATEGORIES, STATUS_LIST, getCategoryLabel } from './mock-data.js';
import { loadIssues, showToast, openCreateUserModal, openEditAdminProfileModal } from './shared.js';

/* ---------- Auth Guard ---------- */
if (!(await checkAuth(['admin', 'staff']))) {
  throw new Error('Not authenticated');
}

/* ---------- Chart.js Global Defaults ---------- */
Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
Chart.defaults.color = '#64748b';
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = true;

/* ---------- Category Colors ---------- */
const CATEGORY_COLORS = {
  electrical:   '#3b82f6',
  plumbing:     '#0ea5e9',
  hvac:         '#8b5cf6',
  structural:   '#f59e0b',
  pest:         '#ef4444',
  elevator:     '#10b981',
  fire_safety:  '#f97316',
  housekeeping: '#6366f1',
  security:     '#ec4899',
  it_network:   '#14b8a6',
};

/* ---------- State ---------- */
let activeRange = 6; // months to show
let chartInstances = {};

/* ---------- Helpers ---------- */

function sliceData(arr, range) {
  return arr.slice(arr.length - range);
}

function sliceObjectData(obj, range, months) {
  const result = {};
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key])) {
      result[key] = sliceData(obj[key], range);
    } else {
      result[key] = obj[key];
    }
  }
  return result;
}

function destroyAllCharts() {
  for (const key of Object.keys(chartInstances)) {
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      chartInstances[key] = null;
    }
  }
}

function formatPHP(value) {
  return '₱' + Number(value).toLocaleString('en-PH');
}

/* ---------- KPI Calculations ---------- */

function renderKPIs(range) {
  const months = sliceData(HISTORICAL_DATA.months, range);
  const issuesByMonth = sliceData(HISTORICAL_DATA.issuesByMonth, range);

  // 1. Total Issues
  const total = issuesByMonth.reduce((s, v) => s + v, 0);
  document.getElementById('kpiTotalIssues').textContent = total;

  // Trend: compare last month vs previous
  if (issuesByMonth.length >= 2) {
    const last = issuesByMonth[issuesByMonth.length - 1];
    const prev = issuesByMonth[issuesByMonth.length - 2];
    const diff = last - prev;
    const pct = prev > 0 ? Math.round(Math.abs(diff) / prev * 100) : 0;
    const trendEl = document.getElementById('kpiTotalTrend');
    if (diff > 0) {
      trendEl.className = 'kpi-trend up';
      trendEl.textContent = `↑ ${pct}% vs prev month`;
    } else if (diff < 0) {
      trendEl.className = 'kpi-trend down';
      trendEl.textContent = `↓ ${pct}% vs prev month`;
    } else {
      trendEl.className = 'kpi-trend';
      trendEl.textContent = `No change vs prev month`;
    }
  }

  // 2. Most Common Category
  const catTotals = {};
  const catTrends = HISTORICAL_DATA.categoryTrends;
  for (const cat of Object.keys(catTrends)) {
    catTotals[cat] = sliceData(catTrends[cat], range).reduce((s, v) => s + v, 0);
  }
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
  document.getElementById('kpiTopCategory').textContent = getCategoryLabel(topCat[0]);
  document.getElementById('kpiTopCategoryCount').textContent = `${topCat[1]} issues in period`;
  document.getElementById('kpiTopCategoryCount').className = 'kpi-trend';

  // 3. Avg Resolution Time
  const resolutionVals = Object.values(HISTORICAL_DATA.avgResolutionTime);
  const avgRes = Math.round(resolutionVals.reduce((s, v) => s + v, 0) / resolutionVals.length);
  document.getElementById('kpiAvgResolution').textContent = `${avgRes}h`;
  document.getElementById('kpiResolutionNote').textContent = 'Across all categories';
  document.getElementById('kpiResolutionNote').className = 'kpi-trend';

  // 4. AI Accuracy
  const aiAcc = sliceData(HISTORICAL_DATA.aiAccuracy, range);
  const latestAcc = aiAcc[aiAcc.length - 1];
  document.getElementById('kpiAiAccuracy').textContent = `${latestAcc}%`;

  if (aiAcc.length >= 2) {
    const prevAcc = aiAcc[aiAcc.length - 2];
    const accDiff = latestAcc - prevAcc;
    const accTrendEl = document.getElementById('kpiAccuracyTrend');
    if (accDiff > 0) {
      accTrendEl.className = 'kpi-trend down'; // green = good for accuracy going up
      accTrendEl.textContent = `↑ +${accDiff}% improvement`;
    } else if (accDiff < 0) {
      accTrendEl.className = 'kpi-trend up';
      accTrendEl.textContent = `↓ ${accDiff}% decline`;
    } else {
      accTrendEl.className = 'kpi-trend';
      accTrendEl.textContent = 'Stable';
    }
  }
}

/* ---------- Chart 1: Issues by Category — Doughnut ---------- */

function renderCategoryDoughnut(range) {
  const catTrends = HISTORICAL_DATA.categoryTrends;
  const catKeys = Object.keys(catTrends);
  const catTotals = catKeys.map(k => sliceData(catTrends[k], range).reduce((s, v) => s + v, 0));
  const labels = catKeys.map(k => getCategoryLabel(k));
  const colors = catKeys.map(k => CATEGORY_COLORS[k] || '#94a3b8');

  chartInstances.categoryDoughnut = new Chart(
    document.getElementById('chartCategoryDoughnut'),
    {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: catTotals,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        cutout: '65%',
        aspectRatio: 1.5,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.parsed} issues`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Chart 2: Monthly Trend — Line ---------- */

function renderMonthlyTrend(range) {
  const months = sliceData(HISTORICAL_DATA.months, range);
  const data = sliceData(HISTORICAL_DATA.issuesByMonth, range);

  chartInstances.monthlyTrend = new Chart(
    document.getElementById('chartMonthlyTrend'),
    {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: 'Issues Submitted',
          data,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#3b82f6',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        }],
      },
      options: {
        aspectRatio: 1.5,
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { stepSize: 10 },
          },
          x: {
            grid: { display: false },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.y} issues`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Chart 3: Priority Distribution — Stacked Bar ---------- */

function renderPriorityDist(range) {
  const months = sliceData(HISTORICAL_DATA.months, range);
  const pt = HISTORICAL_DATA.priorityTrends;

  chartInstances.priorityDist = new Chart(
    document.getElementById('chartPriorityDist'),
    {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          {
            label: 'Critical',
            data: sliceData(pt.critical, range),
            backgroundColor: '#dc2626',
            borderRadius: 4,
          },
          {
            label: 'High',
            data: sliceData(pt.high, range),
            backgroundColor: '#ea580c',
            borderRadius: 4,
          },
          {
            label: 'Medium',
            data: sliceData(pt.medium, range),
            backgroundColor: '#d97706',
            borderRadius: 4,
          },
          {
            label: 'Low',
            data: sliceData(pt.low, range),
            backgroundColor: '#3b82f6',
            borderRadius: 4,
          },
        ],
      },
      options: {
        aspectRatio: 1.5,
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} issues`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Chart 4: Resolution Time by Category — Horizontal Bar ---------- */

function renderResolutionTime() {
  const rt = HISTORICAL_DATA.avgResolutionTime;
  const sortedEntries = Object.entries(rt).sort((a, b) => b[1] - a[1]);
  const labels = sortedEntries.map(([k]) => getCategoryLabel(k));
  const data = sortedEntries.map(([, v]) => v);
  const colors = sortedEntries.map(([k]) => CATEGORY_COLORS[k] || '#94a3b8');

  chartInstances.resolutionTime = new Chart(
    document.getElementById('chartResolutionTime'),
    {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Avg Hours',
          data,
          backgroundColor: colors,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        aspectRatio: 1.5,
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' }, title: { display: true, text: 'Hours', font: { size: 11 } } },
          y: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.x} hours`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Chart 5: AI Accuracy Over Time — Line ---------- */

function renderAiAccuracy(range) {
  const months = sliceData(HISTORICAL_DATA.months, range);
  const data = sliceData(HISTORICAL_DATA.aiAccuracy, range);
  const targetData = months.map(() => 90);

  chartInstances.aiAccuracy = new Chart(
    document.getElementById('chartAiAccuracy'),
    {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          {
            label: 'AI Accuracy',
            data,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.08)',
            fill: true,
            tension: 0.3,
            pointBackgroundColor: '#22c55e',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
          },
          {
            label: 'Target (90%)',
            data: targetData,
            borderColor: '#9ca3af',
            borderDash: [6, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        aspectRatio: 1.5,
        scales: {
          y: {
            min: 70,
            max: 100,
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { callback: (v) => v + '%' },
          },
          x: { grid: { display: false } },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Chart 6: Budget Impact by Category — Horizontal Bar (full-width) ---------- */

function renderBudget() {
  const budget = HISTORICAL_DATA.budgetByCategory;
  const sorted = Object.entries(budget).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(([k]) => getCategoryLabel(k));
  const data = sorted.map(([, v]) => v);

  // Gradient from blue (#3b82f6) to orange (#f97316)
  const len = sorted.length;
  const colors = sorted.map((_, i) => {
    const ratio = i / (len - 1);
    const r = Math.round(59 + (249 - 59) * ratio);
    const g = Math.round(130 + (115 - 130) * ratio);
    const b = Math.round(246 + (22 - 246) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  });

  chartInstances.budget = new Chart(
    document.getElementById('chartBudget'),
    {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Budget (PHP)',
          data,
          backgroundColor: colors,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        aspectRatio: 2.5,
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: { callback: (v) => formatPHP(v) },
          },
          y: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Budget: ${formatPHP(ctx.parsed.x)}`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Chart 7: Top Recurring Issues — Horizontal Bar ---------- */

function renderRecurring(range) {
  const catTrends = HISTORICAL_DATA.categoryTrends;
  const catKeys = Object.keys(catTrends);
  const catTotals = catKeys.map(k => ({
    key: k,
    total: sliceData(catTrends[k], range).reduce((s, v) => s + v, 0),
  }));
  catTotals.sort((a, b) => b.total - a.total);

  const top = catTotals.slice(0, 7);
  const labels = top.map(c => getCategoryLabel(c.key));
  const data = top.map(c => c.total);
  const colors = top.map(c => CATEGORY_COLORS[c.key] || '#94a3b8');

  chartInstances.recurring = new Chart(
    document.getElementById('chartRecurring'),
    {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Total Issues',
          data,
          backgroundColor: colors,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        aspectRatio: 1.5,
        scales: {
          x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } },
          y: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.parsed.x} issues`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Chart 8: Issue Status Distribution — Doughnut ---------- */

async function renderStatusDist() {
  const issues = await loadIssues();
  const statusCounts = {};
  for (const s of STATUS_LIST) {
    statusCounts[s.id] = 0;
  }
  for (const issue of issues) {
    if (statusCounts[issue.status] !== undefined) {
      statusCounts[issue.status]++;
    } else {
      statusCounts[issue.status] = 1;
    }
  }

  const labels = [];
  const data = [];
  const colors = [];
  for (const s of STATUS_LIST) {
    if (statusCounts[s.id] > 0) {
      labels.push(s.label);
      data.push(statusCounts[s.id]);
      colors.push(s.color);
    }
  }

  chartInstances.statusDist = new Chart(
    document.getElementById('chartStatusDist'),
    {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        cutout: '65%',
        aspectRatio: 1.5,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 12, padding: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${ctx.parsed} issues`,
            },
          },
        },
      },
    }
  );
}

/* ---------- Render Everything ---------- */

async function renderAll(range) {
  destroyAllCharts();
  renderKPIs(range);
  renderCategoryDoughnut(range);
  renderMonthlyTrend(range);
  renderPriorityDist(range);
  renderResolutionTime();
  renderAiAccuracy(range);
  renderBudget();
  renderRecurring(range);
  await renderStatusDist();
}

/* ---------- Time Range Selector ---------- */

function initTimeRange() {
  const container = document.getElementById('timeRange');
  const buttons = container.querySelectorAll('.segmented-btn');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.segmented-btn');
    if (!btn) return;

    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    activeRange = parseInt(btn.dataset.range, 10);
    renderAll(activeRange);
  });
}

/* ---------- Export Buttons ---------- */

function initExportButtons() {
  document.getElementById('exportPdf').addEventListener('click', () => {
    showToast('Report exported as PDF', 'success');
  });
  document.getElementById('exportCsv').addEventListener('click', () => {
    showToast('Data exported as CSV', 'success');
  });
}

/* ---------- Mobile Sidebar Toggle ---------- */

function initSidebarToggle() {
  const toggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // Close sidebar when clicking outside on mobile
  document.addEventListener('click', (e) => {
    if (
      sidebar.classList.contains('open') &&
      !sidebar.contains(e.target) &&
      !toggle.contains(e.target)
    ) {
      sidebar.classList.remove('open');
    }
  });
}

function applyRBAC() {
  let currentUser = null;
  try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch(e) { /* ignore */ }
  if (!currentUser) return;

  if (currentUser.role === 'staff') {
    const hitlLink = document.getElementById('hitl-link');
    if (hitlLink) hitlLink.classList.add('hidden');

    const manageUsersLink = document.getElementById('manage-users-link');
    if (manageUsersLink) manageUsersLink.classList.add('hidden');

    const analyticsLink = document.querySelector('a[href="analytics.html"]');
    if (analyticsLink) analyticsLink.classList.add('hidden');
  }

  // Personalize topbar
  const avatarEl = document.querySelector('.topbar-avatar');
  const nameEl = document.querySelector('.topbar-user span:last-child');
  if (avatarEl) avatarEl.textContent = currentUser.avatar || (currentUser.name ? currentUser.name.substring(0, 3) : 'USR');
  if (nameEl) nameEl.textContent = currentUser.name || 'User';
}

document.addEventListener('DOMContentLoaded', async () => {
  applyRBAC();
  
  // Resolve current user for event binding
  let currentUser = null;
  try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch(e) { /* ignore */ }

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
  const signOutLink = document.querySelector('a[onclick*="sessionStorage.removeItem"]');
  if (signOutLink) {
    signOutLink.removeAttribute('onclick');
    signOutLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try { await supabase.auth.signOut(); } catch (err) {}
      sessionStorage.removeItem('firs_user');
      window.location.replace('../index.html');
    });
  }

  initTimeRange();
  initExportButtons();
  initSidebarToggle();
  await renderAll(activeRange);
});
