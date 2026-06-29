// ───────────────────────────────────────────────────────────────────────────
// Shared-sync config. Leave these blank to run in LOCAL mode (data lives in
// this browser only). To turn on shared data across both phones, fill in your
// free Supabase project's URL + anon key. See README.md → "Turn on sharing".
// ───────────────────────────────────────────────────────────────────────────
export const SUPABASE_URL = 'https://oazrjouhmghidizezhvb.supabase.co';
// Supabase "publishable" key (the new public client key; replaces the legacy
// anon key). Safe to ship in client code — access is governed by RLS policies.
export const SUPABASE_ANON_KEY = 'sb_publishable_tAT4QZwVtF8z-GOwzwZdEg_5CRnNEQ8';

export const SYNC_ENABLED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
