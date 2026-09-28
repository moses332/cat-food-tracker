# CLAUDE.md — Picky Paws (cat food tracker)

Onboarding for an AI assistant with **no prior context** on this project. Read this first.

## What it is
"Picky Paws" is a small web app to track what cat food **Sybil** (a picky cat) likes/dislikes.
Two owners + occasional house sitter use it from their phones. Live at
**https://moses332.github.io/cat-food-tracker/** — repo **moses332/cat-food-tracker**.

## Stack (deliberately simple)
- **Static site, no build step.** Plain HTML/CSS + vanilla JS ES modules. Open `index.html`,
  no bundler, no framework, no npm install.
- **Backend: Supabase** (hosted Postgres + auto REST API + Auth). Client talks to it directly
  via `@supabase/supabase-js` loaded from a CDN (esm.sh).
- **Hosting: GitHub Pages** off the `main` branch. Push to `main` → auto-deploys in ~1 min.

## File map
```
index.html            app shell + tabs (History / Insights / Pets) + modals
help.html             sitter-facing how-to page (linked from login + Pets tab)
css/styles.css        all styling (mobile-first)
js/config.js          Supabase URL + publishable key (blank = local mode)
js/data.js            reaction scale (5 levels) + Fancy Feast starter catalog
js/foods.js           food naming rules (normalize, parse retailer titles), sort + search
js/store.js           data layer: local (localStorage) ⇄ Supabase, same API + auth methods
js/insights.js        KPI / leaderboard / trend calculations (pure functions)
js/scanner.js         barcode scanning (native BarcodeDetector + ZXing CDN fallback)
js/app.js             UI controller: rendering, events, auth gate, modals
scripts/serve.ps1     local dev server (PowerShell HttpListener)
supabase/functions/upc-lookup/  Edge Function: barcode → product title (UPCitemdb, Open Food Facts)
.claude/launch.json   preview config (server name "picky-paws")
```

## Local vs shared mode (important)
`js/config.js` drives everything:
- **Blank keys → local mode**: data in `localStorage`, no login, seeds a default pet. Great for dev.
- **Filled keys → shared mode**: data in Supabase, **login required**, attribution on.

`syncMode()` returns `'local'`/`'shared'`. Auth + the account UI only appear in shared mode.

## Running locally
No Node or Python is installed on the owner's Windows machine. Use the bundled PowerShell server:
`powershell -ExecutionPolicy Bypass -File scripts/serve.ps1` → http://localhost:8000
(ES modules need http://, not file://). In Claude Code, `preview_start` with server name `picky-paws`.

## Testing safely
The committed `config.js` has **live** keys, so the preview hits **production Supabase**.
To test without touching real data: temporarily blank the two keys in `config.js` (local mode),
test, then **restore the keys before committing**. Verify `git status` shows config.js unchanged.

## Data model (Supabase tables)
- `pets` (id, name, species, notes, created_at)
- `foods` (id, brand, name, created_at) — user-added custom foods; starters live in `data.js`
- `entries` (id, pet_id, food_brand, food_name, food_label, **initial_reaction**, longterm_reaction,
  fed_at, notes, created_at, **created_by, created_by_name, edited_by_name, edited_at**)
- `barcodes` (id, code UNIQUE, food_brand, food_name, food_label) — teach-once UPC→food map

Notes:
- There is **one rating per feeding**, stored in the legacy `initial_reaction` column
  (`longterm_reaction` is unused; kept for back-compat). Don't reintroduce a second rating.
- `created_by_name` / `edited_by_name` power the "by X · edited by Y" byline in History.

## Food naming convention
Every food is stored as `brand` = maker only ("Fancy Feast") and `name` = `"Line — Flavor"`
(em dash, `&` not "and", no trailing "Feast", no "in Gravy" for gravy lines). `normalizeFood()` in
`js/foods.js` enforces this for anything typed or scanned; add new product lines to `LINES` there.
The picker (`mountFoodPicker` in app.js) is search-as-you-type, grouped Brand · Line, with
"Recently fed" first. Picker selection is by `foodKey()`, never by catalog index.

## Barcode lookup
Unknown barcode → `lookupProduct()` → `store.lookupUpc()` calls the `upc-lookup` Edge Function
(UPCitemdb free trial, ~100/day, then Open Pet Food Facts / Open Food Facts), then falls back to
calling Open Food Facts from the browser. `parseProductTitle()` turns the retailer title into
brand/line/flavor to pre-fill the form. The function checks sign-in itself, so it's deployed with
`verify_jwt: false` (`supabase functions deploy upc-lookup --no-verify-jwt`).

## Insights tab
Order: Suggested next → Favorites → Most fed → KPIs / breakdown / trend (all-time).
Logic lives in `js/insights.js`:
- `inWindow(entries, 'week'|'month'|'3mo'|'all')` — boards default to `month` (`state.prefWindow`,
  `state.freqWindow`); boards show top 10 + "See all" modal.
- `preferenceBoard` ranks by average rating shrunk toward her overall average (`PRIOR_WEIGHT` = 2
  phantom feedings) so one-off ratings don't dominate; displays the plain average.
- `suggestions` = foods fed before, not in the last 2 days, scored by recency-weighted rating
  (30-day half-life, shrunk toward overall avg) + up to +0.3 variety bonus for 14+ days since fed.
  Tapping one calls `openEntryModal({ brand, name })` to preselect it.

## Auth (shared mode)
- **Passwordless email OTP, invite-only.** `store.sendCode(email)` (shouldCreateUser:false) →
  `store.verifyCode(email, token)`. Login gate lives in `app.js` (`showLoginGate` et al.).
- Supabase issues **8-digit** codes — the code input is length-agnostic; don't hard-code 6.
- Users are pre-created in Supabase → Auth → Users. **To add the house sitter**: add their email
  there (any throwaway password — the app never uses it). No code change / redeploy needed.
- **Email delivery is via Gmail custom SMTP** configured in the Supabase dashboard (the built-in
  sender only mails project members). The Gmail **app password lives only in Supabase**, never in
  this repo. The "Magic Link" email template must contain `{{ .Token }}` (not ConfirmationURL).

## Security / RLS
- Row Level Security is **locked to authenticated users**: policies are `for all to authenticated
  using (true) with check (true)` on all four tables. Anonymous REST returns `[]` and 401.
- The `sb_publishable_...` key in `config.js` is a **public client key** — safe to commit; security
  is enforced by RLS, not key secrecy. **Never commit** the service_role key or the SMTP password.
- Gotcha: any code path that queries Supabase **before login** will fail post-lockdown. `seedFirstRun`
  is guarded to skip in shared mode for exactly this reason.

## Deploying a change
1. Edit files. Test locally (blank-config local mode; restore keys before commit).
2. `git add -A && git commit -m "..." && git push origin main`
3. GitHub Pages redeploys `main` in ~1 min. Verify with `curl` against the live URL if needed.
4. On phones (added to home screen), pull down to refresh to pick up the new version.

## Conventions
- Match the existing vanilla-JS style: small helpers, `$`/`$$` DOM selectors, template-string HTML,
  `escapeHtml`/`escapeAttr` on any interpolated user data.
- Entry form is its own modal layer (`#entryBackdrop`, z-index 45) below the utility modal (z 50)
  so Scan / Add-food can stack on top.
- End commit messages with the Co-Authored-By trailer if that's the repo convention in git log.
```
git log --oneline   # to see recent history / conventions
```
