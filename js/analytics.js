/* ============================================================
   Analytics Dashboard — Charts, KPIs (Live Supabase Data)
   ============================================================ */

import { supabase } from './supabase-client.js';
import { checkAuth } from './auth-guard.js';
import { CATEGORIES, STATUS_LIST, getCategoryLabel } from './app-data.js';
import { loadIssues, initSidebarToggle, showToast, resolutionHoursFor, mean, formatHours, aiAgreement,
         openCreateUserModal, openEditAdminProfileModal, escapeHtml, localDateKey } from './shared.js';

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
  fire_safety: '#f97316',
  housekeeping: '#6366f1',
  it_network: '#14b8a6',
};

/* ---------- Estimated cost per category (PHP) for budget chart ---------- */
const ESTIMATED_COST_PER_ISSUE = {
  electrical: 3500,
  plumbing: 2800,
  hvac: 5000,
  structural: 8000,
  pest: 1500,
  fire_safety: 4500,
  housekeeping: 800,
  it_network: 3000,
};

/* ---------- State ---------- */
let activeRange = 'weekly';
let chartInstances = {};

/* What the charts were last drawn from, so the CSV export ships exactly the
   rows behind the visible page rather than re-fetching and risking a file that
   disagrees with the screen above it. Null until the first render finishes. */
let lastRender = null;

/* ---------- Helpers ---------- */

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Generate labels for each day of the current month (1, 2, 3, ... 28/29/30/31).
 */
function getMonthDayLabels() {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
}

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
 * Get the 1st 00:00 and last day 23:59:59 of the current month.
 */
function getCurrentMonthBounds() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { firstDay, lastDay };
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

  /* --- Resolution time ---
     Two shapes, deliberately.

     `resolutionHours` is every resolved report's hours in ONE flat list, and
     the headline KPI averages that. It used to average the per-category
     averages instead, which weights a category holding one report the same as
     a category holding twenty.

     `avgResolutionTime` stays per-category for the bar chart, but categories
     with no resolved reports are now OMITTED rather than stored as 0, and the
     values are no longer rounded here. Both mattered: the old code rounded
     first and then filtered on `> 0`, so a category resolved in under thirty
     minutes rounded to 0 and was discarded as though it had no data. On
     2026-08-19 that turned a true average of 11.1 h (22.20 h and 0.04 h) into
     a displayed 22 h — the two-minute fix was deleted and the mean taken over
     the single survivor. The bias only ever ran one way: the faster the work,
     the worse the number looked. */
  const resolutionBuckets = {};
  const resolutionHours = [];

  for (const issue of weekIssues) {
    const hours = resolutionHoursFor(issue);
    if (hours === null) continue;
    resolutionHours.push(hours);
    const cat = issue.aiCategory || issue.category || 'other';
    if (!catKeys.includes(cat)) continue;
    (resolutionBuckets[cat] ||= []).push(hours);
  }

  const avgResolutionTime = {};
  for (const [cat, arr] of Object.entries(resolutionBuckets)) {
    avgResolutionTime[cat] = mean(arr);
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
    resolutionHours,
    aiAccuracy,
    budgetByCategory,
    statusCounts,
  };
}

/**
 * Aggregate live issues into the monthly data shape needed by charts/KPIs.
 */
