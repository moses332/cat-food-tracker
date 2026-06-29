// ───────────────────────────────────────────────────────────────────────────
// Shared-sync config. Leave these blank to run in LOCAL mode (data lives in
// this browser only). To turn on shared data across both phones, fill in your
// free Supabase project's URL + anon key. See README.md → "Turn on sharing".
// ───────────────────────────────────────────────────────────────────────────
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

export const SYNC_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
