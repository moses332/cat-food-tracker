// UI controller. Owns DOM rendering + events; all persistence goes through
// `store`, all number-crunching through `insights`.

import { store, initStore, getFoodCatalog, syncMode } from './store.js';
import { REACTIONS, REACTION_BY_VALUE, foodLabel } from './data.js';
import * as insights from './insights.js';
import { startScan, stopScan } from './scanner.js';
import {
  normalizeFood, parseProductTitle, splitName, groupLabel,
  matchesQuery, foodKey, linesFor, KNOWN_BRANDS,
} from './foods.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  pets: [],
  activePetId: null,
  catalog: [],
  entries: [],
  barcodes: [],
  lastAddedId: null, // entry to highlight after a save
  user: null,        // signed-in user (shared mode only)
  prefWindow: 'month', // Favorites leaderboard window
  freqWindow: 'month', // Most-fed leaderboard window
};

let entryPicker = null; // food picker inside the New feeding form

// ── Boot ────────────────────────────────────────────────────────────────────
init();

async function init() {
  const mode = await initStore();
  renderModeBadge(mode);
  wireTabs();
  wireHistoryTab();
  wirePetsTab();

  // Debug hook: lets tests drive flows without a physical camera.
  window.__pp = { resolveBarcode, openScanModal, openEntryModal, state, get entryPicker() { return entryPicker; } };

  // Shared mode requires sign-in; local mode has no accounts.
  if (requiresAuth()) {
    state.user = await store.getUser();
    if (!state.user) { showLoginGate(); return; } // gate resumes into startApp()
  }
  await startApp();
}

async function startApp() {
  hideLoginGate();
  await refreshAll();
  renderAccount();
  if (state.user && !state.user.user_metadata?.name) openNameModal();
}

function requiresAuth() { return syncMode() === 'shared'; }
function userName(u) { return u?.user_metadata?.name || (u?.email || '').split('@')[0] || 'Someone'; }

async function refreshAll() {
  state.pets = await store.getPets();
  if (!state.activePetId || !state.pets.some(p => p.id === state.activePetId)) {
    state.activePetId = state.pets[0]?.id ?? null;
  }
  state.catalog = await getFoodCatalog();
  state.barcodes = await store.getBarcodes();
  state.entries = state.activePetId ? await store.getEntries(state.activePetId) : [];

  renderPetSwitcher();
  renderHistory();
  renderInsights();
  renderPetList();
  renderDataLocation();
}

// ── Header: sync badge + pet switcher ────────────────────────────────────────
function renderModeBadge(mode) {
  const badge = $('#modeBadge');
  badge.textContent = mode === 'shared' ? '☁ Shared' : '📵 Local';
  badge.title = mode === 'shared'
    ? 'Synced across devices via Supabase'
    : 'Stored on this device only — see README to turn on sharing';
}

