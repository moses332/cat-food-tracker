// Food naming rules, search and ordering — shared by the picker, the add-food
// form and barcode lookup, so every food is stored the same way:
//
//   brand: "Fancy Feast"            (just the maker — no product line)
//   name:  "Gravy Lovers — Salmon"  ("Line — Flavor", em dash, & not "and")
//
// The line is optional (brands without lines just use the flavor).

// Known product lines per brand. Order doesn't matter; the UI sorts A–Z.
// `aliases` are other spellings seen in user input or retailer titles.
const LINES = {
  'Fancy Feast': [
    { line: 'Classic Pâté', aliases: ['classic pate collection', 'classic pâté collection', 'classic pate', 'classic paté', 'pate', 'pâté'] },
    { line: 'Gravy Lovers', aliases: [] },
    { line: 'Grilled', aliases: [] },
    { line: 'Medleys', aliases: [] },
    { line: 'Flaked', aliases: [] },
    { line: 'Chunky', aliases: ['chunky chopped'] },
    { line: 'Savory Centers', aliases: [] },
    { line: 'Delights', aliases: ['delights with cheddar'] },
    { line: 'Petites', aliases: [] },
    { line: 'Broths', aliases: ['classic broths', 'creamy broths'] },
    { line: 'Purely', aliases: ['purely natural'] },
    { line: 'Gems', aliases: ['gems mousse'] },
    { line: 'Kitten', aliases: [] },
  ],
  'Weruva': [
    { line: 'Cats in the Kitchen', aliases: [] },
    { line: 'Classic', aliases: [] },
    { line: 'Truluxe', aliases: [] },
    { line: 'BFF', aliases: [] },
  ],
  'Friskies': [
    { line: 'Pâté', aliases: ['pate', 'classic pate'] },
    { line: 'Shreds', aliases: ['savory shreds'] },
    { line: 'Extra Gravy', aliases: [] },
    { line: 'Prime Filets', aliases: [] },
  ],
  'Sheba': [
    { line: 'Perfect Portions', aliases: [] },
    { line: 'Meaty Tender Sticks', aliases: [] },
  ],
};

export const KNOWN_BRANDS = Object.keys(LINES);

// Lines whose flavors are all "in gravy", so that part is dropped as noise.
const GRAVY_LINES = new Set(['Grilled', 'Gravy Lovers', 'Extra Gravy']);

const SMALL_WORDS = new Set(['in', 'with', 'and', 'of', 'the', 'a', 'an', 'or', 'on', '&']);

export function linesFor(brand) {
  return (LINES[canonicalBrand(brand)] || []).map(l => l.line);
}

// "fancy feast" → "Fancy Feast"; unknown brands are just tidied.
export function canonicalBrand(brand) {
  const b = squish(brand).replace(/^purina\s+/i, '');
  const known = KNOWN_BRANDS.find(k => k.toLowerCase() === b.toLowerCase());
  return known || titleCase(b);
}

// Split a stored name into { line, flavor }.
export function splitName(name) {
  const parts = String(name || '').split(' — ');
  if (parts.length >= 2) return { line: parts[0], flavor: parts.slice(1).join(' — ') };
  return { line: '', flavor: parts[0] || '' };
}

export function joinName(line, flavor) {
  return line ? `${line} — ${flavor}` : flavor;
}

// Bring any { brand, name } (typed by a person, or from older data) into the
// house style. Idempotent: running it on a clean food changes nothing.
export function normalizeFood({ brand = '', name = '', line = null, flavor = null }) {
  let b = squish(brand).replace(/^purina\s+/i, '');
  let ln = line != null ? squish(line) : '';
  let fl = flavor != null ? squish(flavor) : '';

  // A product line typed into the brand box ("Fancy Feast Medleys").
  const brandHit = KNOWN_BRANDS.find(k => b.toLowerCase().startsWith(k.toLowerCase()));
  if (brandHit) {
    const rest = squish(b.slice(brandHit.length));
    b = brandHit;
    if (rest && !ln) ln = rest;
  }
  b = canonicalBrand(b);

  if (line == null && flavor == null) {
    // Accept "Line - Flavor", "Line- Flavor", "Line — Flavor" …
    const m = squish(name).match(/^(.*?)\s*[—–-]\s+(.*)$|^(.*?)\s+[—–-]\s*(.*)$/);
    if (m) {
      const a = m[1] ?? m[3], c = m[2] ?? m[4];
      const known = matchLine(b, a);
      if (known || !ln) { ln = known || a; fl = c; }
      else fl = squish(name);
    } else {
      fl = squish(name);
    }
  }

  // No line yet? Look for a known line mentioned inside the flavor
  // ("Chicken & Beef in Gravy Grilled").
  if (!ln) {
    const hit = findLine(b, fl);
    if (hit) { ln = hit.line; fl = removeSpan(fl, hit.index, hit.length); }
  }
  ln = matchLine(b, ln) || titleCase(ln);
  fl = cleanFlavor(fl, ln);
  return { brand: b, name: joinName(ln, fl) };
}

