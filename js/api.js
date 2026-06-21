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
      return await res.json();
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
  const PP_TO_COIN_RATE   = 1000;                 // 1 PP = 1000 Prime Coins on withdrawal
  const INSTANT_LIMIT     = 5000;                 // PP at/above this needs manual (WhatsApp) review

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
  async function adjustPP(id, data, delta, reason, grantedBy = 'system') {
    data = data || {};
    const newPoints = Math.max(0, (data.primePoints || 0) + delta);
    const history   = pushHistory(data, delta, reason, grantedBy);
    const updates   = { primePoints: newPoints, rank: calcRank(newPoints), ppHistory: history };
    await API.updateUserData(id, data, updates);
    return { primePoints: newPoints, rank: updates.rank, ppHistory: history };
  }

  // Read-only check — does NOT claim anything, just reports cooldown state
  function getClaimStatus(data) {
    const last = data?.lastClaimAt ? new Date(data.lastClaimAt).getTime() : 0;
    const msRemaining = CLAIM_COOLDOWN_MS - (Date.now() - last);
    return msRemaining > 0 ? { canClaim: false, msRemaining } : { canClaim: true, msRemaining: 0 };
  }

  // Claim today's free Prime Points. Returns { claimed: false, msRemaining }
  // if still on cooldown, or { claimed: true, amount, primePoints } on success.
  async function claimDailyPP(id, data) {
    data = data || {};
    const status = getClaimStatus(data);
    if (!status.canClaim) return { claimed: false, msRemaining: status.msRemaining };

    const newPoints = (data.primePoints || 0) + CLAIM_AMOUNT;
    const history   = pushHistory(data, CLAIM_AMOUNT, 'Daily claim', 'system');
    await API.updateUserData(id, data, {
      primePoints: newPoints,
      rank: calcRank(newPoints),
      ppHistory: history,
      lastClaimAt: new Date().toISOString(),
    });
    return { claimed: true, amount: CLAIM_AMOUNT, primePoints: newPoints };
  }

  // Convert PP straight into Prime Coins. Caller routes amounts >= INSTANT_LIMIT
  // to the WhatsApp manual-review flow instead of calling this directly.
  async function withdrawToCoins(id, data, ppAmount) {
    data = data || {};
    const current = data.primePoints || 0;
    if (!ppAmount || ppAmount <= 0 || ppAmount > current) {
      return { success: false, reason: 'insufficient_pp' };
    }
    const newPoints   = current - ppAmount;
    const coinsGained = ppAmount * PP_TO_COIN_RATE;
    const newCoins    = (data.primos || data.coins || 0) + coinsGained;
    const history     = pushHistory(data, -ppAmount, 'Withdraw to Coins', 'system');

    await API.updateUserData(id, data, {
      primePoints: newPoints,
      rank: calcRank(newPoints),
      ppHistory: history,
      primos: newCoins,
      coins: newCoins,
    });

    return { success: true, primePoints: newPoints, rank: calcRank(newPoints), coinsGained, newCoins };
  }

  return {
    CLAIM_AMOUNT, CLAIM_COOLDOWN_MS, PP_TO_COIN_RATE, INSTANT_LIMIT,
    calcRank, adjustPP, getClaimStatus, claimDailyPP, withdrawToCoins,
  };
})();