function renderPetSwitcher() {
  const wrap = $('#petSwitcherWrap');
  if (!state.pets.length) {
    wrap.textContent = 'No pets yet — add one in 🐾';
    return;
  }
  wrap.innerHTML = '';
  const sel = document.createElement('select');
  sel.id = 'petSwitcher';
  for (const p of state.pets) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${avatarFor(p)} ${p.name}`;
    if (p.id === state.activePetId) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', async () => {
    state.activePetId = sel.value;
    state.entries = await store.getEntries(state.activePetId);
    renderHistory();
    renderInsights();
    renderPetList();
  });
  wrap.appendChild(sel);
}

// ── Auth gate (passwordless email code) ──────────────────────────────────────
function showLoginGate() {
  const gate = $('#authGate');
  gate.innerHTML = `
    <div class="auth-card card">
      <div class="auth-brand"><span class="brand-emoji">🐱</span><h1>Picky Paws</h1></div>
      <p class="muted">Sign in to see Sybil's log.</p>
      <div id="authStep"></div>
      <p class="auth-foot"><a href="help.html">Need help signing in?</a></p>
    </div>`;
  gate.hidden = false;
  renderEmailStep();
}
function hideLoginGate() {
  const gate = $('#authGate');
  gate.hidden = true;
  gate.innerHTML = '';
}

function renderEmailStep(prefill = '') {
  $('#authStep').innerHTML = `
    <label class="field"><span>Your email</span>
      <input id="authEmail" type="email" inputmode="email" autocomplete="email"
             value="${escapeAttr(prefill)}" placeholder="you@example.com" /></label>
    <button type="button" class="primary-btn" id="authSend">Email me a code</button>
    <p class="auth-msg" id="authMsg"></p>`;
  $('#authEmail').focus();
  $('#authSend').addEventListener('click', sendLoginCode);
  $('#authEmail').addEventListener('keydown', e => { if (e.key === 'Enter') sendLoginCode(); });
}

async function sendLoginCode() {
  const email = $('#authEmail').value.trim().toLowerCase();
  if (!email) { $('#authEmail').focus(); return; }
  const btn = $('#authSend');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await store.sendCode(email);
    renderCodeStep(email);
  } catch (err) {
    authError(err?.message || "Couldn't send a code. Is your email on the guest list?");
    btn.disabled = false; btn.textContent = 'Email me a code';
  }
}

function renderCodeStep(email) {
  $('#authStep').innerHTML = `
    <p class="muted">We emailed a 6-digit code to <strong>${escapeHtml(email)}</strong>.</p>
    <label class="field"><span>Code</span>
      <input id="authCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Enter the code" /></label>
    <button type="button" class="primary-btn" id="authVerify">Sign in</button>
    <button type="button" class="ghost-btn" id="authBack">Use a different email</button>
    <p class="auth-msg" id="authMsg"></p>`;
  $('#authCode').focus();
  $('#authVerify').addEventListener('click', () => verifyLoginCode(email));
  $('#authCode').addEventListener('keydown', e => { if (e.key === 'Enter') verifyLoginCode(email); });
  $('#authBack').addEventListener('click', () => renderEmailStep(email));
}

async function verifyLoginCode(email) {
  const token = $('#authCode').value.trim();
  if (!token) { $('#authCode').focus(); return; }
  const btn = $('#authVerify');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    state.user = await store.verifyCode(email, token);
    await startApp();
  } catch {
    authError("That code didn't work — double-check it, or go back and resend.");
    btn.disabled = false; btn.textContent = 'Sign in';
  }
}

function authError(msg) { const el = $('#authMsg'); if (el) el.textContent = msg; }

// Account card (Pets tab): who's signed in, change name, sign out.
function renderAccount() {
  const card = $('#accountCard');
  const box = $('#accountBox');
  if (!card || !box) return;
  if (!requiresAuth() || !state.user) { card.hidden = true; return; }
  card.hidden = false;
  box.innerHTML = `
    <p class="muted">Signed in as <strong>${escapeHtml(userName(state.user))}</strong><br>${escapeHtml(state.user.email)}</p>
    <div class="btn-row">
      <button type="button" class="ghost-btn" id="acctName">Change name</button>
      <button type="button" class="ghost-btn" id="acctOut">Sign out</button>
    </div>`;
  $('#acctName').addEventListener('click', openNameModal);
  $('#acctOut').addEventListener('click', signOut);
}

function openNameModal() {
  openModal(`
    <h2>What should we call you?</h2>
    <p class="muted">This name shows on feedings you log.</p>
    <label class="field"><span>Your name</span>
      <input id="dn_name" value="${escapeAttr(state.user?.user_metadata?.name || '')}" placeholder="e.g. Pat" /></label>
    <div class="btn-row">
      <button type="button" class="primary-btn" id="dn_save">Save</button>
      <button type="button" class="ghost-btn" id="dn_skip">Skip</button>
    </div>`);
  $('#dn_skip').addEventListener('click', closeModal);
  $('#dn_save').addEventListener('click', async () => {
    const name = $('#dn_name').value.trim();
    if (!name) { $('#dn_name').focus(); return; }
    try { state.user = await store.setDisplayName(name); } catch { /* keep going */ }
    closeModal();
    renderAccount();
  });
}

async function signOut() {
  if (!confirm('Sign out?')) return;
  await store.signOut();
  state.user = null;
  location.reload(); // cleanest reset → login gate reappears
}

// ── New-feeding modal ─────────────────────────────────────────────────────────
function wireHistoryTab() {
  $('#newEntryBtn').addEventListener('click', () => openEntryModal());
  $('#entryBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'entryBackdrop') closeEntryModal();
  });
}

// `preselect` (optional): a { brand, name } food to start with, e.g. from a suggestion.
async function openEntryModal(preselect) {
  if (!state.activePetId) {
    toast('Add a pet first (🐾 Pets tab).', true);
    return;
  }
  $('#entryBox').innerHTML = `
    <div class="modal-head">
      <h2>New feeding</h2>
      <button type="button" class="icon-btn close-x" id="entryClose" title="Close">✕</button>
    </div>
    <form id="entryForm">
      <div class="field">
        <span>Food</span>
        <button type="button" id="scanBtn" class="scan-btn">📷 Scan a can</button>
        <div id="foodPicker"></div>
      </div>

      <fieldset class="field">
        <legend>Reaction <small>(how did she take to it?)</small></legend>
        <div class="reaction-grid" id="entryReactions"></div>
      </fieldset>

      <label class="field">
        <span>Time fed</span>
        <input type="datetime-local" id="fedAt" required />
      </label>

      <label class="field">
        <span>Notes <small>(optional)</small></span>
        <textarea id="notes" rows="2" placeholder="e.g. ate around the gravy, only the chunks…"></textarea>
      </label>

      <button type="submit" class="primary-btn">Save feeding</button>
    </form>`;

  buildReactionGrid('#entryReactions', 'reaction');
  entryPicker = mountFoodPicker($('#foodPicker'), {
    onAddNew: (query) => openAddFoodModal(query),
  });
  if (preselect?.name) {
    const food = await ensureFood(normalizeFood(preselect));
    entryPicker?.select(food);
  }
  $('#fedAt').value = toLocalInput(new Date());

  $('#entryClose').addEventListener('click', closeEntryModal);
  $('#scanBtn').addEventListener('click', openScanModal);
  $('#entryForm').addEventListener('submit', submitEntry);

  $('#entryBackdrop').hidden = false;
}

function closeEntryModal() {
  stopScan();
  entryPicker = null;
  $('#entryBackdrop').hidden = true;
  $('#entryBox').innerHTML = '';
}

async function submitEntry(e) {
  e.preventDefault();
  const food = entryPicker?.get();
  if (!food) { toast('Pick a food.', true); return; }
  const reaction = $('input[name="reaction"]:checked')?.value || null;
  if (!reaction) { toast('Pick a reaction.', true); return; }

  const row = await store.addEntry({
    pet_id: state.activePetId,
    food_brand: food.brand || '',
    food_name: food.name,
    food_label: foodLabel(food),
    initial_reaction: reaction,   // single rating (column kept for back-compat)
    longterm_reaction: null,
    fed_at: fromLocalInput($('#fedAt').value).toISOString(),
    notes: $('#notes').value.trim(),
    created_by: state.user?.id ?? null,
    created_by_name: state.user ? userName(state.user) : null,
  });

  closeEntryModal();
  state.lastAddedId = row?.id ?? null;
  goToTab('history');
  state.entries = await store.getEntries(state.activePetId);
  renderHistory();   // highlights the freshly-added row
  renderInsights();
}

// Single reaction picker used by both the new-feeding and edit modals.
function buildReactionGrid(hostSel, group, selected) {
  $(hostSel).innerHTML = REACTIONS.map(r => `
    <label title="${r.hint}">
      <input type="radio" name="${group}" value="${r.value}" ${r.value === selected ? 'checked' : ''}/>
      <span class="emoji">${r.emoji}</span>
      <span class="name">${r.label}</span>
    </label>`).join('');
}

// Re-renders the New-feeding picker after the catalog changes.
function renderFoodSelect() {
  entryPicker?.refresh();
}

// ── Food picker (search-as-you-type) ─────────────────────────────────────────
// Replaces the old <select>. Shows "Recently fed" first, then every food
// grouped by brand · line. Typing filters instantly; Enter picks the top hit.
// Returns { get(), select(food), refresh() }.
function mountFoodPicker(host, { onPick, onAddNew, compact = false } = {}) {
  let chosen = null;
  host.innerHTML = `
    <div class="picker${compact ? ' compact' : ''}">
      <div class="picker-chosen" hidden>
        <div class="picker-chosen-text"></div>
        <button type="button" class="link-btn picker-change">Change</button>
      </div>
      <div class="picker-search">
        <input type="search" class="picker-input" placeholder="Search foods — e.g. salmon, pâté, gravy"
               autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done" />
        <div class="picker-list" role="listbox"></div>
      </div>
    </div>`;
  const input = $('.picker-input', host);
  const list = $('.picker-list', host);

  function render() {
    const q = input.value.trim();
    const stats = foodStats();
    const hits = state.catalog.filter(f => matchesQuery(f, q));
    let html = '';

    if (!q) {
      const recent = recentFoods(5);
      if (recent.length) {
        html += `<div class="picker-group">Recently fed</div>` +
          recent.map(f => pickerItem(f, stats, true)).join('');
      }
    }
    let lastGroup = null;
    for (const f of hits) {
      const g = groupLabel(f);
      if (g !== lastGroup) { html += `<div class="picker-group">${escapeHtml(g)}</div>`; lastGroup = g; }
      html += pickerItem(f, stats, false);
    }
    if (!hits.length) {
      html += `<div class="picker-empty">No food matches “${escapeHtml(q)}”.</div>`;
    }
    if (onAddNew) {
      html += `<button type="button" class="picker-add" data-add>＋ Add ${q ? `“${escapeHtml(q)}”` : 'a new food'}</button>`;
    }
    list.innerHTML = html;
  }

  function pick(food) {
    chosen = food;
    $('.picker-chosen-text', host).innerHTML = food
      ? `<div class="pc-name">${escapeHtml(splitName(food.name).flavor)}</div>
         <div class="pc-sub">${escapeHtml(groupLabel(food))}</div>` : '';
    $('.picker-chosen', host).hidden = !food;
    $('.picker-search', host).hidden = !!food;
    if (food) onPick?.(food);
  }

  list.addEventListener('click', (ev) => {
    const item = ev.target.closest('[data-key]');
    if (item) {
      const food = state.catalog.find(f => foodKey(f) === item.dataset.key);
      if (food) { input.blur(); pick(food); }
      return;
    }
    if (ev.target.closest('[data-add]')) onAddNew?.(input.value.trim());
  });
  input.addEventListener('input', render);
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const first = $('[data-key]', list);
    if (first && input.value.trim()) first.click();
  });
  $('.picker-change', host).addEventListener('click', () => {
    pick(null);
    input.value = '';
    render();
    input.focus();
  });

  render();
  return {
    get: () => chosen,
    select(food) {
      const hit = food && state.catalog.find(f => foodKey(f) === foodKey(food));
      pick(hit || null);
    },
    refresh() {
      render();
      if (chosen) this.select(chosen); // catalog objects were rebuilt
    },
  };
}

function pickerItem(f, stats, showGroup) {
  const s = stats.get(foodKey(f));
  const { flavor } = splitName(f.name);
  const meta = s
    ? `<span class="pi-meta">${s.emoji} fed ${s.count}×</span>`
    : '';
  return `<button type="button" class="picker-item" role="option" data-key="${escapeAttr(foodKey(f))}">
      <span class="pi-name">${escapeHtml(flavor)}${showGroup ? `<small>${escapeHtml(groupLabel(f))}</small>` : ''}</span>
      ${meta}
    </button>`;
}

// Per-food feeding count + average-reaction emoji for the active pet.
function foodStats() {
  const map = new Map();
  for (const e of state.entries) {
    const key = foodKey(normalizeFood({ brand: e.food_brand, name: e.food_name }));
    const s = map.get(key) || { count: 0, total: 0, rated: 0 };
    s.count++;
    const r = REACTION_BY_VALUE[e.initial_reaction];
    if (r) { s.total += r.score; s.rated++; }
    map.set(key, s);
  }
  for (const s of map.values()) {
    const avg = s.rated ? Math.round(s.total / s.rated) : null;
    s.emoji = avg == null ? '' : (REACTIONS.find(r => r.score === avg)?.emoji || '');
  }
  return map;
}

// Most recently fed distinct foods that are still in the catalog.
function recentFoods(n) {
  const out = [], seen = new Set();
  for (const e of state.entries) { // already newest-first
    const key = foodKey(normalizeFood({ brand: e.food_brand, name: e.food_name }));
    if (seen.has(key)) continue;
    seen.add(key);
    const f = state.catalog.find(x => foodKey(x) === key);
    if (f) out.push(f);
    if (out.length >= n) break;
  }
  return out;
}

// Lightweight transient toast (replaces the old inline form message).
function toast(text, isError = false) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className = isError ? 'show error' : 'show';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = ''; }, 2600);
}

// ── History ──────────────────────────────────────────────────────────────────
function renderHistory() {
  const host = $('#historyList');
  if (!state.entries.length) {
    host.innerHTML = `<p class="empty">No feedings yet.<br>Tap <strong>＋ New feeding</strong> to add the first one.</p>`;
    return;
  }
  host.innerHTML = state.entries.map(e => {
    const r = REACTION_BY_VALUE[e.initial_reaction];
    const isNew = e.id === state.lastAddedId;
    return `
      <div class="entry${isNew ? ' just-added' : ''}" data-id="${e.id}">
        <div class="react-emojis" title="${r ? r.label : ''}">${r ? r.emoji : '·'}</div>
        <div class="body">
          <div class="food">${escapeHtml(e.food_label || foodLabel({ brand: e.food_brand, name: e.food_name }))}</div>
          <div class="when">${fmtWhen(e.fed_at)}</div>
          ${e.notes ? `<div class="note">${escapeHtml(e.notes)}</div>` : ''}
          ${byline(e)}
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-act="edit" title="Edit">✎</button>
          <button class="icon-btn" data-act="del" title="Delete">🗑</button>
        </div>
      </div>`;
  }).join('');

  state.lastAddedId = null; // one-shot: only animate once

  $$('.entry', host).forEach(row => {
    const id = row.dataset.id;
    $('[data-act="del"]', row).addEventListener('click', () => deleteEntry(id));
    $('[data-act="edit"]', row).addEventListener('click', () => openEditEntryModal(id));
  });
}

async function deleteEntry(id) {
  const entry = state.entries.find(e => e.id === id);
  if (!confirm(`Delete this feeding (${entry?.food_label || 'entry'})?`)) return;
  await store.deleteEntry(id);
  state.entries = await store.getEntries(state.activePetId);
  renderHistory();
  renderInsights();
}

// ── Insights ─────────────────────────────────────────────────────────────────
function renderInsights() {
  const e = state.entries;
  const s = insights.summarize(e);

  $('#kpiGrid').innerHTML = [
    kpi(s.total, 'Feedings logged'),
    kpi(s.acceptanceRate == null ? '—' : pct(s.acceptanceRate), 'Acceptance rate'),
    kpi(s.avgInitialScore == null ? '—' : s.avgInitialScore.toFixed(1) + '/4', 'Avg rating'),
    kpi(s.lastFed ? fmtRelative(s.lastFed) : '—', 'Last fed'),
  ].join('');

  // Reaction breakdown (initial)
  const breakdown = insights.reactionBreakdown(e, 'initial_reaction');
  const maxB = Math.max(1, ...breakdown.map(b => b.count));
  $('#breakdownChart').innerHTML = breakdown.length
    ? breakdown.map(b => barRow(
        `${b.meta?.emoji || ''} ${b.meta?.label || b.value}`,
        b.count / maxB, String(b.count)
      )).join('')
    : emptyNote('Log a few feedings to see her reaction mix.');

  // Trend
  const trend = insights.acceptanceTrend(e);
  $('#trendChart').innerHTML = trend.length
    ? spark(trend)
    : emptyNote('Trends appear once you have feedings across a couple of weeks.');

  renderSuggestions();
  renderPreferenceBoard();
  renderFrequencyBoard();
}

// ── Suggestions / leaderboards ───────────────────────────────────────────────
const BOARD_TOP = 10;

function renderSuggestions() {
  const list = insights.suggestions(state.entries, { skipDays: 2, limit: 10 });
  const host = $('#suggestions');
  if (!list.length) {
    host.innerHTML = emptyNote(state.entries.length
      ? "Nothing to suggest — she's had everything in the last 2 days."
      : 'Suggestions appear once you have a few feedings logged.');
    return;
  }
  host.innerHTML = list.map((s, i) => {
    const r = s.recentAvg == null ? null : REACTIONS.find(x => x.score === Math.round(s.recentAvg));
    const avg = s.recentAvg == null ? 'not rated' : `${r?.emoji || ''} ${s.recentAvg.toFixed(1)} avg`;
    return `<button type="button" class="lb-row suggest-row" data-i="${i}">
      <span class="lb-rank">${i + 1}</span>
      <div>${foodNameHtml(s)}
        <div class="lb-sub">${avg} · last had ${agoDays(s.daysSince)}</div>
      </div>
      <span class="suggest-go">Log ›</span>
    </button>`;
  }).join('');
  $$('.suggest-row', host).forEach(btn => btn.addEventListener('click', () => {
    const s = list[Number(btn.dataset.i)];
    openEntryModal({ brand: s.brand, name: s.name });
  }));
}

function renderPreferenceBoard() {
  renderWindowSeg('#prefWindow', 'prefWindow', renderPreferenceBoard);
  const rows = insights.preferenceBoard(insights.inWindow(state.entries, state.prefWindow));
  renderBoard('#leaderboard', rows, prefRow, {
    title: '🏆 Favorites', windowKey: 'prefWindow', empty: 'No rated feedings',
  });
}

function renderFrequencyBoard() {
  renderWindowSeg('#freqWindow', 'freqWindow', renderFrequencyBoard);
  const rows = insights.frequencyBoard(insights.inWindow(state.entries, state.freqWindow));
  renderBoard('#freqBoard', rows, freqRow, {
    title: '🔁 Most fed', windowKey: 'freqWindow', empty: 'No feedings',
  });
}

// Top 10 inline + "See all" → full list in a pop-up.
function renderBoard(sel, rows, rowFn, { title, windowKey, empty }) {
  const host = $(sel);
  const w = insights.WINDOWS.find(x => x.value === state[windowKey]);
  if (!rows.length) {
    host.innerHTML = emptyNote(`${empty} ${w.days ? `in the last ${w.label.toLowerCase()}` : 'yet'}.`);
    return;
  }
  host.innerHTML = rows.slice(0, BOARD_TOP).map(rowFn).join('') +
    (rows.length > BOARD_TOP
      ? `<button type="button" class="ghost-btn see-all">See all ${rows.length} →</button>` : '');
  $('.see-all', host)?.addEventListener('click', () => {
    openModal(`
      <div class="modal-head">
        <h2>${title}</h2>
        <button type="button" class="icon-btn close-x" id="m_close" title="Close">✕</button>
      </div>
      <p class="muted">${w.days ? `Last ${w.label.toLowerCase()}` : 'All time'} · ${rows.length} foods</p>
      <div>${rows.map(rowFn).join('')}</div>`);
    $('#m_close').addEventListener('click', closeModal);
  });
}

function renderWindowSeg(sel, key, rerender) {
  const host = $(sel);
  host.innerHTML = insights.WINDOWS.map(w =>
    `<button type="button" data-w="${w.value}" class="${state[key] === w.value ? 'on' : ''}"
       aria-pressed="${state[key] === w.value}">${w.value === '3mo' ? '3 mo' : w.label}</button>`
  ).join('');
  $$('button', host).forEach(b => b.addEventListener('click', () => {
    state[key] = b.dataset.w;
    rerender();
  }));
}

function prefRow(f, i) {
  return `<div class="lb-row">
    <span class="lb-rank">${i + 1}</span>
    <div>${foodNameHtml(f)}
      <div class="lb-sub">${f.count} feeding${f.count === 1 ? '' : 's'}${f.acceptance != null ? ' · ' + pct(f.acceptance) + ' accepted' : ''}</div>
    </div>
    <div class="lb-stat" title="Average rating (0–4)">${f.avgInitial.toFixed(1)}<span class="lb-unit">/4</span></div>
  </div>`;
}

function freqRow(f, i) {
  return `<div class="lb-row">
    <span class="lb-rank">${i + 1}</span>
    <div>${foodNameHtml(f)}
      <div class="lb-sub">${pct(f.share)} of feedings · last ${fmtRelative(f.lastFed)}</div>
    </div>
    <div class="lb-stat">${f.count}<span class="lb-unit">×</span></div>
  </div>`;
}

// "Salmon" over "Fancy Feast · Gravy Lovers"
function foodNameHtml(f) {
  const food = normalizeFood({ brand: f.brand || '', name: f.name || f.label });
  return `<div class="lb-name">${escapeHtml(splitName(food.name).flavor)}</div>
    <div class="lb-sub">${escapeHtml(groupLabel(food))}</div>`;
}

function agoDays(days) {
  const d = Math.floor(days);
  return d < 1 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

function kpi(value, label) {
  return `<div class="kpi"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}
