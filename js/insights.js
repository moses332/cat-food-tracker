// Pure functions that turn a list of feeding entries into KPIs and trends.
// Kept separate from the UI so it's easy to reason about and tweak.

import { REACTION_BY_VALUE, foodLabel, ratingOf, SCORE_MIN, SCORE_MAX } from './data.js';

// "Acceptance" = did she actually eat any of it? Nibbled or Liked counts.
export function isAccepted(rating) {
  return rating != null && rating >= 2;
}

export function summarize(entries) {
  const total = entries.length;
  const withInitial = entries.filter(e => ratingOf(e) != null);
  const accepted = withInitial.filter(e => isAccepted(ratingOf(e))).length;

  const avgInitial = avg(withInitial.map(ratingOf));

  return {
    total,
    accepted,
    refused: withInitial.length - accepted,
    acceptanceRate: withInitial.length ? accepted / withInitial.length : null,
    avgInitialScore: avgInitial,
    lastFed: entries.length ? entries[0].fed_at : null,
  };
}

// Per-food rollup: how she rates each food on average, and how often she
// accepts it. Sorted best-liked first for the leaderboard.
export function perFood(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = entryKey(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const rows = [];
  for (const [label, list] of groups) {
    const ratings = list.map(ratingOf).filter(n => n != null);
    rows.push({
      label,
      brand: list[0].food_brand,
      name: list[0].food_name,
      count: list.length,
      rated: ratings.length,
      lastFed: list.reduce((m, e) => (e.fed_at > m ? e.fed_at : m), ''),
      avgInitial: avg(ratings),
      acceptance: rate(list.map(ratingOf)),
    });
  }
  return rows.sort((a, b) => (b.avgInitial ?? -1) - (a.avgInitial ?? -1));
}

// ── Moving windows ─────────────────────────────────────────────────────────
export const WINDOWS = [
  { value: 'week',  label: 'Week',     days: 7 },
  { value: 'month', label: 'Month',    days: 30 },
  { value: '3mo',   label: '3 months', days: 90 },
  { value: 'all',   label: 'All',      days: null },
];

export function inWindow(entries, windowValue, now = Date.now()) {
  const w = WINDOWS.find(x => x.value === windowValue);
  if (!w || w.days == null) return entries;
  const since = now - w.days * DAY;
  return entries.filter(e => new Date(e.fed_at).getTime() >= since);
}

// Preference leaderboard. Ranked by a "fair" score: each food's average
// rating is blended with her overall average, weighted as if it had
// PRIOR_WEIGHT extra feedings. So one lucky "Loved it" doesn't outrank a
// food she's loved ten times. The displayed number is still the plain average.
const PRIOR_WEIGHT = 2;
export function preferenceBoard(entries) {
  const overall = avg(entries.map(ratingOf).filter(n => n != null)) ?? MID;
  return perFood(entries)
    .filter(f => f.avgInitial != null)
    .map(f => ({ ...f, rank: (f.avgInitial * f.rated + overall * PRIOR_WEIGHT) / (f.rated + PRIOR_WEIGHT) }))
    .sort((a, b) => b.rank - a.rank || b.count - a.count);
}

// Most-fed leaderboard: count in the window, ties → most recently fed.
export function frequencyBoard(entries) {
  const total = entries.length;
  return perFood(entries)
    .map(f => ({ ...f, share: total ? f.count / total : 0 }))
    .sort((a, b) => b.count - a.count || new Date(b.lastFed) - new Date(a.lastFed));
}

// Suggested next feeds: foods she's eaten before, not in the last
// `skipDays`, ranked by how much she likes them lately plus a small nudge
// for variety the longer it's been.
//   liking  = her ratings, each weighted by recency (half-life 30 days),
//             blended with her overall average (1 feeding's worth)
//   variety = up to +0.3 for 14+ days since she last had it
export function suggestions(entries, { now = Date.now(), skipDays = 2, limit = 10 } = {}) {
  // Variety bonus is 7.5% of the rating range (0.15 on the 1–3 scale).
  const HALF_LIFE = 30, VARIETY_MAX = 0.075 * (SCORE_MAX - SCORE_MIN), VARIETY_DAYS = 14;
  const rated = entries.filter(e => ratingOf(e) != null);
  const overall = avg(rated.map(ratingOf)) ?? MID;

  const foods = new Map();
  for (const e of entries) {
    const key = entryKey(e);
    const f = foods.get(key) || { label: key, brand: e.food_brand, name: e.food_name, last: 0, wSum: 0, wScore: 0, count: 0 };
    const t = new Date(e.fed_at).getTime();
    f.count++;
    if (t > f.last) f.last = t;
    const r = ratingOf(e);
    if (r != null) {
      const w = Math.pow(0.5, Math.max(0, now - t) / DAY / HALF_LIFE);
      f.wSum += w;
      f.wScore += w * r;
    }
    foods.set(key, f);
  }

  return [...foods.values()]
    .filter(f => now - f.last >= skipDays * DAY)
    .map(f => {
      const daysSince = (now - f.last) / DAY;
      const liking = (f.wScore + overall) / (f.wSum + 1);
      const variety = Math.min(daysSince, VARIETY_DAYS) / VARIETY_DAYS * VARIETY_MAX;
      const recentAvg = f.wSum ? f.wScore / f.wSum : null;
      return { ...f, daysSince, liking, recentAvg, score: liking + variety };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Counts of each reaction value, for a breakdown bar.
export function reactionBreakdown(entries) {
  const counts = {};
  for (const e of entries) {
    const v = ratingOf(e);
    if (v) counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count, meta: REACTION_BY_VALUE[value] }))
    .sort((a, b) => (b.meta?.score ?? 0) - (a.meta?.score ?? 0));
}

// Acceptance rate bucketed by week, oldest → newest, for the trend chart.
export function acceptanceTrend(entries) {
  const byWeek = new Map();
  for (const e of entries) {
    if (ratingOf(e) == null) continue;
    const wk = weekStart(new Date(e.fed_at));
    if (!byWeek.has(wk)) byWeek.set(wk, { total: 0, accepted: 0 });
    const b = byWeek.get(wk);
    b.total++;
    if (isAccepted(ratingOf(e))) b.accepted++;
  }
  return [...byWeek.entries()]
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([wk, b]) => ({ week: wk, rate: b.accepted / b.total, total: b.total }));
}

// ── helpers ──
const DAY = 86400000;
const MID = (SCORE_MIN + SCORE_MAX) / 2; // neutral rating when there's no data yet
function entryKey(e) {
  return e.food_label || foodLabel({ brand: e.food_brand, name: e.food_name });
}
function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function rate(ratings) {
  const valid = ratings.filter(n => n != null);
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
