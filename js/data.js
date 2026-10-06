// Static reference data: reaction scale + the starter food catalog.
// Custom foods entered by users are stored separately (see store.js).

// Rating scale. Entries store the NUMBER in `entries.rating`
// (1 = Refused, 2 = Nibbled, 3 = Liked it); this table is the lookup to the
// words/emoji shown in the app. Higher = she liked it more.
export const REACTIONS = [
  { value: 3, label: 'Liked it', emoji: '😻', hint: 'Ate it happily' },
  { value: 2, label: 'Nibbled',  emoji: '😐', hint: 'Ate some, left the rest' },
  { value: 1, label: 'Refused',  emoji: '🙅', hint: 'Walked away, ate nothing' },
].map(r => ({ ...r, score: r.value }));

export const SCORE_MIN = 1;
export const SCORE_MAX = 3;

export const REACTION_BY_VALUE = Object.fromEntries(REACTIONS.map(r => [r.value, r]));

// Legacy word ratings (before Sep 2026) → number. The database converts these
// too (trigger on entries); this covers local-mode data and old JSON imports.
export const LEGACY_RATING = { loved: 3, ate: 3, picky: 2, nibbled: 2, refused: 1 };

// The entry's rating as a number 1–3, or null if unrated.
export function ratingOf(entry) {
  if (!entry) return null;
  const n = Number(entry.rating);
  if (n >= SCORE_MIN && n <= SCORE_MAX) return n;
  return LEGACY_RATING[entry.initial_reaction] ?? null;
}

export function reactionScore(value) {
  const r = REACTION_BY_VALUE[value];
  return r ? r.score : null;
}

// Starter catalog scoped to Fancy Feast, since that's what she mostly eats.
// Names follow the house style in foods.js: brand = maker only,
// name = "Line — Flavor". The picker sorts these, so order here doesn't matter.
export const STARTER_FOODS = [
  // Classic Pâté
  { brand: 'Fancy Feast', name: 'Classic Pâté — Chicken' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Turkey & Giblets' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Ocean Whitefish & Tuna' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Savory Salmon' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Tender Beef' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Tender Liver & Chicken' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Seafood' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Cod, Sole & Shrimp' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Salmon & Shrimp' },
  { brand: 'Fancy Feast', name: 'Classic Pâté — Chopped Grill' },
  // Grilled (gravy)
  { brand: 'Fancy Feast', name: 'Grilled — Chicken' },
  { brand: 'Fancy Feast', name: 'Grilled — Turkey' },
  { brand: 'Fancy Feast', name: 'Grilled — Beef' },
  { brand: 'Fancy Feast', name: 'Grilled — Salmon' },
  { brand: 'Fancy Feast', name: 'Grilled — Ocean Whitefish & Tuna' },
  { brand: 'Fancy Feast', name: 'Grilled — Seafood' },
  // Flaked / Chunky
  { brand: 'Fancy Feast', name: 'Flaked — Fish & Shrimp' },
  { brand: 'Fancy Feast', name: 'Flaked — Tuna' },
  { brand: 'Fancy Feast', name: 'Flaked — Ocean Whitefish & Tuna' },
  { brand: 'Fancy Feast', name: 'Chunky — Chicken' },
  // Gravy Lovers
  { brand: 'Fancy Feast', name: 'Gravy Lovers — Chicken' },
  { brand: 'Fancy Feast', name: 'Gravy Lovers — Turkey' },
  { brand: 'Fancy Feast', name: 'Gravy Lovers — Ocean Whitefish & Tuna' },
  // Savory Centers / Medleys
  { brand: 'Fancy Feast', name: 'Savory Centers — Chicken Pâté' },
  { brand: 'Fancy Feast', name: 'Savory Centers — Salmon Pâté' },
  { brand: 'Fancy Feast', name: 'Medleys — White Meat Chicken Florentine' },
  { brand: 'Fancy Feast', name: 'Medleys — Tuscany Chicken' },
];

// Full display label, e.g. "Fancy Feast — Gravy Lovers — Salmon". Stored on
// each entry as food_label, which the leaderboard groups by.
export function foodLabel(food) {
  if (!food) return '';
  return food.brand ? `${food.brand} — ${food.name}` : food.name;
}