function barRow(label, frac, val) {
  return `<div class="bar-row">
    <span class="bar-label">${escapeHtml(label)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${Math.round(frac * 100)}%"></span></span>
    <span class="bar-val">${val}</span>
  </div>`;
}
function spark(trend) {
  const cols = trend.map(t => {
    const h = Math.round(t.rate * 100);
    return `<div class="col" title="${t.total} feedings">
      <div class="stalk" style="height:${Math.max(4, h)}%"></div>
      <div class="cap">${fmtWeek(t.week)}</div>
    </div>`;
  }).join('');
  return `<div class="spark">${cols}</div>
    <p class="muted" style="margin-top:8px">Each bar = one week's acceptance rate.</p>`;
}
// ── Pets tab ─────────────────────────────────────────────────────────────────
function wirePetsTab() {
  $('#addPetBtn').addEventListener('click', () => openPetModal());
  $('#exportBtn').addEventListener('click', exportData);
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', importData);
}

function renderPetList() {
  const host = $('#petList');
  if (!state.pets.length) {
    host.innerHTML = `<p class="empty">No pets yet.</p>`;
    return;
  }
  host.innerHTML = state.pets.map(p => `
    <div class="pet ${p.id === state.activePetId ? 'active' : ''}" data-id="${p.id}">
      <span class="avatar">${avatarFor(p)}</span>
      <div class="info">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="meta">${escapeHtml(p.species || 'Pet')}${p.notes ? ' · ' + escapeHtml(p.notes) : ''}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-act="edit" title="Edit">✎</button>
        <button class="icon-btn" data-act="del" title="Delete">🗑</button>
      </div>
    </div>`).join('');

  $$('.pet', host).forEach(row => {
    const id = row.dataset.id;
    row.addEventListener('click', async (ev) => {
      if (ev.target.closest('[data-act]')) return;
      state.activePetId = id;
      state.entries = await store.getEntries(id);
      renderPetSwitcher(); renderPetList(); renderHistory(); renderInsights();
    });
    $('[data-act="edit"]', row).addEventListener('click', () => openPetModal(id));
    $('[data-act="del"]', row).addEventListener('click', () => deletePet(id));
  });
}

