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
    searchUsers:      (term) => query(`?data->>name=ilike.*${encodeURIComponent(term)}*&select=*`),
    updateUser:       patch,
    updateUserData,
    getGuildMembers,
    getCashouts,
    createCashout,
    updateCashout,
  };
})();

// ── Prime Points (MongoDB) ───────────────────────────────────────────
// Separate backend from Supabase — handles PP storage, history, and ranks.
// Swap MONGO_BASE to your deployed URL once the API is hosted.
const MongoAPI = (() => {
  const MONGO_BASE = 'https://zenlesbe.onrender.com';
  const MONGO_KEY  = CONFIG.mongo?.apiKey || 'anigamble_secret_123';
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': MONGO_KEY,
  };

  async function request(path, opts = {}) {
    try {
      const res = await fetch(`${MONGO_BASE}${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      console.error('[MongoAPI Error]', err);
      return null;
    }
  }

  // Fetch a user's PP profile, auto-creating one if it doesn't exist yet
  function ensureUser(phone, name = '') {
    return request(`/users/${encodeURIComponent(phone)}/ensure?name=${encodeURIComponent(name)}`);
  }

  // Fetch a user's PP profile (no auto-create)
  function getUser(phone) {
    return request(`/users/${encodeURIComponent(phone)}`);
  }

  // Grant or deduct PP. amount can be negative.
  // Ensures the user exists in Mongo first, so new players don't fail silently.
  async function grantPP(phone, amount, reason, grantedBy = 'admin', name = '') {
    await ensureUser(phone, name);
    return request(`/users/${encodeURIComponent(phone)}/pp`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason, granted_by: grantedBy }),
    });
  }

  // Check if today's claim is still available, without granting anything
  function getClaimStatus(phone) {
    return request(`/users/${encodeURIComponent(phone)}/claim/status`);
  }

  // Claim today's free Prime Points. Server enforces the cooldown —
  // returns { claimed: false, msRemaining } if already claimed today,
  // or { claimed: true, amount, prime_points } on success.
  function claimDailyPP(phone, name = '') {
    return request(`/users/${encodeURIComponent(phone)}/claim`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  // Full PP history for a user
  function getPPHistory(phone) {
    return request(`/users/${encodeURIComponent(phone)}/pp/history`);
  }

  // PP leaderboard — Mongo already sorts by prime_points desc
  function getPPLeaderboard(limit = 50) {
    return request(`/users?limit=${limit}`);
  }

  // Spend or add coins directly (not tied to PP)
  function adjustCoins(phone, amount, reason) {
    return request(`/users/${encodeURIComponent(phone)}/coins`, {
      method: 'POST',
      body: JSON.stringify({ amount, reason }),
    });
  }

  return { ensureUser, getUser, grantPP, claimDailyPP, getClaimStatus, getPPHistory, getPPLeaderboard, adjustCoins };
})();
