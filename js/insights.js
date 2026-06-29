// Pure functions that turn a list of feeding entries into KPIs and trends.
// Kept separate from the UI so it's easy to reason about and tweak.

import { REACTION_BY_VALUE, reactionScore, foodLabel } from './data.js';

// "Acceptance" = did she actually eat it? We treat picky-or-better as accepted.
const ACCEPTED = new Set(['loved', 'ate', 'picky']);
export function isAccepted(reactionValue) {
  return ACCEPTED.has(reactionValue);
}

export function summarize(entries) {
  const total = entries.length;
  const withInitial = entries.filter(e => e.initial_reaction);
  const accepted = withInitial.filter(e => isAccepted(e.initial_reaction)).length;

  const avgInitial = avg(withInitial.map(e => reactionScore(e.initial_reaction)));

  return {
    total,
    accepted,
    refused: withInitial.length - accepted,
    acceptanceRate: withInitial.length ? accepted / withInitial.length : null,
    avgInitialScore: avgInitial,
    lastFed: entries.length ? entries[0].fed_at : null,
  };
}

// Per-food rollup: how she rates each food, and crucially whether the long-term
// reaction drifts from the first impression (the picky-eater money question).
export function perFood(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = e.food_label || foodLabel({ brand: e.food_brand, name: e.food_name });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const rows = [];
  for (const [label, list] of groups) {
    const initials = list.map(e => reactionScore(e.initial_reaction)).filter(n => n != null);
    const longterms = list.map(e => reactionScore(e.longterm_reaction)).filter(n => n != null);
    const avgInit = avg(initials);
    const avgLong = avg(longterms);
    rows.push({
      label,
      count: list.length,
      avgInitial: avgInit,
      avgLongterm: avgLong,
      // Negative drift = she liked it at first but cooled on it over time.
      drift: avgLong != null && avgInit != null ? avgLong - avgInit : null,
      acceptance: rate(list.map(e => e.initial_reaction)),
    });
  }
  return rows.sort((a, b) => (b.avgInitial ?? -1) - (a.avgInitial ?? -1));
}

// Counts of each reaction value, for a breakdown bar.
export function reactionBreakdown(entries, field = 'initial_reaction') {
  const counts = {};
  for (const e of entries) {
    const v = e[field];
    if (v) counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([value, count]) => ({ value, count, meta: REACTION_BY_VALUE[value] }))
    .sort((a, b) => (b.meta?.score ?? 0) - (a.meta?.score ?? 0));
}

// Acceptance rate bucketed by week, oldest → newest, for the trend chart.
export function acceptanceTrend(entries) {
  const byWeek = new Map();
  for (const e of entries) {
    if (!e.initial_reaction) continue;
    const wk = weekStart(new Date(e.fed_at));
    if (!byWeek.has(wk)) byWeek.set(wk, { total: 0, accepted: 0 });
    const b = byWeek.get(wk);
    b.total++;
    if (isAccepted(e.initial_reaction)) b.accepted++;
  }
  return [...byWeek.entries()]
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([wk, b]) => ({ week: wk, rate: b.accepted / b.total, total: b.total }));
}

// ── helpers ──
function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function rate(reactionValues) {
  const valid = reactionValues.filter(Boolean);
  if (!valid.length) return null;
  return valid.filter(isAccepted).length / valid.length;
}
function weekStart(d) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