async function deletePet(id) {
  const p = state.pets.find(x => x.id === id);
  if (!confirm(`Delete ${p?.name} and all their feedings? This can't be undone.`)) return;
  await store.deletePet(id);
  await refreshAll();
}

// ── Modals ───────────────────────────────────────────────────────────────────
function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalBackdrop').hidden = false;
}
function closeModal() {
  stopScan(); // harmless if not scanning; covers backdrop-click / cancel / X
  $('#modalBackdrop').hidden = true;
  $('#modalBox').innerHTML = '';
}
$('#modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

// Brand / line / flavor fields shared by "Add a food" and "New can scanned".
// Line suggestions follow the brand so names stay consistent.
function foodFieldsHtml(prefix, { brand = 'Fancy Feast', line = '', flavor = '' } = {}) {
  const brands = [...new Set([...KNOWN_BRANDS, ...state.catalog.map(f => f.brand).filter(Boolean)])].sort();
  return `
    <div class="food-fields">
      <label class="field"><span>Brand</span>
        <input id="${prefix}_brand" list="${prefix}_brands" value="${escapeAttr(brand)}" autocomplete="off" />
        <datalist id="${prefix}_brands">${brands.map(b => `<option value="${escapeAttr(b)}">`).join('')}</datalist>
      </label>
      <label class="field"><span>Product line <small>(optional)</small></span>
        <input id="${prefix}_line" list="${prefix}_lines" value="${escapeAttr(line)}" placeholder="e.g. Gravy Lovers" autocomplete="off" />
        <datalist id="${prefix}_lines"></datalist>
      </label>
      <label class="field"><span>Flavor</span>
        <input id="${prefix}_flavor" value="${escapeAttr(flavor)}" placeholder="e.g. Salmon & Sole" autocomplete="off" />
      </label>
      <p class="muted food-preview" id="${prefix}_preview"></p>
    </div>`;
}

function wireFoodFields(prefix) {
  const brandEl = $(`#${prefix}_brand`), lineEl = $(`#${prefix}_line`), flavorEl = $(`#${prefix}_flavor`);
  const refreshLines = () => {
    const known = linesFor(brandEl.value);
    const used = state.catalog
      .filter(f => f.brand.toLowerCase() === brandEl.value.trim().toLowerCase())
      .map(f => splitName(f.name).line).filter(Boolean);
    $(`#${prefix}_lines`).innerHTML = [...new Set([...known, ...used])].sort()
      .map(l => `<option value="${escapeAttr(l)}">`).join('');
  };
  const preview = () => {
    const f = readFoodFields(prefix);
    const exists = f && state.catalog.some(c => foodKey(c) === foodKey(f));
    $(`#${prefix}_preview`).innerHTML = f
      ? `Will be saved as <strong>${escapeHtml(groupLabel(f))} — ${escapeHtml(splitName(f.name).flavor)}</strong>${exists ? ' (already in your list)' : ''}`
      : '';
  };
  brandEl.addEventListener('input', () => { refreshLines(); preview(); });
  lineEl.addEventListener('input', preview);
  flavorEl.addEventListener('input', preview);
  refreshLines();
  preview();
  return { refreshLines, preview };
}

// → normalized { brand, name } or null if no flavor typed.
function readFoodFields(prefix) {
  const flavor = $(`#${prefix}_flavor`)?.value.trim();
  if (!flavor) return null;
  return normalizeFood({
    brand: $(`#${prefix}_brand`).value,
    line: $(`#${prefix}_line`).value,
    flavor,
  });
}

// Make sure a food is in the catalog (adding it as a custom food if new) and
// return the catalog's copy.
async function ensureFood(food) {
  let hit = state.catalog.find(f => foodKey(f) === foodKey(food));
  if (!hit) {
    await store.addCustomFood({ brand: food.brand, name: food.name });
    state.catalog = await getFoodCatalog();
    hit = state.catalog.find(f => foodKey(f) === foodKey(food));
  }
  return hit;
}

function openAddFoodModal(query = '') {
  // Best guess from whatever was typed into search ("gravy lovers tuna").
  const guess = query ? parseProductTitle(query, 'Fancy Feast') : {};
  openModal(`
    <h2>Add a food</h2>
    ${foodFieldsHtml('m', { brand: guess.brand || 'Fancy Feast', line: guess.line || '', flavor: guess.flavor || '' })}
    <div class="btn-row">
      <button class="primary-btn" id="m_save">Add food</button>
      <button class="ghost-btn" id="m_cancel">Cancel</button>
    </div>`);
  wireFoodFields('m');
  $('#m_cancel').addEventListener('click', closeModal);
  $('#m_save').addEventListener('click', async () => {
    const food = readFoodFields('m');
    if (!food) { $('#m_flavor').focus(); return; }
    const hit = await ensureFood(food);
    renderFoodSelect();
    entryPicker?.select(hit);
    closeModal();
  });
}

// ── Barcode scanning ─────────────────────────────────────────────────────────
function openScanModal() {
  openModal(`
    <h2>Scan a can</h2>
    <div class="scanner">
      <video id="scanVideo" playsinline muted></video>
      <div class="scan-reticle"></div>
    </div>
    <p class="muted" id="scanStatus">Point your camera at the barcode on the can.</p>
    <details class="manual" id="manualWrap">
      <summary>Can't scan? Enter the number</summary>
      <div class="food-row" style="margin-top:8px">
        <input id="manualCode" inputmode="numeric" autocomplete="off" placeholder="Barcode digits" />
        <button type="button" class="ghost-btn" id="manualGo">Use</button>
      </div>
    </details>
    <div class="btn-row"><button type="button" class="ghost-btn" id="scanCancel">Cancel</button></div>
  `);

  $('#scanCancel').addEventListener('click', closeModal);
  $('#manualGo').addEventListener('click', () => {
    const code = $('#manualCode').value.trim();
    if (code) resolveBarcode(code);
  });

  startScan(
    $('#scanVideo'),
    (code) => resolveBarcode(code),
    (err) => {
      const status = $('#scanStatus');
      if (!status) return;
      status.textContent = `Camera unavailable (${err?.message || err}). Type the number below instead.`;
      status.style.color = 'var(--bad)';
      $('#manualWrap')?.setAttribute('open', '');
    }
  );
}

// UPC-A (12 digits) and EAN-13 (13, leading 0) are the same can.
function sameCode(a, b) {
  const n = (c) => String(c).replace(/\D/g, '').replace(/^0+/, '');
  return n(a) === n(b);
}

// A scanned/entered code arrives here. Known code → select instantly.
// Unknown → look it up online and pre-fill brand / line / flavor to confirm.
async function resolveBarcode(code) {
  stopScan();
  code = String(code).trim();
  const match = state.barcodes.find(b => sameCode(b.code, code));
  if (match) {
    const food = await ensureFood(normalizeFood({ brand: match.food_brand, name: match.food_name }));
    renderFoodSelect();
    entryPicker?.select(food);
    closeModal();
    toast(`✓ Recognized: ${groupLabel(food)} — ${splitName(food.name).flavor}`);
    return;
  }
  openLinkBarcodeModal(code);
}

function openLinkBarcodeModal(code) {
  openModal(`
    <h2>New can scanned 📷</h2>
    <p class="muted">Barcode <code>${escapeHtml(code)}</code></p>
    <div class="lookup-status" id="lb_status">🔎 Looking up this can…</div>
    ${foodFieldsHtml('lb', { brand: '', line: '', flavor: '' })}
    <details class="manual" id="lb_pickWrap">
      <summary>Or pick a food already in your list</summary>
      <div id="lb_picker" style="margin-top:8px"></div>
    </details>
    <p class="muted">Check the name, then save — next time this can is recognized instantly.</p>
    <div class="btn-row">
      <button type="button" class="primary-btn" id="lb_save">Save &amp; use</button>
      <button type="button" class="ghost-btn" id="lb_cancel">Cancel</button>
    </div>
  `);
  const fields = wireFoodFields('lb');
  const setFields = ({ brand, line, flavor }) => {
    $('#lb_brand').value = brand || '';
    $('#lb_line').value = line || '';
    $('#lb_flavor').value = flavor || '';
    fields.refreshLines();
    fields.preview();
  };

  // Picking an existing food just fills the fields, so there's one source of truth.
  mountFoodPicker($('#lb_picker'), {
    compact: true,
    onPick: (f) => {
      const { line, flavor } = splitName(f.name);
      setFields({ brand: f.brand, line, flavor });
      $('#lb_pickWrap').removeAttribute('open');
    },
  });

  lookupProduct(code).then((hit) => {
    const status = $('#lb_status');
    if (!status) return; // modal closed meanwhile
    if (hit) {
      status.innerHTML = `✨ Found online: <em>${escapeHtml(hit.title)}</em>`;
      status.classList.add('found');
      // Fill only fields the person hasn't started typing in.
      if (!$('#lb_flavor').value) setFields(hit);
    } else {
      status.textContent = "Couldn't find this barcode online — type the name below.";
      if (!$('#lb_brand').value) setFields({ brand: 'Fancy Feast' });
    }
  });

  $('#lb_cancel').addEventListener('click', closeModal);
  $('#lb_save').addEventListener('click', async () => {
    const food = readFoodFields('lb');
    if (!food) { $('#lb_flavor').focus(); return; }
    const hit = await ensureFood(food);
    await store.addBarcode({ code, food_brand: hit.brand, food_name: hit.name, food_label: foodLabel(hit) });
    state.barcodes = await store.getBarcodes();
    renderFoodSelect();
    entryPicker?.select(hit);
    closeModal();
    toast(`✓ Saved: ${groupLabel(hit)} — ${splitName(hit.name).flavor}`);
  });
}

// Look up a barcode online and parse the product title into
// { brand, line, flavor, title }. Tries, in order:
//   1. UPCitemdb via our `upc-lookup` Edge Function (best coverage for US
//      grocery; needs the server hop because it blocks browser calls)
//   2. Open Pet Food Facts, then Open Food Facts (free, called directly)
async function lookupProduct(code) {
  const attempts = [
    async () => {
      const r = await store.lookupUpc(code);
      return r && { title: r.title, brand: r.brand };
    },
    () => fetchProductFacts('https://world.openpetfoodfacts.org', code),
    () => fetchProductFacts('https://world.openfoodfacts.org', code),
  ];
  for (const attempt of attempts) {
    try {
      const r = await attempt();
      if (r?.title) {
        const parsed = parseProductTitle(r.title, r.brand);
        if (parsed.flavor) return { ...parsed, title: r.title };
      }
    } catch { /* offline / not found — try the next source */ }
  }
  return null;
}

async function fetchProductFacts(host, code) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(
      `${host}/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands`,
      { signal: ctrl.signal }
    );
    if (!res.ok) return null; // 404 = not in this database
    const data = await res.json();
    if (data.status === 0 || !data.product) return null;
    const name = (data.product.product_name || '').trim();
    const brand = (data.product.brands || '').split(',')[0].trim();
    if (!name) return null;
    return { title: name.toLowerCase().includes(brand.toLowerCase()) ? name : `${brand} ${name}`, brand };
  } finally {
    clearTimeout(t);
  }
}

