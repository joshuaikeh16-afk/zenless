// ════════════════════════════════════════════════════════════════
//  /api/shop/buy.js  —  Vercel serverless function
//
//  Handles purchases from the "Items" tab in shop.html (bank capacity
//  upgrades + tools: shovel / fishing_rod / gun). Card purchases are
//  NOT handled here — those still go through /api/buy and the bot's
//  economy server, untouched.
//
//  This endpoint talks to Supabase directly (same `economy_full`
//  table + JSONB `data` column the rest of the site uses), since that
//  is the source of truth for primos/bankCapacity/inventory on the
//  website. It does the read-modify-write itself so it can run the
//  "do they have enough primos" / "do they already own this" checks
//  server-side, where a malicious client can't skip them.
//
//  Item types it understands, matching items-catalog.js:
//    - type: "upgrade"  (bank_small, bank_medium, ...) → adds to
//      bankCapacity, deducts price from primos.
//    - type: "tool"     (shovel, fishing_rod, gun)      → sets
//      inventory.<id> = 1, deducts price from primos. Rejected if the
//      user already owns that tool (inventory.<id> >= 1).
//    - type: "service"  (lottery_ticket)                → deducts
//      price from primos only; no inventory/bankCapacity change here,
//      since lottery entry is presumably tracked elsewhere (bot side).
//      Flag this if that's wrong — easy to extend.
//
//  Env vars expected (set these in Vercel → Project → Settings →
//  Environment Variables): SUPABASE_URL, SUPABASE_KEY, SUPABASE_TABLE.
//  Fallbacks below match the values already used elsewhere on the site
//  so this keeps working even if you haven't set them yet — but the
//  key should really live server-side only at some point.
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL   = process.env.SUPABASE_URL   || 'https://padybdvevwazfilxopqy.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_KEY   || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZHliZHZldndhemZpbHhvcHF5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM5OTgwNCwiZXhwIjoyMDkyOTc1ODA0fQ.bI3epdb6N4T21At5xkAHcJnKbPKUd0-l2vzr4xGZN8w';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'economy_full';

// Mirror to the WhatsApp bot's separate economy store, keyed by `lid`
// (NOT the Supabase row id). This is server-side, so — unlike a browser
// call — it's not blocked by mixed-content rules and can hit the bot's
// plain http:// endpoint directly. Best-effort: if this fails we still
// return success for the Supabase write, since that's the website's
// source of truth, but we log it so failures are visible.
const BOT_ECONOMY_BASE = 'http://jobs.hidencloud.com:24633/api/economy/users';
const BOT_ECONOMY_KEY  = process.env.BOT_ECONOMY_KEY || '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0';

