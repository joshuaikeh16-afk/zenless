const API = (() => {
  const { url, key, table } = CONFIG.supabase;
 
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
 
  async function query(params = '') {
    try {
      const res = await fetch(`${url}/rest/v1/${table}${params}`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[API Error]', err);
      return null;
    }
  }
 
  async function patch(id, body) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Supabase still returns res.ok when 0 rows matched the filter (e.g. a
      // bad id) — that's a silent no-op write, not a success, so treat it as one.
      if (Array.isArray(data) && data.length === 0) {
        console.error('[API Patch Error] No row matched id', id);
        return null;
      }
      return data;
    } catch (err) {
      console.error('[API Patch Error]', err);
      return null;
    }
  }
 
  // Update a user's nested JSONB data field
  // Merges `updates` into the existing data object
  async function updateUserData(id, currentData, updates) {
    const merged = { ...currentData, ...updates };
    return patch(id, { data: merged });
  }
 
  // ── Cashout Requests ──────────────────────────────────────────
  async function getCashouts() {
    try {
      const res = await fetch(`${url}/rest/v1/cashout_requests?select=*&order=created_at.desc`, { headers });
      if (!res.ok) return [];
      return await res.json();
    } catch { return []; }
  }
 
  async function createCashout(body) {
    try {
      const res = await fetch(`${url}/rest/v1/cashout_requests`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch { return false; }
  }
 
  async function updateCashout(id, body) {
    try {
      const res = await fetch(`${url}/rest/v1/cashout_requests?id=eq.${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch { return false; }
  }
 
  // ── Guilds ────────────────────────────────────────────────────
  async function getGuildMembers(guildName) {
    return query(`?data->>guild=ilike.${encodeURIComponent(guildName)}&select=*`);
  }
 
  return {
    getAllUsers:       () => query('?select=*&order=data->>primos.desc.nullslast'),
    getUserByPhone:   (phone) => query(`?data->>phoneNumber=eq.${encodeURIComponent(phone)}&select=*`),
    getUserById:      (id) => query(`?id=eq.${encodeURIComponent(id)}&select=*`),
    getLeaderboard:   (limit = 20) => query(`?select=*&order=data->>primos.desc.nullslast&limit=${limit}`),
    getPPLeaderboard: (limit = 20) => query(`?select=*&order=data->>primePoints.desc.nullslast&limit=${limit}`),
    searchUsers:      (term) => query(`?data->>name=ilike.*${encodeURIComponent(term)}*&select=*`),
    updateUser:       patch,
    updateUserData,
    getGuildMembers,
    getCashouts,
    createCashout,
    updateCashout,
  };
})();

// ── WhatsApp Bot Economy mirror ───────────────────────────────────────
// The WhatsApp bot (waifu.js / deck-lookup.js etc.) reads its own copy of
// each user's economy data from a separate API, keyed by phone number.
// Whenever Prime Points change in Supabase we also push the new total
// over there so bot commands (.deck, etc.) stay in sync.
//
// This is BEST-EFFORT ONLY: Supabase remains the source of truth for PP.
// If this call fails (network blip, CORS, bot offline) we just log it —
// we never block or roll back the Supabase write because of it.
//
// NOTE: this endpoint is plain http:// on a non-standard port. Since the
// site itself is served over https:// (GitHub Pages), browsers will block
// this as "mixed content" unless the bot host is moved behind https, or
// this call is proxied through something that is. Worth testing in a real
// browser console (not just locally) to confirm it actually fires.
const BOT_ECONOMY_URL = 'http://jobs.hidencloud.com:24633/api/economy/users';
const BOT_ECONOMY_KEY = '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0';

async function syncBotEconomyPP(phone, primePoints) {
  if (!phone) return false;
  try {
    const res = await fetch(`${BOT_ECONOMY_URL}/${encodeURIComponent(phone)}`, {
      method: 'PATCH',
      headers: {
        'x-api-key': BOT_ECONOMY_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ primePoints }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error('[Bot Economy Sync Error]', err);
    return false;
  }
}

// ── Prime Points (Supabase) ───────────────────────────────────────────
// Replaces the old MongoDB-backed PP system. Prime Points, history, rank,
// and the daily-claim cooldown all live inside the same `data` JSONB
// column Supabase already uses for coins/cards/etc on each user row.
//
// Every function here takes the user's row id plus their *current* raw
// data object (e.g. user._raw from App.parseUser) and returns the new
// values after merging the change in. Callers are responsible for
// updating their own local copy of that user from the result.
const PPApi = (() => {
  const CLAIM_AMOUNT      = 50;                   // PP awarded per daily claim
  const CLAIM_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // 24h between claims
  const HISTORY_CAP       = 30;                   // PP history entries kept per user
  const PP_TO_COIN_RATE   = 2000;                 // 1 PP = 2,000 Prime Coins (Primos)

  function calcRank(pp) {
    pp = Number(pp) || 0;
    if (pp >= 25000) return 'Diamond';
    if (pp >= 10000) return 'Platinum';
    if (pp >= 5000)  return 'Gold';
    if (pp >= 2000)  return 'Silver';
    if (pp >= 500)   return 'Bronze';
    return 'Rookie';
  }

  function pushHistory(data, amount, reason, grantedBy) {
    const history = Array.isArray(data.ppHistory) ? data.ppHistory.slice() : [];
    history.unshift({ amount, reason, granted_by: grantedBy, timestamp: new Date().toISOString() });
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
    return history;
  }

  // Grant or deduct PP. `delta` can be negative. `data` must be the user's
  // current raw data object — pass user._raw, not a stale/partial copy.
  // Returns { failed: true } if the Supabase write didn't actually save —
  // callers must check this before treating the change as applied.
  async function adjustPP(id, data, delta, reason, grantedBy = 'system') {
    data = data || {};
    const newPoints = Math.max(0, (data.primePoints || 0) + delta);
    const history   = pushHistory(data, delta, reason, grantedBy);
    const updates   = { primePoints: newPoints, rank: calcRank(newPoints), ppHistory: history };
    const result    = await API.updateUserData(id, data, updates);
    if (!result) return { failed: true };
    syncBotEconomyPP(data.phoneNumber, newPoints); // fire-and-forget, see note above
    return { primePoints: newPoints, rank: updates.rank, ppHistory: history };
  }

  // Read-only check — does NOT claim anything, just reports cooldown state
  function getClaimStatus(data) {
    const last = data?.lastClaimAt ? new Date(data.lastClaimAt).getTime() : 0;
    const msRemaining = CLAIM_COOLDOWN_MS - (Date.now() - last);
    return msRemaining > 0 ? { canClaim: false, msRemaining } : { canClaim: true, msRemaining: 0 };
  }

  // Claim today's free Prime Points. Returns { claimed: false, msRemaining }
  // if still on cooldown, { claimed: false, failed: true } if the save
  // didn't actually go through, or { claimed: true, amount, primePoints }
  // on confirmed success.
  async function claimDailyPP(id, data) {
    data = data || {};
    const status = getClaimStatus(data);
    if (!status.canClaim) return { claimed: false, msRemaining: status.msRemaining };

    const newPoints = (data.primePoints || 0) + CLAIM_AMOUNT;
    const history   = pushHistory(data, CLAIM_AMOUNT, 'Daily claim', 'system');
    const result    = await API.updateUserData(id, data, {
      primePoints: newPoints,
      rank: calcRank(newPoints),
      ppHistory: history,
      lastClaimAt: new Date().toISOString(),
    });
    if (!result) return { claimed: false, failed: true };
    syncBotEconomyPP(data.phoneNumber, newPoints); // fire-and-forget, see note above
    return { claimed: true, amount: CLAIM_AMOUNT, primePoints: newPoints };
  }

  return {
    CLAIM_AMOUNT, CLAIM_COOLDOWN_MS, PP_TO_COIN_RATE,
    calcRank, adjustPP, getClaimStatus, claimDailyPP,
  };
})();