function openPetModal(id) {
  const p = id ? state.pets.find(x => x.id === id) : null;
  openModal(`
    <h2>${p ? 'Edit pet' : 'Add a pet'}</h2>
    <label class="field"><span>Name</span>
      <input id="m_name" value="${p ? escapeAttr(p.name) : ''}" placeholder="e.g. Mochi" /></label>
    <label class="field"><span>Species / type</span>
      <input id="m_species" value="${p ? escapeAttr(p.species || 'Cat') : 'Cat'}" /></label>
    <label class="field"><span>Notes <small>(optional)</small></span>
      <input id="m_notes" value="${p ? escapeAttr(p.notes || '') : ''}" placeholder="e.g. senior, sensitive stomach" /></label>
    <div class="btn-row">
      <button class="primary-btn" id="m_save">${p ? 'Save' : 'Add pet'}</button>
      <button class="ghost-btn" id="m_cancel">Cancel</button>
    </div>`);
  $('#m_cancel').addEventListener('click', closeModal);
  $('#m_save').addEventListener('click', async () => {
    const name = $('#m_name').value.trim();
    if (!name) { $('#m_name').focus(); return; }
    const payload = {
      name,
      species: $('#m_species').value.trim() || 'Cat',
      notes: $('#m_notes').value.trim(),
    };
    if (p) await store.updatePet(id, payload);
    else {
      const created = await store.addPet(payload);
      state.activePetId = created.id;
    }
    closeModal();
    await refreshAll();
  });
}

