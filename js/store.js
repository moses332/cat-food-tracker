// Data layer. Exposes one async `store` API to the rest of the app so the UI
// never cares whether data lives in localStorage (local mode) or Supabase
// (shared mode). Swapping backends is just flipping config.js.

import { STARTER_FOODS } from './data.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, SYNC_ENABLED } from './config.js';

const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2));

// ── Local backend (default) ────────────────────────────────────────────────
// Everything in one JSON blob under a single key. Simple and plenty fast for
// a household-scale log.
const LS_KEY = 'cat-food-tracker:v1';

function emptyDb() {
  return { pets: [], foods: [], entries: [], barcodes: [] };
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...emptyDb(), ...JSON.parse(raw) } : emptyDb();
  } catch {
    return emptyDb();
  }
}

function saveLocal(db) {
  localStorage.setItem(LS_KEY, JSON.stringify(db));
}

const localBackend = {
  mode: 'local',

  async getPets() {
    return loadLocal().pets.slice().sort((a, b) => a.name.localeCompare(b.name));
  },
  async addPet(pet) {
    const db = loadLocal();
    const row = { id: uid(), created_at: new Date().toISOString(), ...pet };
    db.pets.push(row);
    saveLocal(db);
    return row;
  },
  async updatePet(id, patch) {
    const db = loadLocal();
    const p = db.pets.find(x => x.id === id);
    if (p) Object.assign(p, patch);
    saveLocal(db);
    return p;
  },
  async deletePet(id) {
    const db = loadLocal();
    db.pets = db.pets.filter(p => p.id !== id);
    db.entries = db.entries.filter(e => e.pet_id !== id);
    saveLocal(db);
  },

  async getCustomFoods() {
    return loadLocal().foods.slice();
  },
  async addCustomFood(food) {
    const db = loadLocal();
    const row = { id: uid(), created_at: new Date().toISOString(), ...food };
    db.foods.push(row);
    saveLocal(db);
    return row;
  },

  async getBarcodes() {
    return loadLocal().barcodes.slice();
  },
  async addBarcode(mapping) {
    const db = loadLocal();
    // One mapping per code: replace if this barcode was linked before.
    db.barcodes = db.barcodes.filter(b => b.code !== mapping.code);
    const row = { id: uid(), created_at: new Date().toISOString(), ...mapping };
    db.barcodes.push(row);
    saveLocal(db);
    return row;
  },

  async getEntries(petId) {
    const db = loadLocal();
    return db.entries
      .filter(e => !petId || e.pet_id === petId)
      .sort((a, b) => new Date(b.fed_at) - new Date(a.fed_at));
  },
  async addEntry(entry) {
    const db = loadLocal();
    const row = { id: uid(), created_at: new Date().toISOString(), ...entry };
    db.entries.push(row);
    saveLocal(db);
    return row;
  },
  async updateEntry(id, patch) {
    const db = loadLocal();
    const e = db.entries.find(x => x.id === id);
    if (e) Object.assign(e, patch);
    saveLocal(db);
    return e;
  },
  async deleteEntry(id) {
    const db = loadLocal();
    db.entries = db.entries.filter(e => e.id !== id);
    saveLocal(db);
  },

  async exportAll() {
    return loadLocal();
  },
  async importAll(db) {
    saveLocal({ ...emptyDb(), ...db });
  },
};

