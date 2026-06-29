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
};

// ── Boot ────────────────────────────────────────────────────────────────────
init();

async function init() {
  const mode = await initStore();
  renderModeBadge(mode);
  buildReactionGrids();
  resetFedAtToNow();
  wireTabs();
  wireForm();
  wirePetsTab();
  await refreshAll();

  // Debug hook: lets tests drive the barcode flow without a physical camera.
  window.__pp = { resolveBarcode, openScanModal, state };
}

async function refreshAll() {
  state.pets = await store.getPets();
  if (!state.activePetId || !state.pets.some(p => p.id === state.activePetId)) {
    state.activePetId = state.pets[0]?.id ?? null;
  }
  state.catalog = await getFoodCatalog();
  state.barcodes = await store.getBarcodes();
  state.entries = state.activePetId ? await store.getEntries(state.activePetId) : [];

  renderPetSwitcher();
  renderFoodSelect();
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

// ── Log form ─────────────────────────────────────────────────────────────────
function buildReactionGrids() {
  for (const [hostId, group] of [['#initialReactions', 'initial'], ['#longtermReactions', 'longterm']]) {
    const host = $(hostId);
    host.innerHTML = REACTIONS.map(r => `
      <label title="${r.hint}">
        <input type="radio" name="${group}" value="${r.value}" />
        <span class="emoji">${r.emoji}</span>
        <span class="name">${r.label}</span>
      </label>`).join('');
  }
}

function renderFoodSelect() {
  const sel = $('#foodSelect');
  const current = sel.value;
  sel.innerHTML = `<option value="" disabled selected>Choose a food…</option>` +
    state.catalog.map((f, i) =>
      `<option value="${i}">${escapeHtml(foodLabel(f))}${f.starter ? '' : ' ✎'}</option>`
    ).join('');
  if (current) sel.value = current;
}

function resetFedAtToNow() {
  $('#fedAt').value = toLocalInput(new Date());
}

function wireForm() {
  $('#addFoodBtn').addEventListener('click', openAddFoodModal);
  $('#scanBtn').addEventListener('click', openScanModal);

  $('#entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.activePetId) {
      flashMsg('Add a pet first (🐾 tab).', true);
      return;
    }
    const foodIdx = $('#foodSelect').value;
    const food = state.catalog[foodIdx];
    if (!food) { flashMsg('Pick a food.', true); return; }

    const initial = $('input[name="initial"]:checked')?.value || null;
    const longterm = $('input[name="longterm"]:checked')?.value || null;
    if (!initial) { flashMsg('Pick at least an initial reaction.', true); return; }

    await store.addEntry({
      pet_id: state.activePetId,
      food_brand: food.brand || '',
      food_name: food.name,
      food_label: foodLabel(food),
      initial_reaction: initial,
      longterm_reaction: longterm,
      fed_at: fromLocalInput($('#fedAt').value).toISOString(),
      notes: $('#notes').value.trim(),
    });

    e.target.reset();
    buildReactionGrids();
    resetFedAtToNow();
    flashMsg('Saved! 😺');
    state.entries = await store.getEntries(state.activePetId);
    renderHistory();
    renderInsights();
  });
}

function flashMsg(text, isError = false) {
  const el = $('#entryMsg');
  el.textContent = text;
  el.hidden = false;
  el.style.background = isError ? '#fdebee' : '#e7f8ef';
  el.style.color = isError ? 'var(--bad)' : 'var(--good)';
  clearTimeout(flashMsg._t);
  flashMsg._t = setTimeout(() => { el.hidden = true; }, 2600);
}

