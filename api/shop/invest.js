// ════════════════════════════════════════════════════════════════
//  /api/shop/invest.js  —  Vercel serverless function
//
//  Buy/sell for the Investments tab (Global Financial Exchange).
//  Holdings live in data.assets — e.g. { gold: 0, stark: 0, land: 0,
//  tech: 0, fuel: 0, ... } — confirmed against a real user row. Each
//  asset has a flat `rate` (primos per 1 unit); buying spends
//  primos and adds units, selling removes units and pays out primos
//  at the same rate. No price drift here — if the bot's real .invest
//  command has live/fluctuating rates, this endpoint should eventually
//  read those from wherever the bot stores them rather than the
//  static catalog. Flag this if rates are meant to move over time.
//
//  Same read-modify-write-on-Supabase pattern as /api/shop/buy.js,
//  so a malicious client can't fake "I can afford this" or "I already
//  hold enough to sell this" — both checks happen server-side.
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL   = process.env.SUPABASE_URL   || 'https://padybdvevwazfilxopqy.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_KEY   || '';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'economy_full';

// Keep in sync with /data/items-catalog.js → CARD_SHOP.investments.
const INVESTMENTS = [
  { id: 'gold',  name: '🥇 Solid Gold Bullion',         rate: 42396,   riskPct: 0 },
  { id: 'stark', name: '📈 StarkCorp High-Yield Shares', rate: 2207,    riskPct: 2 },
  { id: 'land',  name: '🗺️ Commercial Real Estate Deed', rate: 1186936, riskPct: 0 },
  { id: 'oil',   name: '🛢️ Crude Oil Futures',           rate: 3000,    riskPct: 2 },
  { id: 'tech',  name: '💾 Quantum Computing Chips',     rate: 376580,  riskPct: 5 },
  { id: 'bonds', name: '📜 Sovereign Treasury Bonds',    rate: 207290,  riskPct: 0 },
  { id: 'art',   name: '🎨 Digital Asset Collectible',   rate: 139,     riskPct: 10 },
];

function getInvestmentById(id) {
  return INVESTMENTS.find(a => a.id === id);
}

async function supabaseQuery(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
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

  const { buyerId, asset_id, action, amount } = req.body || {};
  const qty = Number(amount);

  if (!buyerId || !asset_id || !['buy', 'sell'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Missing or invalid buyerId, asset_id, or action ("buy"/"sell").' });
  }
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
    return res.status(400).json({ success: false, error: 'amount must be a positive whole number.' });
  }

  const asset = getInvestmentById(asset_id);
  if (!asset) {
    return res.status(404).json({ success: false, error: `Unknown asset_id "${asset_id}"` });
  }

  let rows;
  try {
    rows = await supabaseQuery(`${SUPABASE_TABLE}?id=eq.${encodeURIComponent(buyerId)}&select=*`);
  } catch (err) {
    console.error('[shop/invest] Supabase lookup error', err);
    return res.status(502).json({ success: false, error: 'Could not reach the database — try again.' });
  }

  const row = rows?.[0];
  if (!row) return res.status(404).json({ success: false, error: 'Player not found.' });

  const data    = row.data || {};
  const primos  = Number(data.primos) || 0;
  const assets  = (data.assets && typeof data.assets === 'object' && !Array.isArray(data.assets)) ? data.assets : {};
  const holding = Number(assets[asset.id]) || 0;
  const cost    = asset.rate * qty;

  let updates;

  if (action === 'buy') {
    // ── Check: enough primos to buy `qty` units? ─────────────────
    if (primos < cost) {
      return res.status(400).json({
        success: false,
        error: `Not enough Primos. Buying ${qty.toLocaleString()} ${asset.name} costs ${cost.toLocaleString()}, you have ${primos.toLocaleString()}.`,
      });
    }
    updates = {
      primos: primos - cost,
      assets: { ...assets, [asset.id]: holding + qty },
    };
  } else {
    // ── Check: enough units held to sell `qty`? ──────────────────
    if (holding < qty) {
      return res.status(400).json({
        success: false,
        error: `You only hold ${holding.toLocaleString()} ${asset.name}, can't sell ${qty.toLocaleString()}.`,
      });
    }
    updates = {
      primos: primos + cost,
      assets: { ...assets, [asset.id]: holding - qty },
    };
  }

  let updatedRow;
  try {
    updatedRow = await supabasePatch(buyerId, { data: { ...data, ...updates } });
  } catch (err) {
    console.error('[shop/invest] Supabase write error', err);
    return res.status(502).json({ success: false, error: 'Trade could not be saved — try again. Nothing was charged.' });
  }

  return res.status(200).json({
    success: true,
    action,
    asset: { id: asset.id, name: asset.name, rate: asset.rate },
    amount: qty,
    primos: updatedRow.data.primos,
    holding: updatedRow.data.assets?.[asset.id] ?? 0,
  });
}