async function syncBotEconomy(lid, payload) {
  if (!lid) return false;
  try {
    const res = await fetch(`${BOT_ECONOMY_BASE}/${encodeURIComponent(lid)}`, {
      method: 'PATCH',
      headers: { 'x-api-key': BOT_ECONOMY_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error('[shop/buy] Bot economy sync error', err);
    return false;
  }
}

// Keep this in sync with /data/items-catalog.js. Re-declared here (not
// imported) because Vercel functions run in their own isolated bundle —
// duplicating a small static catalog is simpler than wiring up shared
// module resolution for ~10 items. If items-catalog.js changes, mirror
// the change here too.
const CARD_SHOP = {
  tools: [
    { id: 'shovel',      name: '⛏️ Basic Shovel',  price: 5000,  type: 'tool' },
    { id: 'fishing_rod', name: '🎣 Fishing Rod',    price: 8000,  type: 'tool' },
    { id: 'gun',         name: '🔫 Robber\'s Gun',  price: 15000, type: 'tool' },
  ],
  upgrades: [
    { id: 'bank_small',   name: '🏦 Small Bank Upgrade',   price: 10000,  type: 'upgrade', capacity: 50000 },
    { id: 'bank_medium',  name: '🏦 Medium Bank Upgrade',  price: 25000,  type: 'upgrade', capacity: 100000 },
    { id: 'bank_large',   name: '🏦 Large Bank Upgrade',   price: 50000,  type: 'upgrade', capacity: 250000 },
    { id: 'bank_premium', name: '🏦 Premium Bank Upgrade', price: 250000, type: 'upgrade', capacity: 1000000 },
    { id: 'bank_3m',      name: '🏦 Elite Bank Vault',     price: 500000, type: 'upgrade', capacity: 3000000 },
    { id: 'bank_5m',      name: '🏦 Titan Bank Vault',     price: 750000, type: 'upgrade', capacity: 5000000 },
  ],
  services: [
    { id: 'lottery_ticket', name: '🎟️ Lottery Ticket', price: 250000, type: 'service' },
  ],
};

function getItemById(itemId) {
  const all = [...CARD_SHOP.tools, ...CARD_SHOP.upgrades, ...CARD_SHOP.services];
  return all.find(i => i.id === itemId);
}

async function supabaseQuery(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}`);
  return res.json();
}

async function supabasePatch(id, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Supabase PATCH matched 0 rows');
  return rows[0];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed — use POST' });
  }

  if (!SUPABASE_KEY) {
    return res.status(500).json({ success: false, error: 'Server misconfigured: SUPABASE_KEY not set' });
  }

  const { buyerId, item_id } = req.body || {};
  if (!buyerId || !item_id) {
    return res.status(400).json({ success: false, error: 'Missing buyerId or item_id' });
  }

  const item = getItemById(item_id);
  if (!item) {
    return res.status(404).json({ success: false, error: `Unknown item_id "${item_id}"` });
  }

  let rows;
  try {
    rows = await supabaseQuery(`${SUPABASE_TABLE}?id=eq.${encodeURIComponent(buyerId)}&select=*`);
  } catch (err) {
    console.error('[shop/buy] Supabase lookup error', err);
    return res.status(502).json({ success: false, error: 'Could not reach the database — try again.' });
  }

  const row = rows?.[0];
  if (!row) {
    return res.status(404).json({ success: false, error: 'Player not found.' });
  }

  const data   = row.data || {};
  const primos = Number(data.primos) || 0;

  // ── Check 1: enough primos? ──────────────────────────────────
  if (primos < item.price) {
    return res.status(400).json({
      success: false,
      error: `Not enough Primos. You have ${primos.toLocaleString()}, need ${item.price.toLocaleString()}.`,
    });
  }

  const updates = { primos: primos - item.price };

  if (item.type === 'tool') {
    // ── Check 2 (tools only): already own this tool? ────────────
    const inventory = (data.inventory && typeof data.inventory === 'object' && !Array.isArray(data.inventory))
      ? data.inventory
      : {}; // older rows may still have inventory as an array — treat as empty rather than crash
    if (inventory[item.id] && inventory[item.id] >= 1) {
      return res.status(400).json({ success: false, error: `You already own the ${item.name}.` });
    }
    updates.inventory = { ...inventory, [item.id]: 1 };
  } else if (item.type === 'upgrade') {
    const currentCapacity = Number(data.bankCapacity) || 0;
    updates.bankCapacity = currentCapacity + (item.capacity || 0);
  }
  // type === 'service' (lottery_ticket): primos deduction only, see header note.

  let updatedRow;
  try {
    updatedRow = await supabasePatch(buyerId, { data: { ...data, ...updates } });
  } catch (err) {
    console.error('[shop/buy] Supabase write error', err);
    return res.status(502).json({ success: false, error: 'Purchase could not be saved — try again. You were NOT charged.' });
  }

  // Mirror the updated fields to the bot's economy store too. lid lives on
  // the same data object Supabase just confirmed — best-effort, doesn't
  // block or fail the response if the bot is unreachable.
  await syncBotEconomy(updatedRow.data.lid, {
    primos: updatedRow.data.primos,
    ...(updates.bankCapacity !== undefined ? { bankCapacity: updatedRow.data.bankCapacity } : {}),
    ...(updates.inventory    !== undefined ? { inventory: updatedRow.data.inventory }       : {}),
  });

  return res.status(200).json({
    success: true,
    item: { id: item.id, name: item.name, price: item.price, type: item.type },
    primos: updatedRow.data.primos,
    bankCapacity: updatedRow.data.bankCapacity,
    inventory: updatedRow.data.inventory,
  });
}