// ── History ──────────────────────────────────────────────────────────────────
function renderHistory() {
  const host = $('#historyList');
  if (!state.entries.length) {
    host.innerHTML = `<p class="empty">No feedings logged yet.<br>Head to 📝 Log to add the first one.</p>`;
    return;
  }
  host.innerHTML = state.entries.map(e => {
    const ri = REACTION_BY_VALUE[e.initial_reaction];
    const rl = REACTION_BY_VALUE[e.longterm_reaction];
    const emojis = `${ri ? ri.emoji : '·'}${rl ? ' → ' + rl.emoji : ''}`;
    return `
      <div class="entry" data-id="${e.id}">
        <div class="react-emojis" title="initial → long-term">${emojis}</div>
        <div class="body">
          <div class="food">${escapeHtml(e.food_label || foodLabel({ brand: e.food_brand, name: e.food_name }))}</div>
          <div class="when">${fmtWhen(e.fed_at)}</div>
          ${e.notes ? `<div class="note">${escapeHtml(e.notes)}</div>` : ''}
        </div>
        <div class="row-actions">
          <button class="icon-btn" data-act="edit" title="Edit">✎</button>
          <button class="icon-btn" data-act="del" title="Delete">🗑</button>
        </div>
      </div>`;
  }).join('');

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
    kpi(s.avgInitialScore == null ? '—' : s.avgInitialScore.toFixed(1) + '/4', 'Avg first reaction'),
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
  const init = f.avgInitial == null ? '—' : f.avgInitial.toFixed(1);
  let drift = '<span class="drift-flat">—</span>';
  if (f.drift != null) {
    const cls = f.drift > 0.2 ? 'drift-up' : f.drift < -0.2 ? 'drift-down' : 'drift-flat';
    const sign = f.drift > 0 ? '▲' : f.drift < 0 ? '▼' : '–';
    drift = `<span class="${cls}">${sign}${Math.abs(f.drift).toFixed(1)}</span>`;
  }
  return `<div class="lb-row">
    <div>
      <div class="lb-name">${escapeHtml(f.label)}</div>
      <div class="lb-sub">${f.count} feeding${f.count === 1 ? '' : 's'}${f.acceptance != null ? ' · ' + pct(f.acceptance) + ' accepted' : ''}</div>
    </div>
    <div class="lb-stat" title="Avg first reaction (0–4)">${init}</div>
    <div class="lb-stat" title="Drift: long-term minus initial">${drift}</div>
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
    flashMsg(`✓ Recognized: ${match.food_label}`);
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
    flashMsg(`✓ Linked & selected: ${label}`);
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
  const reactionOptions = (group, selected) => REACTIONS.map(r => `
    <label title="${r.hint}">
      <input type="radio" name="${group}" value="${r.value}" ${r.value === selected ? 'checked' : ''}/>
      <span class="emoji">${r.emoji}</span><span class="name">${r.label}</span>
    </label>`).join('');

  openModal(`
    <h2>Edit feeding</h2>
    <div class="field"><span>${escapeHtml(e.food_label)}</span></div>
    <fieldset class="field"><legend>Initial reaction</legend>
      <div class="reaction-grid">${reactionOptions('e_initial', e.initial_reaction)}</div></fieldset>
    <fieldset class="field"><legend>Long-term reaction</legend>
      <div class="reaction-grid">${reactionOptions('e_longterm', e.longterm_reaction)}</div></fieldset>
    <label class="field"><span>Time fed</span>
      <input type="datetime-local" id="e_fedAt" value="${toLocalInput(new Date(e.fed_at))}" /></label>
    <label class="field"><span>Notes</span>
      <textarea id="e_notes" rows="2">${escapeHtml(e.notes || '')}</textarea></label>
    <div class="btn-row">
      <button class="primary-btn" id="m_save">Save changes</button>
      <button class="ghost-btn" id="m_cancel">Cancel</button>
    </div>`);
  $('#m_cancel').addEventListener('click', closeModal);
  $('#m_save').addEventListener('click', async () => {
    await store.updateEntry(id, {
      initial_reaction: $('input[name="e_initial"]:checked')?.value || null,
      longterm_reaction: $('input[name="e_longterm"]:checked')?.value || null,
      fed_at: fromLocalInput($('#e_fedAt').value).toISOString(),
      notes: $('#e_notes').value.trim(),
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
    btn.addEventListener('click', () => {
      const go = btn.dataset.go;
      $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.tab').forEach(t => { t.hidden = t.dataset.tab !== go; });
    });
  });
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
