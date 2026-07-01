// ════════════════════════════════════════════════════════════════
//  /api/claim-pp.js  —  Vercel serverless function
//
//  Handles the daily Prime Points claim. Does the 24h cooldown
//  check and the Supabase write server-side, so a browser-side
//  PATCH failure can no longer cause `lastClaimAt` to silently
//  not save (which was the bug: the UI showed "claimed!" because
//  it trusted the local state, but the DB never got `lastClaimAt`
//  so every new tab showed the claim as available again).
//
//  Also mirrors the new primePoints total to the WhatsApp bot's
//  economy store, same as buy.js / invest.js.
// ════════════════════════════════════════════════════════════════

const SUPABASE_URL   = process.env.SUPABASE_URL   || 'https://padybdvevwazfilxopqy.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_KEY   || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZHliZHZldndhemZpbHhvcHF5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM5OTgwNCwiZXhwIjoyMDkyOTc1ODA0fQ.bI3epdb6N4T21At5xkAHcJnKbPKUd0-l2vzr4xGZN8w';
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'economy_full';

const BOT_ECONOMY_BASE = 'http://jobs.hidencloud.com:24633/api/economy/users';
const BOT_ECONOMY_KEY  = process.env.BOT_ECONOMY_KEY || '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0';

const CLAIM_AMOUNT      = 50;
const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const HISTORY_CAP       = 30;

function calcRank(pp) {
  pp = Number(pp) || 0;
  if (pp >= 25000) return 'Diamond';
  if (pp >= 10000) return 'Platinum';
  if (pp >= 5000)  return 'Gold';
  if (pp >= 2000)  return 'Silver';
  if (pp >= 500)   return 'Bronze';
  return 'Rookie';
}

async function syncBotEconomy(lid, payload) {
  if (!lid) return;
  try {
    await fetch(`${BOT_ECONOMY_BASE}/${encodeURIComponent(lid)}`, {
      method: 'PATCH',
      headers: { 'x-api-key': BOT_ECONOMY_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[claim-pp] Bot sync error', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed — use POST' });
  }

  const { userId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ success: false, error: 'Missing userId' });
  }

  // ── 1. Fetch current row from Supabase ───────────────────────
  let row;
  try {
    const fetchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(userId)}&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!fetchRes.ok) throw new Error(`Supabase GET ${fetchRes.status}`);
    const rows = await fetchRes.json();
    row = rows?.[0];
  } catch (err) {
    console.error('[claim-pp] Supabase fetch error', err);
    return res.status(502).json({ success: false, error: 'Could not reach the database — try again.' });
  }

  if (!row) {
    return res.status(404).json({ success: false, error: 'Player not found.' });
  }

  const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) || {};

  // ── 2. Check 24h cooldown ────────────────────────────────────
  const lastClaimAt   = data.lastClaimAt ? new Date(data.lastClaimAt).getTime() : 0;
  const msElapsed     = Date.now() - lastClaimAt;
  const msRemaining   = CLAIM_COOLDOWN_MS - msElapsed;

  if (msRemaining > 0) {
    return res.status(200).json({
      success: true,
      claimed: false,
      msRemaining,
    });
  }

  // ── 3. Build the updated data object ────────────────────────
  const currentPP  = Number(data.primePoints) || 0; // ← no false default to 100
  const newPoints  = currentPP + CLAIM_AMOUNT;
  const newHistory = Array.isArray(data.ppHistory) ? [...data.ppHistory] : [];
  newHistory.unshift({ amount: CLAIM_AMOUNT, reason: 'Daily claim', granted_by: 'system', timestamp: new Date().toISOString() });
  if (newHistory.length > HISTORY_CAP) newHistory.length = HISTORY_CAP;

  const updatedData = {
    ...data,
    primePoints: newPoints,
    rank:        calcRank(newPoints),
    ppHistory:   newHistory,
    lastClaimAt: new Date().toISOString(),
  };

  // ── 4. Write back to Supabase ────────────────────────────────
  let updatedRow;
  try {
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        headers: {
          apikey:             SUPABASE_KEY,
          Authorization:      `Bearer ${SUPABASE_KEY}`,
          'Content-Type':     'application/json',
          Prefer:             'return=representation',
        },
        body: JSON.stringify({ data: updatedData }),
      }
    );
    if (!patchRes.ok) throw new Error(`Supabase PATCH ${patchRes.status}`);
    const rows = await patchRes.json();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('PATCH matched 0 rows');
    updatedRow = rows[0];
  } catch (err) {
    console.error('[claim-pp] Supabase write error', err);
    return res.status(502).json({
      success: false,
      error: 'Claim could not be saved — try again. Your PP was NOT changed.',
    });
  }

  // ── 5. Mirror to bot economy (best-effort) ───────────────────
  await syncBotEconomy(data.lid, { primePoints: newPoints });

  return res.status(200).json({
    success: true,
    claimed: true,
    amount:      CLAIM_AMOUNT,
    primePoints: newPoints,
    rank:        calcRank(newPoints),
    lastClaimAt: updatedRow.data.lastClaimAt,
  });
}
