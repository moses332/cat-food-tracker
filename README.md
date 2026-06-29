# 🐱 Picky Paws — Cat Food Tracker

A tiny web app to track which cans your picky cat actually likes. Works on any
phone (iPhone + Android) through the browser — no app store needed. You can
"Add to Home Screen" to make it feel like a real app.

- **Food dropdown** scoped to Fancy Feast cans, with custom foods allowed
- **Initial reaction** vs **long-term reaction** on a 5-point scale
- **Time fed** defaults to now, editable for delayed entries
- **Barcode scanning** — point your phone camera at a can to pick the food
  (teach each can once, then it's recognized instantly forever)
- **Pet profiles** so it works for more pets / other people later
- **Insights**: acceptance rate, avg reaction, weekly trend, and a food
  leaderboard that flags foods she loves at first but cools on (the "drift" column)

---

## Run it right now (local mode)

It works immediately with **no setup** — data is saved in that browser only.

The app is plain static files, but browsers block ES modules opened via
`file://`, so serve the folder over a tiny local server:

```bash
# from the cat_food_tracker folder, pick whichever you have:
python -m http.server 8000
#   or
npx serve .
```

Then open `http://localhost:8000` (or the URL printed). On your phone, open the
same address using your computer's LAN IP (e.g. `http://192.168.1.5:8000`).

In local mode each device keeps its **own** log. To share one log across both
your phones, do the next part. ⤵️

---

## Turn on sharing (one free account, ~10 minutes)

This is the "simplest possible" path to shared data: **Supabase** gives you a
hosted database + API with no server to run.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor** and run this to create the tables:

   ```sql
   create extension if not exists "pgcrypto";

   create table pets (
     id uuid primary key default gen_random_uuid(),
     name text not null,
     species text default 'Cat',
     notes text default '',
     created_at timestamptz default now()
   );

   create table foods (
     id uuid primary key default gen_random_uuid(),
     brand text default '',
     name text not null,
     created_at timestamptz default now()
   );

   create table entries (
     id uuid primary key default gen_random_uuid(),
     pet_id uuid references pets(id) on delete cascade,
     food_brand text default '',
     food_name text not null,
     food_label text,
     initial_reaction text,
     longterm_reaction text,
     fed_at timestamptz not null,
     notes text default '',
     created_at timestamptz default now()
   );

   create table barcodes (
     id uuid primary key default gen_random_uuid(),
     code text unique not null,        -- the scanned UPC/EAN
     food_brand text default '',
     food_name text not null,
     food_label text,
     created_at timestamptz default now()
   );

   -- Simple shared-household access (anyone with the app can read/write).
   alter table pets     enable row level security;
   alter table foods    enable row level security;
   alter table entries  enable row level security;
   alter table barcodes enable row level security;
   create policy "open" on pets     for all using (true) with check (true);
   create policy "open" on foods    for all using (true) with check (true);
   create policy "open" on entries  for all using (true) with check (true);
   create policy "open" on barcodes for all using (true) with check (true);
   ```

3. In **Project Settings → API**, copy the **Project URL** and the **anon
   public** key.
4. Paste them into [`js/config.js`](js/config.js):

   ```js
   export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...your-anon-key...';
   ```

5. Reload. The header badge flips from **📵 Local** to **☁ Shared**, and both
   phones now see the same log.

> **Note on the open policy:** the SQL above lets anyone who has the app URL +
> anon key read and write. That's fine for a private link you share with your
> partner. If you later open it up to strangers, add Supabase Auth and tighten
> the policies to per-user rows. (Already have local data? Use **Pets → Export
> JSON**, switch on sharing, then **Import JSON**.)

---

## Put it online so it works anywhere (optional)

Local mode needs your PC running. To get a permanent URL both phones can use on
mobile data, drag this folder onto a free static host:

- **Netlify Drop** — [app.netlify.com/drop](https://app.netlify.com/drop): drag
  the folder, get a URL. (No account strictly required to start.)
- **Cloudflare Pages** or **GitHub Pages** also work — it's just static files.

Combine "online host" + "sharing on" and you've got a real, shared app on a URL.

---

## Project layout

```
index.html              app shell + tabs
css/styles.css          styling (mobile-first)
js/config.js            ← your Supabase keys go here
js/data.js              reaction scale + Fancy Feast starter catalog
js/store.js             data layer (local ⇄ Supabase, same API)
js/insights.js          KPI / trend calculations
js/scanner.js           camera barcode scanning (native + ZXing fallback)
js/app.js               UI rendering + events
manifest.webmanifest    makes it installable to home screen
```

> **Camera note:** browsers only allow camera access over **HTTPS** (or
> `localhost`). On `localhost` scanning works; over your LAN IP or once hosted,
> it must be `https://`. Netlify/Cloudflare/GitHub Pages all serve HTTPS by
> default, so a hosted deploy is the way to use scanning on both phones. The
> first scan of each can asks which food it is; after that it's recognized
> automatically. There's always a "type the number" fallback if a code won't
> scan.

## Ideas for later

- Photos of each can / her eating it
- "What should I open next?" suggestion based on her history
- Track time-of-day patterns (morning vs night pickiness)
- Per-can cost tracking and "favorite per dollar" KPI