// ── Supabase backend (shared mode) ─────────────────────────────────────────
// Loaded lazily from CDN only when sync is configured, so local mode has zero
// network dependency. Table schema lives in README.md.
async function makeSupabaseBackend() {
  const { createClient } = await import(
    'https://esm.sh/@supabase/supabase-js@2'
  );
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const must = (res) => {
    if (res.error) throw res.error;
    return res.data;
  };

  return {
    mode: 'shared',

    // ── Auth (passwordless email OTP) ──
    async getUser() {
      const { data } = await sb.auth.getUser();
      return data?.user ?? null;
    },
    async sendCode(email) {
      // shouldCreateUser:false → invite-only (unknown emails are rejected).
      const { error } = await sb.auth.signInWithOtp({
        email, options: { shouldCreateUser: false },
      });
      if (error) throw error;
    },
    async verifyCode(email, token) {
      const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      return data.user;
    },
    async setDisplayName(name) {
      const { data, error } = await sb.auth.updateUser({ data: { name } });
      if (error) throw error;
      return data.user;
    },
    async signOut() {
      await sb.auth.signOut();
    },

    async getPets() {
      return must(await sb.from('pets').select('*').order('name'));
    },
    async addPet(pet) {
      return must(await sb.from('pets').insert(pet).select().single());
    },
    async updatePet(id, patch) {
      return must(await sb.from('pets').update(patch).eq('id', id).select().single());
    },
    async deletePet(id) {
      must(await sb.from('pets').delete().eq('id', id));
    },

    async getCustomFoods() {
      return must(await sb.from('foods').select('*'));
    },
    async addCustomFood(food) {
      return must(await sb.from('foods').insert(food).select().single());
    },

    async getBarcodes() {
      return must(await sb.from('barcodes').select('*'));
    },
    async addBarcode(mapping) {
      // Upsert on the unique `code` so re-linking a barcode updates it.
      return must(await sb.from('barcodes').upsert(mapping, { onConflict: 'code' }).select().single());
    },

    async getEntries(petId) {
      let q = sb.from('entries').select('*').order('fed_at', { ascending: false });
      if (petId) q = q.eq('pet_id', petId);
      return must(await q);
    },
    async addEntry(entry) {
      return must(await sb.from('entries').insert(entry).select().single());
    },
    async updateEntry(id, patch) {
      return must(await sb.from('entries').update(patch).eq('id', id).select().single());
    },
    async deleteEntry(id) {
      must(await sb.from('entries').delete().eq('id', id));
    },

    async exportAll() {
      return {
        pets: await this.getPets(),
        foods: await this.getCustomFoods(),
        entries: await this.getEntries(),
        barcodes: await this.getBarcodes(),
      };
    },
    async importAll(db) {
      if (db.pets?.length) must(await sb.from('pets').insert(db.pets));
      if (db.foods?.length) must(await sb.from('foods').insert(db.foods));
      if (db.entries?.length) must(await sb.from('entries').insert(db.entries));
      if (db.barcodes?.length) must(await sb.from('barcodes').insert(db.barcodes));
    },
  };
}

// ── Public store ────────────────────────────────────────────────────────────
let backend = localBackend;

export async function initStore() {
  if (SYNC_ENABLED) {
    try {
      backend = await makeSupabaseBackend();
    } catch (err) {
      console.error('Sync setup failed, falling back to local mode:', err);
      backend = localBackend;
    }
  }
  await seedFirstRun();
  return backend.mode;
}

// Combine the static Fancy Feast starter list with any user-added foods, and
// de-dupe by label so custom + starter never collide visually.
export async function getFoodCatalog() {
  const custom = await backend.getCustomFoods();
  const starters = STARTER_FOODS.map(f => ({ ...f, id: `starter:${f.brand}|${f.name}`, starter: true }));
  const all = [...starters, ...custom];
  const seen = new Set();
  return all.filter(f => {
    const key = `${(f.brand || '').toLowerCase()}|${f.name.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function seedFirstRun() {
  // Local only: give a brand-new install a default pet so it's usable instantly.
  // In shared mode we must NOT query here — it runs before sign-in, and once
  // the database is locked to authenticated users an anonymous read would fail.
  if (backend.mode !== 'local') return;
  const pets = await backend.getPets();
  if (pets.length === 0) {
    await backend.addPet({ name: 'My Cat', species: 'Cat', notes: '' });
  }
}

export const store = new Proxy({}, {
  get: (_t, prop) => (...args) => backend[prop](...args),
});

export function syncMode() {
  return backend.mode;
}
