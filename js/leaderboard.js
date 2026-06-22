document.addEventListener('DOMContentLoaded', () => {
  renderSidebar('leaderboard');
  loadLeaderboard();
  loadPPLeaderboard();
  startPPLeaderboardAutoRefresh();
});

async function loadLeaderboard() {
  const tbody   = document.getElementById('lb-body');
  const countEl = document.getElementById('lb-count');

  tbody.innerHTML = `<tr><td colspan="5"><div class="loader"><div class="spinner"></div> Loading...</div></td></tr>`;

  try {
    const raw   = await API.getLeaderboard(50);
    const users = App.parseUsers(raw);

    if (!users || !users.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-icon">🎴</div><div class="empty-text">No players yet</div></div></td></tr>`;
      return;
    }

    if (countEl) countEl.textContent = users.length;

    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    users.sort((a, b) => b.netWorth - a.netWorth);

    tbody.innerHTML = users.map((user, i) => {
      const rank      = i + 1;
      const rankClass = rank <= 3 ? `top${rank}` : '';
      const medal     = medals[rank] || '';
      const phone     = user.phone || user.id || 'N/A';

      return `
        <tr onclick="openProfileModal('${phone}')" style="cursor:pointer">
          <td><span class="rank-num ${rankClass}">${medal || rank}</span></td>
          <td>
            <div class="user-cell">
              ${App.renderAvatar(user, 34)}
              <div class="user-cell-info">
                <div class="user-cell-name">${user.name}${user.role ? App.roleBadge(user.role) : ''}</div>
                <div class="user-cell-phone">${phone}${user.guild ? ` · ⚔️ ${user.guild}` : ''}</div>
              </div>
            </div>
          </td>
          <td style="font-family:var(--font-display);font-weight:600;color:var(--gold)">${App.formatCoins(user.netWorth)}</td>
          <td><span class="badge badge-purple">${user.cards.length} cards</span></td>
          <td><span class="badge badge-pp">${user.primePoints > 0 ? '◈ ' + user.primePoints.toLocaleString() : '—'}</span></td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Leaderboard Render Error:', error);
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-icon">❌</div><div class="empty-text">Failed to load leaderboard</div></div></td></tr>`;
  }
}

// Tracks whether the PP leaderboard has completed its first successful load.
// Used to decide whether to show the full-table spinner (first load) or
// refresh quietly in the background (auto-refresh ticks).
let ppLeaderboardLoadedOnce = false;

// Prevents overlapping refresh calls if a request is slow to resolve.
let ppLeaderboardRefreshInFlight = false;

async function loadPPLeaderboard() {
  const el = document.getElementById('pp-lb-body');
  if (!el) return;

  if (ppLeaderboardRefreshInFlight) return;
  ppLeaderboardRefreshInFlight = true;

  // Only show the loading spinner on the very first load. Auto-refresh
  // ticks update the table quietly so it feels "live" rather than flickering.
  if (!ppLeaderboardLoadedOnce) {
    el.innerHTML = `<tr><td colspan="4"><div class="loader"><div class="spinner"></div> Loading...</div></td></tr>`;
  }

  try {
    // PP balances, history, and rank live in Supabase now (same `data`
    // JSONB column as coins/cards/etc — see PPApi in api.js). One query
    // gets us everything, already sorted server-side by primePoints desc.
    const raw   = await API.getPPLeaderboard(50);
    const users = App.parseUsers(raw).filter(u => u.primePoints > 0);

    const countEl = document.getElementById('pp-lb-count');
    if (countEl) countEl.textContent = users.length;

    if (!users.length) {
      el.innerHTML = `<tr><td colspan="4"><div class="empty"><div class="empty-icon">◈</div><div class="empty-text">No Prime Points earned yet — win games to appear here!</div></div></td></tr>`;
      ppLeaderboardLoadedOnce = true;
      return;
    }

    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    el.innerHTML = users.map((u, i) => {
      const phone     = u.phone || u.id;
      const rankNum   = i + 1;
      const rankClass = rankNum <= 3 ? `top${rankNum}` : '';
      const medal     = medals[rankNum] || '';

      return `
        <tr onclick="openProfileModal('${phone}')" style="cursor:pointer">
          <td><span class="rank-num ${rankClass}">${medal || rankNum}</span></td>
          <td>
            <div class="user-cell">
              ${App.renderAvatar(u, 34)}
              <div class="user-cell-info">
                <div class="user-cell-name">${u.name}${u.role ? App.roleBadge(u.role) : ''}</div>
                <div class="user-cell-phone">${phone}${u.guild ? ` · ⚔️ ${u.guild}` : ''}</div>
              </div>
            </div>
          </td>
          <td style="font-family:var(--font-display);font-weight:700;color:#a78bfa">◈ ${u.primePoints.toLocaleString()}</td>
          <td><span class="badge badge-green">${u.rank || '—'}</span></td>
        </tr>
      `;
    }).join('');

    ppLeaderboardLoadedOnce = true;

  } catch (error) {
    console.error('PP Leaderboard Error:', error);
    // Only replace the table with an error state on the first load.
    // If auto-refresh fails after a successful load, leave the existing
    // (still valid) data on screen rather than clearing it.
    if (!ppLeaderboardLoadedOnce) {
      el.innerHTML = `<tr><td colspan="4"><div class="empty"><div class="empty-icon">❌</div><div class="empty-text">Failed to load</div></div></td></tr>`;
    }
  } finally {
    ppLeaderboardRefreshInFlight = false;
  }
}

// Auto-refresh the Prime Points leaderboard every 20 seconds so it stays
// "live" without requiring a page reload. Pauses while the tab is hidden
// to avoid unnecessary requests, and resumes (with an immediate refresh)
// when the tab becomes visible again.
const PP_LEADERBOARD_REFRESH_MS = 20000;
let ppLeaderboardIntervalId = null;

function startPPLeaderboardAutoRefresh() {
  if (ppLeaderboardIntervalId) return;

  ppLeaderboardIntervalId = setInterval(() => {
    if (document.hidden) return;
    loadPPLeaderboard();
  }, PP_LEADERBOARD_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loadPPLeaderboard();
  });
}
