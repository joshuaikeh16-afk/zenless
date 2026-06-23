const API = (() => {
  const { url, key, table } = CONFIG.supabase;

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation', // returns the updated/inserted row
  };

  // Generic query (GET)
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

  // Generic POST (Insert)
  async function post(body) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[API Error]', err);
      return null;
    }
  }

  // Generic PATCH (Update)
  async function patch(id, updates) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.error('[API Error]', err);
      return null;
    }
  }

  // Generic DELETE
  async function remove(id) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?id=eq.${id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch (err) {
      console.error('[API Error]', err);
      return false;
    }
  }

  return {
    // === Existing queries ===
    getAllUsers: () => query('?select=*&order=data->>primos.desc.nullslast'),
    getUserByPhone: (phone) =>
      query(`?data->>phoneNumber=eq.${encodeURIComponent(phone)}&select=*`),
    getLeaderboard: (limit = 50) =>
      query(`?select=*&order=data->>primos.desc.nullslast&limit=${limit}`),
    searchUsers: (term) =>
      query(`?data->>name=ilike.*${encodeURIComponent(term)}*&select=*`),

    // === NEW: Mutations ===
    createUser: (userData) => post(userData),
    
    updateUser: (id, updates) => patch(id, updates),
    
    deleteUser: (id) => remove(id),

    // Bonus: Update by phone number (very useful for your structure)
    updateUserByPhone: async (phone, updates) => {
      try {
        const res = await fetch(`${url}/rest/v1/${table}?data->>phoneNumber=eq.${encodeURIComponent(phone)}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.error('[API Error]', err);
        return null;
      }
    },
  };
})();
