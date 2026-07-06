// UI controller. Owns DOM rendering + events; all persistence goes through
// `store`, all number-crunching through `insights`.

import { store, initStore, getFoodCatalog, syncMode } from './store.js';
import { REACTIONS, REACTION_BY_VALUE, foodLabel } from './data.js';
import * as insights from './insights.js';
import { startScan, stopScan } from './scanner.js';

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
};

// ── Boot ────────────────────────────────────────────────────────────────────
init();

async function init() {
  const mode = await initStore();
  renderModeBadge(mode);
  wireTabs();
  wireHistoryTab();
  wirePetsTab();

  // Debug hook: lets tests drive flows without a physical camera.
  window.__pp = { resolveBarcode, openScanModal, openEntryModal, state };

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
      <input id="authCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" /></label>
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
  if (token.length < 6) { $('#authCode').focus(); return; }
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
  $('#newEntryBtn').addEventListener('click', openEntryModal);
  $('#entryBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'entryBackdrop') closeEntryModal();
  });
}

function openEntryModal() {
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
      <label class="field">
        <span>Food</span>
        <button type="button" id="scanBtn" class="scan-btn">📷 Scan a can</button>
        <div class="food-row">
          <select id="foodSelect" required></select>
          <button type="button" id="addFoodBtn" class="ghost-btn" title="Add a custom food">+ New</button>
        </div>
      </label>

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
  renderFoodSelect();
  $('#fedAt').value = toLocalInput(new Date());

  $('#entryClose').addEventListener('click', closeEntryModal);
  $('#addFoodBtn').addEventListener('click', openAddFoodModal);
  $('#scanBtn').addEventListener('click', openScanModal);
  $('#entryForm').addEventListener('submit', submitEntry);

  $('#entryBackdrop').hidden = false;
}

function closeEntryModal() {
  stopScan();
  $('#entryBackdrop').hidden = true;
  $('#entryBox').innerHTML = '';
}

