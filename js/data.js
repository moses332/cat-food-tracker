// Static reference data: reaction scale + the starter food catalog.
// Custom foods entered by users are stored separately (see store.js).

// Reaction scale, shared by both "initial" and "long-term" reactions.
// `score` powers KPIs/trends on a 1–5 scale (higher = she liked it more).
// Entries store the `value` word, not the number, so the scale can change freely.
export const REACTIONS = [
  { value: 'loved',    label: 'Loved it',  emoji: '😻', score: 5, hint: 'Devoured it, wanted more' },
  { value: 'ate',      label: 'Ate it',    emoji: '🙂', score: 4, hint: 'Finished, no fuss' },
  { value: 'picky',    label: 'Picky',     emoji: '😐', score: 3, hint: 'Ate some, left the rest' },
  { value: 'nibbled',  label: 'Nibbled',   emoji: '😾', score: 2, hint: 'A bite or two, then done' },
  { value: 'refused',  label: 'Refused',   emoji: '🙅', score: 1, hint: 'Walked away, ate nothing' },
];

export const SCORE_MIN = 1;
export const SCORE_MAX = 5;

export const REACTION_BY_VALUE = Object.fromEntries(REACTIONS.map(r => [r.value, r]));

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
  { brand: 'Fancy Feast', name: 'Gravy Lovers — Ocean Whitefish' },
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