function aggregateMonthlyData(allIssues) {
  const { firstDay, lastDay } = getCurrentMonthBounds();
  const daysInMonth = lastDay.getDate();

  // Filter to current month
  const monthIssues = allIssues.filter(issue => {
    const d = new Date(issue.submittedAt);
    return d >= firstDay && d <= lastDay;
  });

  // --- Issues by day-of-month ---
  const issuesByDay = new Array(daysInMonth).fill(0);
  for (const issue of monthIssues) {
    const idx = new Date(issue.submittedAt).getDate() - 1;
    issuesByDay[idx]++;
  }

  // --- Category trends (per day-of-month) ---
  const catKeys = Object.keys(CATEGORY_COLORS);
  const categoryTrends = {};
  for (const cat of catKeys) {
    categoryTrends[cat] = new Array(daysInMonth).fill(0);
  }
  const categoryTotals = {};
  for (const cat of catKeys) categoryTotals[cat] = 0;

  for (const issue of monthIssues) {
    const cat = issue.aiCategory || issue.category || 'other';
    const idx = new Date(issue.submittedAt).getDate() - 1;
    if (categoryTrends[cat]) {
      categoryTrends[cat][idx]++;
      categoryTotals[cat]++;
    }
  }

  // --- Priority distribution (per day-of-month) ---
  const priorityTrends = {
    critical: new Array(daysInMonth).fill(0),
    high: new Array(daysInMonth).fill(0),
    medium: new Array(daysInMonth).fill(0),
    low: new Array(daysInMonth).fill(0),
  };
  for (const issue of monthIssues) {
    const level = issue.aiPriorityLevel || 'low';
    const idx = new Date(issue.submittedAt).getDate() - 1;
    if (priorityTrends[level]) {
      priorityTrends[level][idx]++;
    }
  }

  /* --- Resolution time ---
     Two shapes, deliberately.

     `resolutionHours` is every resolved report's hours in ONE flat list, and
     the headline KPI averages that. It used to average the per-category
     averages instead, which weights a category holding one report the same as
     a category holding twenty.

     `avgResolutionTime` stays per-category for the bar chart, but categories
     with no resolved reports are now OMITTED rather than stored as 0, and the
     values are no longer rounded here. Both mattered: the old code rounded
     first and then filtered on `> 0`, so a category resolved in under thirty
     minutes rounded to 0 and was discarded as though it had no data. On
     2026-08-19 that turned a true average of 11.1 h (22.20 h and 0.04 h) into
     a displayed 22 h — the two-minute fix was deleted and the mean taken over
     the single survivor. The bias only ever ran one way: the faster the work,
     the worse the number looked. */
  const resolutionBuckets = {};
  const resolutionHours = [];

  for (const issue of monthIssues) {
    const hours = resolutionHoursFor(issue);
    if (hours === null) continue;
    resolutionHours.push(hours);
    const cat = issue.aiCategory || issue.category || 'other';
    if (!catKeys.includes(cat)) continue;
    (resolutionBuckets[cat] ||= []).push(hours);
  }

  const avgResolutionTime = {};
  for (const [cat, arr] of Object.entries(resolutionBuckets)) {
    avgResolutionTime[cat] = mean(arr);
  }

  // --- AI Accuracy per day-of-month ---
  const dayValidated = new Array(daysInMonth).fill(0);
  const dayCorrect = new Array(daysInMonth).fill(0);

  for (const issue of monthIssues) {
    if (issue.validated) {
      const idx = new Date(issue.submittedAt).getDate() - 1;
      dayValidated[idx]++;
      if (!issue.overridden) {
        dayCorrect[idx]++;
      }
    }
  }

  const monthDayLabels = getMonthDayLabels();
  const aiAccuracy = monthDayLabels.map((_, i) => {
    if (dayValidated[i] === 0) return 0;
    return Math.round((dayCorrect[i] / dayValidated[i]) * 100);
  });

  // --- Budget impact by category ---
  const budgetByCategory = {};
  for (const cat of catKeys) {
    budgetByCategory[cat] = categoryTotals[cat] * (ESTIMATED_COST_PER_ISSUE[cat] || 1000);
  }

  // --- Status counts (all issues, not just this month) ---
  const statusCounts = {};
  for (const s of STATUS_LIST) statusCounts[s.id] = 0;
  for (const issue of allIssues) {
    if (statusCounts[issue.status] !== undefined) {
      statusCounts[issue.status]++;
    }
  }

  return {
    weekIssues: monthIssues,
    allIssues,
    issuesByDay,
    categoryTrends,
    categoryTotals,
    priorityTrends,
    avgResolutionTime,
    resolutionHours,
    aiAccuracy,
    budgetByCategory,
    statusCounts,
    labels: monthDayLabels,
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
  const { issuesByDay, categoryTotals, resolutionHours, aiAccuracy, weekIssues } = data;

  const periodLabel = activeRange === 'monthly' ? 'this month' : 'this week';

  // 1. Total Issues
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
    document.getElementById('kpiTopCategoryCount').textContent = `${topCat[1]} issues ${periodLabel}`;
  } else {
    document.getElementById('kpiTopCategory').textContent = '—';
    document.getElementById('kpiTopCategoryCount').textContent = `No issues ${periodLabel}`;
  }
  document.getElementById('kpiTopCategoryCount').className = 'kpi-trend';

  /* 3. Avg Resolution Time — the mean over every resolved report, not the mean
        of the per-category means. The note now states how many reports it is
        actually averaging: "22h" over a single report and "22h" over forty are
        very different claims, and during the pilot this will often be one or
        two. */
  const avgRes = mean(resolutionHours);
  document.getElementById('kpiAvgResolution').textContent = formatHours(avgRes);
  document.getElementById('kpiResolutionNote').textContent = avgRes === null
    ? `No resolved issues ${periodLabel}`
    : `Across ${resolutionHours.length} resolved issue${resolutionHours.length === 1 ? '' : 's'}`;
  document.getElementById('kpiResolutionNote').className = 'kpi-trend';

  /* 4. AI Accuracy — same definition as the dashboard and the HITL panel, from
        shared.js. This is the week's scope rather than all time, which is why
        it can legitimately differ from the other two screens; what it must not
        do is differ because it is counting something else, which is how the
        dashboard ended up showing 62% beside HITL's 86%.

        "not overridden" rather than "correct": nobody established ground
        truth, a reviewer simply let the model's answer stand. */
  const agreement = aiAgreement(weekIssues);

  document.getElementById('kpiAiAccuracy').textContent =
    agreement.pct === null ? '—' : `${agreement.pct}%`;

  const accTrendEl = document.getElementById('kpiAccuracyTrend');
  if (agreement.validated > 0) {
    accTrendEl.className = agreement.pct >= 90 ? 'kpi-trend down' : 'kpi-trend up';
    accTrendEl.textContent = `${agreement.agreed}/${agreement.validated} not overridden`;
  } else {
    accTrendEl.className = 'kpi-trend';
    accTrendEl.textContent = `No validated issues ${periodLabel}`;
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
        labels: data.labels,
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
        labels: data.labels,
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
            backgroundColor: '#eab308',
            borderRadius: 4,
          },
          {
            label: 'Medium',
            data: priorityTrends.medium,
            backgroundColor: '#3b82f6',
            borderRadius: 4,
          },
          {
            label: 'Low',
            data: priorityTrends.low,
            backgroundColor: '#22c55e',
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
  /* No `> 0` filter any more. avgResolutionTime now contains an entry only for
     categories that actually have a resolved report, so presence is the test —
     the old filter silently dropped any category resolved in under half an
     hour, because the value had already been rounded to 0. */
  const sortedEntries = Object.entries(avgResolutionTime)
    .sort((a, b) => b[1] - a[1]);

  // If no resolved issues, show placeholder
  const entries = sortedEntries.length > 0
    ? sortedEntries
    : Object.keys(CATEGORY_COLORS).map(k => [k, 0]);

  const labels = entries.map(([k]) => getCategoryLabel(k));
  /* Two decimals, not whole hours: a report resolved in two minutes is 0.04,
     and rounding it to 0 is exactly the mistake this chart used to make. The
     bar will be a sliver, which is the honest picture. */
  const chartData = entries.map(([, v]) => Number(v.toFixed(2)));
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
  const targetData = data.labels.map(() => 90);

  chartInstances.aiAccuracy = new Chart(
    document.getElementById('chartAiAccuracy'),
    {
      type: 'line',
      data: {
        labels: data.labels,
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

/* ---------- Summary per Date ----------

   One row per calendar day that received reports: how many, how they split by
   priority, the most common category, and how many of that day's reports are
   still open. Clicking a day lists its reports.

   Independent of the Weekly / Monthly toggle. That toggle only covers the
   CURRENT week or month, so a past date could never be reached through it;
   this card carries its own From / To range instead.

   Days are bucketed with localDateKey(), in the viewer's timezone rather than
   UTC. The UTC date would file a report submitted at 7am in Manila under the
   previous day. */

const DAILY_DEFAULT_SPAN_DAYS = 30;
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

let dailyRange = null;            // { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
const expandedDays = new Set();   // kept across re-renders, so the 30s refresh does not collapse an open day

function shiftDateKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return localDateKey(new Date(y, m - 1, d + days));
}

/* Parsed as a LOCAL date. new Date('2026-08-24') is read as UTC midnight and
   would render as the 23rd for anyone west of Greenwich. */
function dateFromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDayLabel(key) {
  return dateFromKey(key).toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function daysInclusive(fromKey, toKey) {
  return Math.round((dateFromKey(toKey) - dateFromKey(fromKey)) / 86400000) + 1;
}

function countCell(n, extraClass = '') {
  return n === 0
    ? '<td class="num day-zero">0</td>'
    : `<td class="num ${extraClass}">${n}</td>`;
}

function summariseDay(dayIssues) {
  const byPriority = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategory = {};
  let open = 0;
  for (const issue of dayIssues) {
    if (byPriority[issue.aiPriorityLevel] !== undefined) byPriority[issue.aiPriorityLevel]++;
    const cat = issue.aiCategory || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (issue.status !== 'resolved') open++;
  }
  /* Most frequent category. Ties are broken alphabetically so the same data
     always shows the same answer, not whichever report happened to load first. */
  const ranked = Object.entries(byCategory).sort((a, b) =>
    b[1] - a[1] || getCategoryLabel(a[0]).localeCompare(getCategoryLabel(b[0])));
  return { byPriority, ranked, open };
}

function renderDayDetail(dayIssues) {
  const sorted = [...dayIssues].sort((a, b) =>
    PRIORITY_ORDER.indexOf(a.aiPriorityLevel) - PRIORITY_ORDER.indexOf(b.aiPriorityLevel)
    || new Date(a.submittedAt) - new Date(b.submittedAt));

  const items = sorted.map(issue => {
    const level = PRIORITY_ORDER.includes(issue.aiPriorityLevel) ? issue.aiPriorityLevel : '';
    const levelLabel = level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Unscored';
    const status = STATUS_LIST.find(st => st.id === issue.status);
    const time = new Date(issue.submittedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    return `
      <li class="day-detail-item">
        <span class="day-detail-id">${escapeHtml(issue.ticketNumber || String(issue.id).slice(0, 8))}</span>
        <span class="priority-badge ${level}"><span class="priority-dot ${level}"></span> ${escapeHtml(levelLabel)}</span>
        <span class="day-detail-text">${escapeHtml(issue.text || '')}
          <small>${escapeHtml(issue.storeName || 'Unknown store')} · ${escapeHtml(getCategoryLabel(issue.aiCategory))} · ${escapeHtml(time)}</small>
        </span>
        <span>${escapeHtml(status ? status.label : (issue.status || ''))}</span>
      </li>`;
  }).join('');

  return `<ul class="day-detail-list">${items}</ul>`;
}

function renderDailySummary(allIssues) {
  const body = document.getElementById('dailySummaryBody');
  const foot = document.getElementById('dailySummaryFoot');
  const wrap = document.getElementById('dailySummaryTableWrap');
  const empty = document.getElementById('dailySummaryEmpty');
  const label = document.getElementById('dailySummaryRangeLabel');
  if (!body || !foot || !wrap || !empty || !label || !dailyRange) return;

  const { from, to } = dailyRange;

  const groups = new Map();
  for (const issue of allIssues || []) {
    const key = localDateKey(issue.submittedAt);
    if (!key || key < from || key > to) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }

  const totalDays = daysInclusive(from, to);
  const days = [...groups.keys()].sort().reverse();   // newest first

  if (days.length === 0) {
    wrap.hidden = true;
    empty.hidden = false;
    label.textContent = 'Reports submitted each day';

    const latest = (allIssues || [])
      .map(i => localDateKey(i.submittedAt))
      .filter(Boolean)
      .sort()
      .pop();

    empty.innerHTML = `
      <div>No reports were submitted between ${escapeHtml(formatDayLabel(from))} and ${escapeHtml(formatDayLabel(to))}.</div>
      ${latest ? `<button type="button" class="btn btn-secondary btn-sm" id="dailyJumpLatest">Show the ${DAILY_DEFAULT_SPAN_DAYS} days up to the latest report (${escapeHtml(formatDayLabel(latest))})</button>` : ''}`;

    const jump = document.getElementById('dailyJumpLatest');
    if (jump) {
      jump.addEventListener('click', () => {
        setDailyRange(shiftDateKey(latest, -(DAILY_DEFAULT_SPAN_DAYS - 1)), latest);
        renderDailySummary(allIssues);
      });
    }
    return;
  }

  wrap.hidden = false;
  empty.hidden = true;
  label.textContent = `${days.length} of ${totalDays} day${totalDays === 1 ? '' : 's'} had reports`;

  const totals = { reports: 0, critical: 0, high: 0, medium: 0, low: 0, open: 0 };

  body.innerHTML = days.map(key => {
    const dayIssues = groups.get(key);
    const { byPriority, ranked, open } = summariseDay(dayIssues);

    totals.reports += dayIssues.length;
    totals.open += open;
    PRIORITY_ORDER.forEach(p => { totals[p] += byPriority[p]; });

    const [topCat, topCount] = ranked[0];
    const breakdown = ranked.map(([c, n]) => `${getCategoryLabel(c)}: ${n}`).join(', ');
    const isOpen = expandedDays.has(key);

    return `
      <tr class="day-row" data-day="${key}" tabindex="0" aria-expanded="${isOpen}">
        <td><span class="day-date"><span class="day-chevron" aria-hidden="true">›</span>${escapeHtml(formatDayLabel(key))}</span></td>
        <td class="num day-count-total">${dayIssues.length}</td>
        ${countCell(byPriority.critical, 'day-count-critical')}
        ${countCell(byPriority.high, 'day-count-high')}
        ${countCell(byPriority.medium)}
        ${countCell(byPriority.low)}
        <td class="day-top-category" title="${escapeHtml(breakdown)}">${escapeHtml(getCategoryLabel(topCat))} <small>(${topCount})</small></td>
        ${countCell(open, 'day-open-some')}
      </tr>
      <tr class="day-detail" data-detail-for="${key}"${isOpen ? '' : ' hidden'}>
        <td colspan="8">${isOpen ? renderDayDetail(dayIssues) : ''}</td>
      </tr>`;
  }).join('');

  foot.innerHTML = `
    <tr>
      <td>Total · ${days.length} day${days.length === 1 ? '' : 's'}</td>
      <td class="num">${totals.reports}</td>
      <td class="num">${totals.critical}</td>
      <td class="num">${totals.high}</td>
      <td class="num">${totals.medium}</td>
      <td class="num">${totals.low}</td>
      <td></td>
      <td class="num">${totals.open}</td>
    </tr>`;

  const toggle = (row) => {
    const key = row.dataset.day;
    const detail = body.querySelector(`tr[data-detail-for="${key}"]`);
    if (!detail) return;
    const opening = row.getAttribute('aria-expanded') !== 'true';
    row.setAttribute('aria-expanded', String(opening));
    if (opening) {
      expandedDays.add(key);
      /* Built on first open only. A month of days should not render every
         report up front just to keep them hidden. */
      detail.firstElementChild.innerHTML = renderDayDetail(groups.get(key));
      detail.hidden = false;
    } else {
      expandedDays.delete(key);
      detail.hidden = true;
    }
  };

  body.querySelectorAll('tr.day-row').forEach(row => {
    row.addEventListener('click', () => toggle(row));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(row); }
    });
  });
}

function setDailyRange(from, to) {
  dailyRange = { from, to };
  const fromEl = document.getElementById('dailyFrom');
  const toEl = document.getElementById('dailyTo');
  if (fromEl) fromEl.value = from;
  if (toEl) toEl.value = to;
}

function initDailySummary() {
  const fromEl = document.getElementById('dailyFrom');
  const toEl = document.getElementById('dailyTo');
  if (!fromEl || !toEl) return;

  const today = localDateKey();
  setDailyRange(shiftDateKey(today, -(DAILY_DEFAULT_SPAN_DAYS - 1)), today);

  const onChange = (changed) => {
    let from = fromEl.value;
    let to = toEl.value;
    if (!from || !to) return;   // a half-cleared input is mid-edit, not a request
    /* Keep the range valid by moving the OTHER end, so the date the admin
       just picked is the one that sticks. */
    if (from > to) {
      if (changed === 'from') to = from; else from = to;
    }
    setDailyRange(from, to);
    // Re-renders from the data already on the page. No refetch per change.
    if (lastRender) renderDailySummary(lastRender.allIssues);
  };

  fromEl.addEventListener('change', () => onChange('from'));
  toEl.addEventListener('change', () => onChange('to'));
}

/* ---------- Render Everything ---------- */

async function renderAll() {
  destroyAllCharts();

  // Fetch live data from Supabase
  const allIssues = await loadIssues();
  const data = activeRange === 'monthly'
    ? aggregateMonthlyData(allIssues)
    : aggregateWeeklyData(allIssues);

  // Set labels based on range (weekly uses DAY_LABELS, monthly uses day-of-month)
  if (!data.labels) {
    data.labels = DAY_LABELS;
  }

  /* Both aggregators name the range-filtered set `weekIssues`, monthly
     included — it is `weekIssues: monthIssues` there. Renamed on the way out
     so the export does not inherit a misleading name. */
  lastRender = { rangeIssues: data.weekIssues, allIssues };

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

  /* Last, and isolated: a fault in the per-date table must not take down the
     charts and KPIs above it, which were working before it existed. */
  try {
    renderDailySummary(allIssues);
  } catch (err) {
    console.error('Summary per date failed to render:', err);
  }
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

/* ---------- Export Buttons ----------

   Both of these used to be a showToast() and nothing else — they announced
   "Report exported as PDF" / "Data exported as CSV" and produced no file at
   all. Claiming an outcome that did not happen is worse than having no button,
   so they now do the thing they say.

   CSV exports the underlying REPORT ROWS rather than the chart summaries. The
   charts are already on screen; what is not obtainable anywhere in the app is
   the per-report data behind them — which reviewer changed which priority,
   whether the model or a keyword rule scored it. Until now the only route to
   that was the SQL editor.

   There is no PDF export. One was built and removed on 2026-08-19: Chart.js
   puts its values in hover tooltips, so a printed chart is a doughnut with no
   percentages and a trend line with no numbers — shapes without data, which is
   not a report. Doing it properly means print-only tables carrying the figures
   beside each chart. Until that exists, CSV is the honest export.

   The @media print block in css/admin.css was kept. It is not left over from
   this: browsers print these pages whether or not a button invites them to,
   and without it the output is a sidebar eating a quarter of every page with
   the priority badges stripped of colour.
   ============================================================ */

/* Columns chosen for analysis, not for display. Provenance is included
   because it is the difference between "the model judged this" and "the model
   was unreachable and a keyword rule guessed".

   contact_person and phone_number are deliberately EXCLUDED. They are
   personal information under RA 10173, an exported file travels further than
   a screen does, and no analysis of classifier behaviour needs them. */
const CSV_COLUMNS = [
  ['ticket_number', i => i.ticketNumber],
  ['submitted_at', i => i.submittedAt],
  ['updated_at', i => i.updatedAt],
  ['store_name', i => i.storeName],
  ['report_text', i => i.text],
  ['tenant_category', i => i.category],
  ['ai_category', i => i.aiCategory],
  ['ai_confidence', i => i.aiConfidence],
  ['ai_priority_level', i => i.aiPriorityLevel],
  ['ai_severity_index', i => i.aiPriority],
  ['ai_priority_source', i => i.aiPrioritySource],
  ['ai_safety_terms', i => i.aiSafetyTerms],
  ['model_priority_before_floor', i => i.aiModelPriority],
  ['priority_before_human_override', i => i.preOverridePriorityLevel],
  ['validated', i => i.validated],
  ['overridden', i => i.overridden],
  ['override_notes', i => i.overrideNotes],
  ['status', i => i.status],
  ['text_edited_at', i => i.textEditedAt],
  /* Empty on reports resolved before migration_006 added the column — those
     rows fall back to updated_at for the hours below, and the blank is how you
     tell a measured resolution from an inferred one. */
  ['resolved_at', i => i.resolvedAt],
  /* Same helper the charts use, so the file and the page cannot disagree. */
  ['resolution_hours', i => {
    const h = resolutionHoursFor(i);
    return h === null ? '' : h.toFixed(2);
  }],
];

/**
 * One CSV field, RFC 4180 quoted.
 *
 * Also defuses CSV injection. Report text is written by tenants, and a field
 * beginning = + - or @ is executed as a formula when the file is opened in
 * Excel or Sheets. Prefixing an apostrophe makes it inert text; the leading
 * quote is visible in a spreadsheet cell but the alternative is a document
 * that runs a stranger's input on the reviewer's machine.
 */
function csvField(value) {
  if (value === null || value === undefined) return '""';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

function buildCSV(issues) {
  const header = CSV_COLUMNS.map(([name]) => csvField(name)).join(',');
  const rows = issues.map(
    issue => CSV_COLUMNS.map(([, read]) => csvField(read(issue))).join(','));
  return [header, ...rows].join('\r\n');
}

/** Hand the browser a file. Revoking on the next tick rather than immediately:
    Safari has not started reading the blob when click() returns. */
function downloadFile(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initExportButtons() {
  document.getElementById('exportCsv').addEventListener('click', () => {
    /* Exports what is on screen. The range buttons filter the page, and an
       export that quietly disagreed with the charts above it would be worse
       than no export. */
    const issues = lastRender?.rangeIssues;
    if (!issues || issues.length === 0) {
      showToast('Nothing to export for this period.', 'warning');
      return;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    /* Excel reads a CSV as the system codepage unless a BOM says otherwise,
       which turns Taglish text with ñ or accents into mojibake. */
    downloadFile(
      `firs-reports-${activeRange}-${stamp}.csv`,
      'text/csv;charset=utf-8;',
      '﻿' + buildCSV(issues));

    showToast(`Exported ${issues.length} report${issues.length === 1 ? '' : 's'} as CSV`, 'success');
  });

}

/* ---------- Mobile Sidebar Toggle ---------- */

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

  // No topbar personalisation: analytics.html has no .topbar-user block, so
  // this was already a no-op, and the other admin pages now show a static role
  // pill instead of initials.
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
  initDailySummary();
  initSidebarToggle();
  await renderAll();
});