function openEditEntryModal(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;

  openModal(`
    <h2>Edit feeding</h2>
    <div class="field"><span>${escapeHtml(e.food_label)}</span></div>
    <fieldset class="field"><legend>Reaction</legend>
      <div class="reaction-grid" id="e_reactions"></div></fieldset>
    <label class="field"><span>Time fed</span>
      <input type="datetime-local" id="e_fedAt" value="${toLocalInput(new Date(e.fed_at))}" /></label>
    <label class="field"><span>Notes</span>
      <textarea id="e_notes" rows="2">${escapeHtml(e.notes || '')}</textarea></label>
    <div class="btn-row">
      <button class="primary-btn" id="m_save">Save changes</button>
      <button class="ghost-btn" id="m_cancel">Cancel</button>
    </div>`);
  buildReactionGrid('#e_reactions', 'e_reaction', e.initial_reaction);
  $('#m_cancel').addEventListener('click', closeModal);
  $('#m_save').addEventListener('click', async () => {
    await store.updateEntry(id, {
      initial_reaction: $('input[name="e_reaction"]:checked')?.value || null,
      fed_at: fromLocalInput($('#e_fedAt').value).toISOString(),
      notes: $('#e_notes').value.trim(),
      edited_by_name: state.user ? userName(state.user) : null,
      edited_at: state.user ? new Date().toISOString() : null,
    });
    closeModal();
    state.entries = await store.getEntries(state.activePetId);
    renderHistory();
    renderInsights();
  });
}

