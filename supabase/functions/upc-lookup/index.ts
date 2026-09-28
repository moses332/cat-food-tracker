// Supabase Edge Function: upc-lookup
//
// Barcode → product title, for pre-filling "New can scanned". The browser
// can't call UPCitemdb directly (no CORS), so the app calls this instead:
//   sb.functions.invoke('upc-lookup', { body: { code } })
// → { found: true, title, brand, source } | { found: false }
//
// Sources, in order:
//   1. UPCitemdb free trial endpoint (no key; ~100 lookups/day)
//   2. Open Pet Food Facts, then Open Food Facts (free, open data)
// Only signed-in users can call it (checked in isSignedIn below).
//
// Deploy: via the Supabase dashboard/MCP, or
//   supabase functions deploy upc-lookup --no-verify-jwt

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function fetchJson(url: string, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'PickyPaws/1.0 (cat food tracker)' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function upcItemDb(code: string) {
  const data = await fetchJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`);
  const item = data?.items?.[0];
  if (!item?.title) return null;
  return { title: item.title as string, brand: (item.brand || '') as string, source: 'upcitemdb' };
}

async function openFacts(host: string, code: string) {
  const data = await fetchJson(`${host}/api/v2/product/${code}.json?fields=product_name,brands`);
  const p = data?.product;
  const name = (p?.product_name || '').trim();
  if (!name) return null;
  const brand = (p?.brands || '').split(',')[0].trim();
  const title = name.toLowerCase().includes(brand.toLowerCase()) ? name : `${brand} ${name}`.trim();
  return { title, brand, source: new URL(host).hostname };
}

// Signed-in Picky Paws users only. Checked here (not via the gateway's
// verify_jwt flag) so it works with Supabase's newer signing keys too.
async function isSignedIn(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const url = Deno.env.get('SUPABASE_URL');
  const key = req.headers.get('apikey') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: key } });
  if (!res.ok) return false;
  const user = await res.json().catch(() => null);
  return Boolean(user?.id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!(await isSignedIn(req))) return json({ found: false, error: 'sign in required' }, 401);

  // POST { code } from the app; GET ?code= also works (handy for testing).
  let code = new URL(req.url).searchParams.get('code') ?? '';
  if (req.method === 'POST') {
    try { code = String((await req.json())?.code ?? ''); } catch { /* fall through */ }
  }
  code = code.replace(/\D/g, '');
  if (code.length < 8 || code.length > 14) return json({ found: false, error: 'bad code' }, 400);

  // Try the code as scanned, plus UPC-A ⇄ EAN-13 (leading zero) variants.
  const variants = [...new Set([code, code.replace(/^0+(?=\d{12}$)/, ''), code.length === 12 ? '0' + code : code])];

  for (const c of variants) {
    const hit = await upcItemDb(c);
    if (hit) return json({ found: true, ...hit });
  }
  for (const host of ['https://world.openpetfoodfacts.org', 'https://world.openfoodfacts.org']) {
    for (const c of variants) {
      const hit = await openFacts(host, c);
      if (hit) return json({ found: true, ...hit });
    }
  }
  return json({ found: false });
});