// Turn a retailer title like
//   "Purina Fancy Feast Gravy Lovers Gourmet Wet Cat Food Salmon & Sole Feast
//    In Seared Fish Flavor Gravy - 3oz"
// into { brand: 'Fancy Feast', line: 'Gravy Lovers', flavor: 'Salmon & Sole' }.
export function parseProductTitle(title, brandHint = '') {
  let t = ' ' + squish(title) + ' ';
  t = t
    .replace(/\(.*?pack.*?\)/gi, ' ')
    .replace(/\bpack of \d+\b/gi, ' ')
    .replace(/[-,]?\s*\(?\d+(\.\d+)?\s*-?\s*(oz|ounce|g)\b\.?\)?(\s*(pull[- ]top\s*)?(can|cans|pouch|tray)s?\b)?/gi, ' ')
    .replace(/\b\d+\s*(ct|count|cans?)\b/gi, ' ')
    .replace(/\bpurina\b/gi, ' ')
    .replace(/\b(gourmet|wet|canned|adult|grain[- ]free)\b/gi, ' ')
    .replace(/\b(cat|kitten)\s+food\b/gi, ' ')
    .replace(/\bcollection\b/gi, ' ');

  let brand = KNOWN_BRANDS.find(k => new RegExp(`\\b${esc(k)}\\b`, 'i').test(t)) || '';
  if (brand) t = t.replace(new RegExp(`\\b${esc(brand)}\\b`, 'i'), ' ');
  else brand = canonicalBrand(String(brandHint).split(',')[0]);

  let line = '';
  const hit = findLine(brand, t);
  if (hit) { line = hit.line; t = removeSpan(t, hit.index, hit.length); }

  let flavor = squish(t)
    .replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '')
    .replace(/^in\s+.*?\bflavou?r\b\s*/i, ''); // "In a Delicate Sauce … Fish Flavor"
  flavor = cutSauceTail(flavor)                 // "… in Seared Fish Flavor Gravy"
    .replace(/\s+with\s+.*$/i, '')            // "… with Garden Greens"
    .replace(/\s*(flavor\s*)?(gravy|sauce|broth)$/i, '')
    .replace(/\s+flavor$/i, '');
  flavor = cleanFlavor(flavor, line);
  return { brand, line, flavor };
}

// ── Ordering & search ─────────────────────────────────────────────────────

// Brand A–Z, then line A–Z (no line last), then flavor A–Z.
export function compareFoods(a, b) {
  const A = splitName(a.name), B = splitName(b.name);
  return cmp(a.brand, b.brand)
    || cmp(A.line || '￿', B.line || '￿')
    || cmp(A.flavor, B.flavor);
}

export function groupLabel(food) {
  const { line } = splitName(food.name);
  return [food.brand, line].filter(Boolean).join(' · ') || 'Other';
}

// Every typed word must appear somewhere in brand + name. Accents, "&"/"and"
// and punctuation are ignored, so "pate salmon" finds "Classic Pâté — Savory Salmon".
export function matchesQuery(food, query) {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = ' ' + fold(`${food.brand} ${food.name}`) + ' ';
  return words.every(w => hay.includes(w));
}

export function foodKey(food) {
  return fold(`${food.brand}|${food.name}`);
}

// ── helpers ───────────────────────────────────────────────────────────────
function cleanFlavor(fl, line) {
  let f = squish(fl)
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '');
  if (GRAVY_LINES.has(line)) f = f.replace(/\s+in\s+gravy$/i, '');
  // Fancy Feast calls nearly everything "… Feast"; it's noise in a list.
  f = f.replace(/\s+feast(?=$|\s+in\s)/i, '');
  return titleCase(f);
}

// Drop the trailing "in <sauce>" phrase, but keep flavor names that merely
// contain "in" ("Funk in the Trunk"): cut at the last " in " whose tail
// names a sauce.
function cutSauceTail(s) {
  const SAUCE = /\b(gravy|sauce|broth|soup|aspic|jelly|consomm\w*|flavou?r|mousse)\b/i;
  const re = /\s+in\s+/gi;
  let cut = -1, m;
  while ((m = re.exec(s))) if (SAUCE.test(s.slice(m.index))) { cut = m.index; }
  return cut >= 0 ? s.slice(0, cut) : s;
}

function matchLine(brand, text) {
  const t = squish(text).toLowerCase();
  if (!t) return '';
  for (const l of LINES[canonicalBrand(brand)] || []) {
    if (l.line.toLowerCase() === t || l.aliases.includes(t)) return l.line;
  }
  return '';
}

// Earliest mention of a known line (or alias) in free text.
function findLine(brand, text) {
  let best = null;
  for (const l of LINES[canonicalBrand(brand)] || []) {
    for (const name of [l.line, ...l.aliases]) {
      const m = new RegExp(`(^|[^\\p{L}])(${esc(name)})(?=$|[^\\p{L}])`, 'iu').exec(text);
      if (!m) continue;
      const index = m.index + m[1].length;
      if (!best || index < best.index || (index === best.index && name.length > best.length)) {
        best = { line: l.line, index, length: m[2].length };
      }
    }
  }
  return best;
}

function removeSpan(s, index, length) {
  return squish(s.slice(0, index) + ' ' + s.slice(index + length));
}

function titleCase(s) {
  return squish(s).split(' ').map((w, i) => {
    if (!w) return w;
    const lower = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lower)) return lower;
    // Leave words that already carry capitals ("BFF", "McCoy") alone.
    if (w !== lower) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ').replace(/\(([a-z])/g, (_, c) => '(' + c.toUpperCase());
}

function fold(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function squish(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
function cmp(a, b) { return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' }); }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
