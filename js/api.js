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

  async function updateUserData(id, currentData, updates) {
    const merged = { ...currentData, ...updates };
    return patch(id, { data: merged });
  }

  // ── Cashout Requests ──────────────────────────────────────────
  // ... (your existing cashout functions remain unchanged)

  // ── Guilds ────────────────────────────────────────────────────
  // ... (your existing guild functions)

  // ── Web Activities ────────────────────────────────────────────
  async function logActivity(userId, activityType, metadata = {}) {
    try {
      const payload = {
        user_id: userId,
        activity_type: activityType,
        metadata: metadata,
        created_at: new Date().toISOString(),
      };

      const res = await fetch(`${url}/rest/v1/user_activities`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        console.error('[Activity Log Error]', await res.text());
        return false;
      }
      return true;
    } catch (err) {
      console.error('[Activity Log Error]', err);
      return false;
    }
  }

  async function getUserActivities(userId, limit = 50) {
    try {
      const res = await fetch(
        `${url}/rest/v1/user_activities?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`,
        { headers }
      );
      if (!res.ok) return [];
      return await res.json();
    } catch (err) {
      console.error('[Get Activities Error]', err);
      return [];
    }
  }

  return {
    getAllUsers: () => query('?select=*&order=data->>primos.desc.nullslast'),
    getUserByPhone: (phone) => query(`?data->>phoneNumber=eq.${encodeURIComponent(phone)}&select=*`),
    getUserById: (id) => query(`?id=eq.${encodeURIComponent(id)}&select=*`),
    getLeaderboard: (limit = 20) => query(`?select=*&order=data->>primos.desc.nullslast&limit=${limit}`),
    getPPLeaderboard: (limit = 20) => query(`?select=*&order=data->>primePoints.desc.nullslast&limit=${limit}`),
    searchUsers: (term) => query(`?data->>name=ilike.*${encodeURIComponent(term)}*&select=*`),
    updateUser: patch,
    updateUserData,
    getGuildMembers,
    getCashouts,
    createCashout,
    updateCashout,
    
    // New activity methods
    logActivity,
    getUserActivities,
  };
})();
