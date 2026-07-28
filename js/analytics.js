/* ============================================================
   Analytics Dashboard — Charts, KPIs (Live Supabase Data)
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { CATEGORIES, STATUS_LIST, getCategoryLabel } from './mock-data.js';
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
  electrical: '#3b82f6',
  plumbing: '#0ea5e9',
  hvac: '#8b5cf6',
  structural: '#f59e0b',
  pest: '#ef4444',
  elevator: '#10b981',
  fire_safety: '#f97316',
  housekeeping: '#6366f1',
  security: '#ec4899',
  it_network: '#14b8a6',
};

/* ---------- Estimated cost per category (PHP) for budget chart ---------- */
const ESTIMATED_COST_PER_ISSUE = {
  electrical: 3500,
  plumbing: 2800,
  hvac: 5000,
  structural: 8000,
  pest: 1500,
  elevator: 6000,
  fire_safety: 4500,
  housekeeping: 800,
  security: 2000,
  it_network: 3000,
};

/* ---------- State ---------- */
let activeRange = 'weekly';
let chartInstances = {};

/* ---------- Helpers ---------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Get the Monday 00:00 and Sunday 23:59:59 of the current week.
 */
function getCurrentWeekBounds() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { monday, sunday };
}

/**
 * Given a Date, return its day-of-week index (0=Mon, 6=Sun).
 */
function getDayIndex(date) {
  const d = date.getDay(); // 0=Sun, 1=Mon
  return d === 0 ? 6 : d - 1;
}

/**
 * Aggregate live issues into the weekly data shape needed by charts/KPIs.
 */
function aggregateWeeklyData(allIssues) {
  const { monday, sunday } = getCurrentWeekBounds();

  // Filter to current week
  const weekIssues = allIssues.filter(issue => {
    const d = new Date(issue.submittedAt);
    return d >= monday && d <= sunday;
  });

  // --- Issues by day ---
  const issuesByDay = [0, 0, 0, 0, 0, 0, 0];
  for (const issue of weekIssues) {
    const idx = getDayIndex(new Date(issue.submittedAt));
    issuesByDay[idx]++;
  }

  // --- Category trends (per day) ---
  const catKeys = Object.keys(CATEGORY_COLORS);
  const categoryTrends = {};
  for (const cat of catKeys) {
    categoryTrends[cat] = [0, 0, 0, 0, 0, 0, 0];
  }
  // Category totals (flat, for doughnut/recurring)
  const categoryTotals = {};
  for (const cat of catKeys) categoryTotals[cat] = 0;

  for (const issue of weekIssues) {
    const cat = issue.aiCategory || issue.category || 'other';
    const idx = getDayIndex(new Date(issue.submittedAt));
    if (categoryTrends[cat]) {
      categoryTrends[cat][idx]++;
      categoryTotals[cat]++;
    }
  }

  // --- Priority distribution (per day) ---
  const priorityTrends = {
    critical: [0, 0, 0, 0, 0, 0, 0],
    high: [0, 0, 0, 0, 0, 0, 0],
    medium: [0, 0, 0, 0, 0, 0, 0],
    low: [0, 0, 0, 0, 0, 0, 0],
  };
  for (const issue of weekIssues) {
    const level = issue.aiPriorityLevel || 'low';
    const idx = getDayIndex(new Date(issue.submittedAt));
    if (priorityTrends[level]) {
      priorityTrends[level][idx]++;
    }
  }

  // --- Avg resolution time by category (hours) ---
  // Only resolved issues with both submittedAt and updatedAt
  const resolutionBuckets = {};
  for (const cat of catKeys) resolutionBuckets[cat] = [];

  for (const issue of weekIssues) {
    if (issue.status === 'resolved' && issue.submittedAt && issue.updatedAt) {
      const cat = issue.aiCategory || issue.category || 'other';
      const hours = (new Date(issue.updatedAt) - new Date(issue.submittedAt)) / (1000 * 60 * 60);
      if (resolutionBuckets[cat]) {
        resolutionBuckets[cat].push(hours);
      }
    }
  }

  const avgResolutionTime = {};
  for (const cat of catKeys) {
    const arr = resolutionBuckets[cat];
    avgResolutionTime[cat] = arr.length > 0
      ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length)
      : 0;
  }

  // --- AI Accuracy per day ---
  // Accuracy = validated issues where AI was NOT overridden / total validated
  const dayValidated = [0, 0, 0, 0, 0, 0, 0];
  const dayCorrect = [0, 0, 0, 0, 0, 0, 0];

  for (const issue of weekIssues) {
    if (issue.validated) {
      const idx = getDayIndex(new Date(issue.submittedAt));
      dayValidated[idx]++;
      if (!issue.overridden) {
        dayCorrect[idx]++;
      }
    }
  }

  const aiAccuracy = DAY_LABELS.map((_, i) => {
    if (dayValidated[i] === 0) return 0;
    return Math.round((dayCorrect[i] / dayValidated[i]) * 100);
  });

  // --- Budget impact by category (estimated) ---
  const budgetByCategory = {};
  for (const cat of catKeys) {
    budgetByCategory[cat] = categoryTotals[cat] * (ESTIMATED_COST_PER_ISSUE[cat] || 1000);
  }

  // --- Status counts (for status doughnut — uses ALL issues, not just this week) ---
  const statusCounts = {};
  for (const s of STATUS_LIST) statusCounts[s.id] = 0;
  for (const issue of allIssues) {
    if (statusCounts[issue.status] !== undefined) {
      statusCounts[issue.status]++;
    }
  }

  return {
    weekIssues,
    allIssues,
    issuesByDay,
    categoryTrends,
    categoryTotals,
    priorityTrends,
    avgResolutionTime,
    aiAccuracy,
    budgetByCategory,
    statusCounts,
  };
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