async function submitEntry(e) {
  e.preventDefault();
  const food = state.catalog[$('#foodSelect').value];
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

// Populates the food dropdown (only present while the entry modal is open).
function renderFoodSelect() {
  const sel = $('#foodSelect');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="" disabled selected>Choose a food…</option>` +
    state.catalog.map((f, i) =>
      `<option value="${i}">${escapeHtml(foodLabel(f))}${f.starter ? '' : ' ✎'}</option>`
    ).join('');
  if (current) sel.value = current;
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

  // Leaderboard
  const foods = insights.perFood(e);
  $('#leaderboard').innerHTML = foods.length
    ? foods.map(leaderboardRow).join('')
    : emptyNote('No foods rated yet.');
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
function leaderboardRow(f) {
  const avg = f.avgInitial == null ? '—' : f.avgInitial.toFixed(1);
  return `<div class="lb-row">
    <div>
      <div class="lb-name">${escapeHtml(f.label)}</div>
      <div class="lb-sub">${f.count} feeding${f.count === 1 ? '' : 's'}${f.acceptance != null ? ' · ' + pct(f.acceptance) + ' accepted' : ''}</div>
    </div>
    <div class="lb-stat" title="Average rating (0–4)">${avg}<span class="lb-unit">/4</span></div>
  </div>`;
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

function openAddFoodModal() {
  openModal(`
    <h2>Add a custom food</h2>
    <label class="field"><span>Brand</span>
      <input id="m_brand" value="Fancy Feast" /></label>
    <label class="field"><span>Flavor / name</span>
      <input id="m_name" placeholder="e.g. Classic Pâté — Trout" /></label>
    <div class="btn-row">
      <button class="primary-btn" id="m_save">Add food</button>
      <button class="ghost-btn" id="m_cancel">Cancel</button>
    </div>`);
  $('#m_cancel').addEventListener('click', closeModal);
  $('#m_save').addEventListener('click', async () => {
    const brand = $('#m_brand').value.trim();
    const name = $('#m_name').value.trim();
    if (!name) { $('#m_name').focus(); return; }
    await store.addCustomFood({ brand, name });
    state.catalog = await getFoodCatalog();
    renderFoodSelect();
    const idx = state.catalog.findIndex(f => f.name === name && (f.brand || '') === brand);
    if (idx >= 0) $('#foodSelect').value = String(idx);
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

// A scanned/entered code arrives here. Known code → select instantly.
// Unknown → ask which food it is (teach-once), pre-filled via Open Food Facts.
async function resolveBarcode(code) {
  stopScan();
  const match = state.barcodes.find(b => b.code === code);
  if (match) {
    await selectFoodByLabel(match.food_label, match.food_brand, match.food_name);
    closeModal();
    toast(`✓ Recognized: ${match.food_label}`);
    return;
  }
  const status = $('#scanStatus');
  if (status) { status.textContent = 'New can — looking it up…'; status.style.color = ''; }
  let guess = null;
  try { guess = await lookupProduct(code); } catch { /* offline / not found */ }
  openLinkBarcodeModal(code, guess);
}

function openLinkBarcodeModal(code, guess) {
  const opts = state.catalog
    .map((f, i) => `<option value="${i}">${escapeHtml(foodLabel(f))}</option>`)
    .join('');
  openModal(`
    <h2>New can scanned 📷</h2>
    <p class="muted">Barcode <code>${escapeHtml(code)}</code>${guess ? ` · looks like <strong>${escapeHtml(guess.label)}</strong>` : ''}</p>
    <p class="muted">Tell me which food this is — I'll remember it next time.</p>
    <label class="field"><span>Pick an existing food</span>
      <select id="lb_food"><option value="" selected>— or add a new one below —</option>${opts}</select>
    </label>
    <label class="field"><span>New food · brand</span>
      <input id="lb_brand" value="${escapeAttr(guess?.brand || 'Fancy Feast')}" />
    </label>
    <label class="field"><span>New food · flavor / name</span>
      <input id="lb_name" value="${escapeAttr(guess?.name || '')}" placeholder="e.g. Classic Pâté — Chicken" />
    </label>
    <div class="btn-row">
      <button type="button" class="primary-btn" id="lb_save">Save &amp; use</button>
      <button type="button" class="ghost-btn" id="lb_cancel">Cancel</button>
    </div>
  `);

  $('#lb_cancel').addEventListener('click', closeModal);
  $('#lb_save').addEventListener('click', async () => {
    const pickedIdx = $('#lb_food').value;
    let brand, name, label;
    if (pickedIdx !== '') {
      const f = state.catalog[pickedIdx];
      brand = f.brand || ''; name = f.name; label = foodLabel(f);
    } else {
      name = $('#lb_name').value.trim();
      if (!name) { $('#lb_name').focus(); return; }
      brand = $('#lb_brand').value.trim();
      label = brand ? `${brand} — ${name}` : name;
      await store.addCustomFood({ brand, name });
    }
    await store.addBarcode({ code, food_brand: brand, food_name: name, food_label: label });
    state.barcodes = await store.getBarcodes();
    state.catalog = await getFoodCatalog();
    renderFoodSelect();
    await selectFoodByLabel(label, brand, name);
    closeModal();
    toast(`✓ Linked & selected: ${label}`);
  });
}

// Select a food in the dropdown by its label, adding it to the catalog if it
// isn't there (e.g. a custom food that was later removed).
async function selectFoodByLabel(label, brand, name) {
  const find = () => state.catalog.findIndex(f => foodLabel(f).toLowerCase() === label.toLowerCase());
  let idx = find();
  if (idx < 0) {
    await store.addCustomFood({ brand: brand || '', name: name || label });
    state.catalog = await getFoodCatalog();
    renderFoodSelect();
    idx = find();
  }
  if (idx >= 0) $('#foodSelect').value = String(idx);
}

// Best-effort product name from the free, key-less, CORS-friendly Open *Pet*
// Food Facts database (the pet-food sibling of Open Food Facts), falling back
// to the regular human-food DB. Coverage is partial — teach-once covers the
// rest. For fuller coverage you'd add a server-side proxy to a commercial API
// like UPCitemdb (CORS-locked, needs a key), e.g. a Supabase Edge Function.
async function lookupProduct(code) {
  const hosts = [
    'https://world.openpetfoodfacts.org', // pet food first
    'https://world.openfoodfacts.org',    // then human-food DB
  ];
  for (const host of hosts) {
    try {
      const hit = await fetchProductFacts(host, code);
      if (hit) return hit;
    } catch { /* try the next source */ }
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
    if (!name && !brand) return null;
    return { name, brand, label: [brand, name].filter(Boolean).join(' — ') };
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
