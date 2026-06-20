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
    getAllUsers:     () => query('?select=*&order=data->>primos.desc.nullslast'),
    getUserByPhone:  (phone) => query(`?data->>phoneNumber=eq.${encodeURIComponent(phone)}&select=*`),
    getUserById:     (id) => query(`?id=eq.${encodeURIComponent(id)}&select=*`),
    getLeaderboard:  (limit = 20) => query(`?select=*&order=data->>primos.desc.nullslast&limit=${limit}`),
    searchUsers:     (term) => query(`?data->>name=ilike.*${encodeURIComponent(term)}*&select=*`),
    updateUser:      patch,
    updateUserData,
    getGuildMembers,
    getCashouts,
    createCashout,
    updateCashout,
  };
})();

// ── Prime Points (Supabase) ───────────────────────────────────────────
// Replaces MongoAPI entirely. All PP data lives in the `prime_points` table.
// Table schema (run once in Supabase SQL editor):
//
//   CREATE TABLE prime_points (
//     phone        text PRIMARY KEY,
//     name         text,
//     prime_points int  DEFAULT 100,
//     coins        int  DEFAULT 0,
//     history      jsonb DEFAULT '[]',
//     last_claim   timestamptz
//   );
//
const MongoAPI = (() => {
  const { url, key } = CONFIG.supabase;
  const PP_TABLE = 'prime_points';

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // ── Internal helpers ──────────────────────────────────────────

  async function fetchUser(phone) {
    try {
      const res = await fetch(
        `${url}/rest/v1/${PP_TABLE}?phone=eq.${encodeURIComponent(phone)}&select=*`,
        { headers }
      );
      if (!res.ok) return null;
      const rows = await res.json();
      return rows?.[0] || null;
    } catch (err) {
      console.error('[PP fetchUser Error]', err);
      return null;
    }
  }

  async function upsertUser(phone, data) {
    try {
      const res = await fetch(`${url}/rest/v1/${PP_TABLE}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ phone, ...data }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const rows = await res.json();
      return rows?.[0] || null;
    } catch (err) {
      console.error('[PP upsertUser Error]', err);
      return null;
    }
  }

  async function patchUser(phone, data) {
    try {
      const res = await fetch(
        `${url}/rest/v1/${PP_TABLE}?phone=eq.${encodeURIComponent(phone)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const rows = await res.json();
      return rows?.[0] || null;
    } catch (err) {
      console.error('[PP patchUser Error]', err);
      return null;
    }
  }

  // ── Public API ────────────────────────────────────────────────

  // Get or auto-create a user's PP profile (default 100 PP)
  async function ensureUser(phone, name = '') {
    const existing = await fetchUser(phone);
    if (existing) {
      // Update name if provided and different
      if (name && name !== existing.name) {
        return patchUser(phone, { name });
      }
      return existing;
    }
    // Create new user with defaults
    return upsertUser(phone, {
      name:         name || '',
      prime_points: 100,
      coins:        0,
      history:      [],
      last_claim:   null,
    });
  }

  // Get a user's PP profile (no auto-create)
  async function getUser(phone) {
    return fetchUser(phone);
  }

  // Grant or deduct PP. amount can be negative.
  // Auto-creates user if they don't exist yet.
  async function grantPP(phone, amount, reason, grantedBy = 'admin', name = '') {
    const user = await ensureUser(phone, name);
    if (!user) return null;

    const newPP      = (user.prime_points || 100) + amount;
    const histEntry  = {
      pts:       amount,
      label:     amount >= 0 ? 'ADMIN_GRANT' : 'ADMIN_DEDUCT',
      reason:    reason || '',
      by:        grantedBy,
      timestamp: new Date().toISOString(),
    };
    const history = Array.isArray(user.history) ? user.history : [];

    return patchUser(phone, {
      prime_points: newPP,
      history:      [...history, histEntry],
    });
  }

  // Check if today's daily claim is still available (no side effects)
  async function getClaimStatus(phone) {
    const user = await fetchUser(phone);
    if (!user) return { claimed: false, msRemaining: 0 };

    if (!user.last_claim) return { claimed: false, msRemaining: 0 };

    const last      = new Date(user.last_claim);
    const now       = new Date();
    const midnight  = new Date(now);
    midnight.setHours(0, 0, 0, 0);

    if (last >= midnight) {
      const nextMidnight = new Date(midnight);
      nextMidnight.setDate(nextMidnight.getDate() + 1);
      return { claimed: true, msRemaining: nextMidnight - now };
    }
    return { claimed: false, msRemaining: 0 };
  }

  // Claim today's free Prime Points (random 50–150).
  // Returns { claimed: false, msRemaining } if already claimed,
  // or { claimed: true, amount, prime_points } on success.
  async function claimDailyPP(phone, name = '') {
    const status = await getClaimStatus(phone);
    if (status.claimed) return { claimed: false, msRemaining: status.msRemaining };

    const user   = await ensureUser(phone, name);
    if (!user) return null;

    const amount  = Math.floor(Math.random() * 101) + 50; // 50–150
    const newPP   = (user.prime_points || 100) + amount;
    const history = Array.isArray(user.history) ? user.history : [];
    const entry   = {
      pts:       amount,
      label:     'DAILY_CLAIM',
      reason:    'Daily claim',
      timestamp: new Date().toISOString(),
    };

    const updated = await patchUser(phone, {
      prime_points: newPP,
      last_claim:   new Date().toISOString(),
      history:      [...history, entry],
      ...(name ? { name } : {}),
    });

    if (!updated) return null;
    return { claimed: true, amount, prime_points: newPP };
  }

  // Full PP history for a user
  async function getPPHistory(phone) {
    const user = await fetchUser(phone);
    return user?.history || [];
  }

  // PP leaderboard — sorted by prime_points descending
  async function getPPLeaderboard(limit = 50) {
    try {
      const res = await fetch(
        `${url}/rest/v1/${PP_TABLE}?select=*&order=prime_points.desc&limit=${limit}`,
        { headers }
      );
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.error('[PP Leaderboard Error]', err);
      return [];
    }
  }

  // Add or deduct coins directly
  async function adjustCoins(phone, amount, reason) {
    const user = await fetchUser(phone);
    if (!user) return null;

    const newCoins = (user.coins || 0) + amount;
    const history  = Array.isArray(user.history) ? user.history : [];
    const entry    = {
      pts:       amount,
      label:     'COINS_ADJUST',
      reason:    reason || '',
      timestamp: new Date().toISOString(),
    };

    return patchUser(phone, {
      coins:   newCoins,
      history: [...history, entry],
    });
  }

  return {
    ensureUser,
    getUser,
    grantPP,
    claimDailyPP,
    getClaimStatus,
    getPPHistory,
    getPPLeaderboard,
    adjustCoins,
  };
})();