function renderKPIs(data) {
  const { issuesByDay, categoryTotals, avgResolutionTime, aiAccuracy, weekIssues } = data;

  // 1. Total Issues (this week)
  const total = issuesByDay.reduce((s, v) => s + v, 0);
  document.getElementById('kpiTotalIssues').textContent = total;

  // Trend: compare today vs yesterday
  if (issuesByDay.length >= 2) {
    const last = issuesByDay[issuesByDay.length - 1];
    const prev = issuesByDay[issuesByDay.length - 2];
    const diff = last - prev;
    const pct = prev > 0 ? Math.round(Math.abs(diff) / prev * 100) : 0;
    const trendEl = document.getElementById('kpiTotalTrend');
    if (diff > 0) {
      trendEl.className = 'kpi-trend up';
      trendEl.textContent = `↑ ${pct}% vs yesterday`;
    } else if (diff < 0) {
      trendEl.className = 'kpi-trend down';
      trendEl.textContent = `↓ ${pct}% vs yesterday`;
    } else {
      trendEl.className = 'kpi-trend';
      trendEl.textContent = `No change vs yesterday`;
    }
  }

  // 2. Most Common Category (this week)
  const topCat = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  if (topCat && topCat[1] > 0) {
    document.getElementById('kpiTopCategory').textContent = getCategoryLabel(topCat[0]);
    document.getElementById('kpiTopCategoryCount').textContent = `${topCat[1]} issues this week`;
  } else {
    document.getElementById('kpiTopCategory').textContent = '—';
    document.getElementById('kpiTopCategoryCount').textContent = 'No issues this week';
  }
  document.getElementById('kpiTopCategoryCount').className = 'kpi-trend';

  // 3. Avg Resolution Time (across resolved issues this week)
  const resVals = Object.values(avgResolutionTime).filter(v => v > 0);
  const avgRes = resVals.length > 0
    ? Math.round(resVals.reduce((s, v) => s + v, 0) / resVals.length)
    : 0;
  document.getElementById('kpiAvgResolution').textContent = avgRes > 0 ? `${avgRes}h` : '—';
  document.getElementById('kpiResolutionNote').textContent = resVals.length > 0
    ? 'Across resolved issues'
    : 'No resolved issues this week';
  document.getElementById('kpiResolutionNote').className = 'kpi-trend';

  // 4. AI Accuracy (overall for the week)
  const totalValidated = weekIssues.filter(i => i.validated).length;
  const totalCorrect = weekIssues.filter(i => i.validated && !i.overridden).length;
  const overallAccuracy = totalValidated > 0 ? Math.round((totalCorrect / totalValidated) * 100) : 0;

  document.getElementById('kpiAiAccuracy').textContent = totalValidated > 0 ? `${overallAccuracy}%` : '—';

  const accTrendEl = document.getElementById('kpiAccuracyTrend');
  if (totalValidated > 0) {
    accTrendEl.className = overallAccuracy >= 90 ? 'kpi-trend down' : 'kpi-trend up';
    accTrendEl.textContent = `${totalCorrect}/${totalValidated} validated correct`;
  } else {
    accTrendEl.className = 'kpi-trend';
    accTrendEl.textContent = 'No validated issues this week';
  }
}

/* ---------- Chart 1: Issues by Category — Doughnut ---------- */