// ── Export / import ──────────────────────────────────────────────────────────
function renderDataLocation() {
  $('#dataLocation').textContent =
    syncMode() === 'shared' ? 'in your shared Supabase project (synced across devices)'
                            : 'on this device only';
}
async function exportData() {
  const data = await store.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `picky-paws-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importData(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('Import this file? It adds to your current data.')) return;
    await store.importAll(data);
    await refreshAll();
    alert('Imported!');
  } catch (err) {
    alert('Could not read that file: ' + err.message);
  } finally {
    ev.target.value = '';
  }
}

// ── Tab navigation ───────────────────────────────────────────────────────────
function wireTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => goToTab(btn.dataset.go));
  });
}

function goToTab(go) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.go === go));
  $$('.tab').forEach(t => { t.hidden = t.dataset.tab !== go; });
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function avatarFor(p) {
  const s = (p.species || '').toLowerCase();
  if (s.includes('dog')) return '🐶';
  if (s.includes('cat')) return '🐱';
  return '🐾';
}
function pct(frac) { return Math.round(frac * 100) + '%'; }
function emptyNote(t) { return `<p class="muted">${t}</p>`; }

// "by Pat · edited by Sam" — only rendered for entries that carry attribution.
function byline(e) {
  const parts = [];
  if (e.created_by_name) parts.push(`by ${escapeHtml(e.created_by_name)}`);
  if (e.edited_by_name && e.edited_by_name !== e.created_by_name) {
    parts.push(`edited by ${escapeHtml(e.edited_by_name)}`);
  }
  return parts.length ? `<div class="byline">${parts.join(' · ')}</div>` : '';
}

function toLocalInput(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) { return new Date(v); }

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = diff / 3.6e6;
  if (h < 1) return Math.max(1, Math.round(diff / 6e4)) + 'm ago';
  if (h < 24) return Math.round(h) + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
function fmtWeek(isoDate) {
  const d = new Date(isoDate);
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