function renderCategoryDoughnut(data) {
  const { categoryTotals } = data;
  const catKeys = Object.keys(categoryTotals).filter(k => categoryTotals[k] > 0);

  // If no issues at all, show all categories with 0
  const keysToShow = catKeys.length > 0 ? catKeys : Object.keys(CATEGORY_COLORS);
  const totals = keysToShow.map(k => categoryTotals[k] || 0);
  const labels = keysToShow.map(k => getCategoryLabel(k));
  const colors = keysToShow.map(k => CATEGORY_COLORS[k] || '#94a3b8');

  chartInstances.categoryDoughnut = new Chart(
    document.getElementById('chartCategoryDoughnut'),
    {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: totals,
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

/* ---------- Chart 2: Weekly Trend — Line ---------- */

function renderWeeklyTrend(data) {
  const { issuesByDay } = data;

  chartInstances.weeklyTrend = new Chart(
    document.getElementById('chartMonthlyTrend'),
    {
      type: 'line',
      data: {
        labels: DAY_LABELS,
        datasets: [{
          label: 'Issues Submitted',
          data: issuesByDay,
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
            ticks: { stepSize: 1 },
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

function renderPriorityDist(data) {
  const { priorityTrends } = data;

  chartInstances.priorityDist = new Chart(
    document.getElementById('chartPriorityDist'),
    {
      type: 'bar',
      data: {
        labels: DAY_LABELS,
        datasets: [
          {
            label: 'Critical',
            data: priorityTrends.critical,
            backgroundColor: '#dc2626',
            borderRadius: 4,
          },
          {
            label: 'High',
            data: priorityTrends.high,
            backgroundColor: '#ea580c',
            borderRadius: 4,
          },
          {
            label: 'Medium',
            data: priorityTrends.medium,
            backgroundColor: '#d97706',
            borderRadius: 4,
          },
          {
            label: 'Low',
            data: priorityTrends.low,
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

function renderResolutionTime(data) {
  const { avgResolutionTime } = data;
  const sortedEntries = Object.entries(avgResolutionTime)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  // If no resolved issues, show placeholder
  const entries = sortedEntries.length > 0
    ? sortedEntries
    : Object.keys(CATEGORY_COLORS).map(k => [k, 0]);

  const labels = entries.map(([k]) => getCategoryLabel(k));
  const chartData = entries.map(([, v]) => v);
  const colors = entries.map(([k]) => CATEGORY_COLORS[k] || '#94a3b8');

  chartInstances.resolutionTime = new Chart(
    document.getElementById('chartResolutionTime'),
    {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Avg Hours',
          data: chartData,
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

function renderAiAccuracy(data) {
  const { aiAccuracy } = data;
  const targetData = DAY_LABELS.map(() => 90);

  chartInstances.aiAccuracy = new Chart(
    document.getElementById('chartAiAccuracy'),
    {
      type: 'line',
      data: {
        labels: DAY_LABELS,
        datasets: [
          {
            label: 'AI Accuracy',
            data: aiAccuracy,
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
            min: 0,
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

function renderBudget(data) {
  const { budgetByCategory } = data;
  const sorted = Object.entries(budgetByCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  // If no budget data, show all categories at 0
  const entries = sorted.length > 0
    ? sorted
    : Object.keys(CATEGORY_COLORS).map(k => [k, 0]);

  const labels = entries.map(([k]) => getCategoryLabel(k));
  const chartData = entries.map(([, v]) => v);

  // Gradient from blue (#3b82f6) to orange (#f97316)
  const len = entries.length;
  const colors = entries.map((_, i) => {
    const ratio = len > 1 ? i / (len - 1) : 0;
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
          data: chartData,
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

function renderRecurring(data) {
  const { categoryTotals } = data;
  const catTotals = Object.entries(categoryTotals)
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => b.total - a.total);

  const top = catTotals.slice(0, 7);
  const labels = top.map(c => getCategoryLabel(c.key));
  const chartData = top.map(c => c.total);
  const colors = top.map(c => CATEGORY_COLORS[c.key] || '#94a3b8');

  chartInstances.recurring = new Chart(
    document.getElementById('chartRecurring'),
    {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Total Issues',
          data: chartData,
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

function renderStatusDist(data) {
  const { statusCounts } = data;

  const labels = [];
  const chartData = [];
  const colors = [];
  for (const s of STATUS_LIST) {
    if (statusCounts[s.id] > 0) {
      labels.push(s.label);
      chartData.push(statusCounts[s.id]);
      colors.push(s.color);
    }
  }

  // If no issues at all, show all statuses at 0
  if (labels.length === 0) {
    for (const s of STATUS_LIST) {
      labels.push(s.label);
      chartData.push(0);
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
          data: chartData,
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

/* ---------- HITL Badge ---------- */

async function updateHITLBadge(allIssues) {
  const count = allIssues.filter(i => i.validated === false && i.status !== 'resolved').length;
  sessionStorage.setItem('firs_badge_count', count);
  const badge = document.getElementById('hitl-badge');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? '' : 'none';
  }
}

/* ---------- Render Everything ---------- */

async function renderAll() {
  destroyAllCharts();

  // Fetch live data from Supabase
  const allIssues = await loadIssues();
  const data = aggregateWeeklyData(allIssues);

  // Render all KPIs and charts with aggregated data
  renderKPIs(data);
  renderCategoryDoughnut(data);
  renderWeeklyTrend(data);
  renderPriorityDist(data);
  renderResolutionTime(data);
  renderAiAccuracy(data);
  renderBudget(data);
  renderRecurring(data);
  renderStatusDist(data);

  // Update HITL badge with same data (avoids extra fetch)
  await updateHITLBadge(allIssues);
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

    activeRange = btn.dataset.range;
    renderAll();
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
  try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }
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
  try { currentUser = JSON.parse(sessionStorage.getItem('firs_user')); } catch (e) { /* ignore */ }

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
      try { await supabase.auth.signOut(); } catch (err) { }
      sessionStorage.removeItem('firs_user');
      window.location.replace('../index.html');
    });
  }

  initTimeRange();
  initExportButtons();
  initSidebarToggle();
  await renderAll();
});
