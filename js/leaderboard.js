// ── Leaderboard ──────────────────────────────────────────────────────
// Net Worth and Cards boards use one shared fetch (API.getAllUsers).
// Prime Points board is fetched separately from API.getPPLeaderboard
// (sorted server-side by primePoints, the real DB column) and
// auto-refreshes every 20s since PP changes live as people play.

let allUsers = [];

// Tracks whether the PP leaderboard has completed its first successful load.
let ppLeaderboardLoadedOnce = false;
let ppLeaderboardRefreshInFlight = false;

document.addEventListener('DOMContentLoaded', async () => {
  renderSidebar('leaderboard');
  await loadNetAndCardsBoards();
  loadPPLeaderboard();
  startPPLeaderboardAutoRefresh();
});

// ── Net Worth + Cards (one fetch, two views) ──────────────────────────
async function loadNetAndCardsBoards() {
  try {
    const raw = await API.getAllUsers();
    allUsers = App.parseUsers(raw) || [];
    renderNetBoard(allUsers);
    renderCardsBoard(allUsers);
  } catch (error) {
    console.error('Leaderboard Load Error:', error);
    document.getElementById('lb-body').innerHTML =
      `<tr><td colspan="5"><div class="empty"><div class="empty-icon">❌</div><div class="empty-text">Failed to load leaderboard</div></div></td></tr>`;
  }
}

function renderNetBoard(users) {
  const sorted = [...users].sort((a, b) => b.netWorth - a.netWorth);
  buildPodium('podium-net', sorted, 'netWorth', App.formatCoins);

  const medals = ['🥇', '🥈', '🥉'];
  const tbody = document.getElementById('lb-body');

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty"><div class="empty-icon">🎴</div><div class="empty-text">No players yet</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((u, i) => `
    <tr style="animation-delay:${Math.min(i * 0.04, 0.6)}s" onclick="openProfileModal('${u.phone || u.id}')">
      <td><span class="rank-num ${i < 3 ? 'rank-top' : ''}">${medals[i] || (i + 1)}</span></td>
      <td>
        <div class="user-cell">
          ${App.renderAvatar(u, 30)}
          <div class="user-cell-info">
            <div class="user-cell-name">${u.name}</div>
            <div class="user-cell-phone">${u.phone || u.id}</div>
          </div>
        </div>
      </td>
      <td class="val-gold">${App.formatCoins(u.netWorth)}</td>
      <td><span class="card-count">🎴 ${u.cards.length}</span></td>
      <td class="val-green">${u.primePoints > 0 ? '◈ ' + u.primePoints.toLocaleString() : '—'}</td>
    </tr>
  `).join('');
}

function renderCardsBoard(users) {
  const sorted = [...users].sort((a, b) => b.cards.length - a.cards.length);
  buildPodium('podium-cards', sorted, 'cards', v => `🎴 ${v.length}`);

  const medals = ['🥇', '🥈', '🥉'];
  const tbody = document.getElementById('cards-lb-body');

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty"><div class="empty-icon">🎴</div><div class="empty-text">No players yet</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((u, i) => `
    <tr style="animation-delay:${Math.min(i * 0.04, 0.6)}s" onclick="openProfileModal('${u.phone || u.id}')">
      <td><span class="rank-num ${i < 3 ? 'rank-top' : ''}">${medals[i] || (i + 1)}</span></td>
      <td>
        <div class="user-cell">
          ${App.renderAvatar(u, 30)}
          <div class="user-cell-info">
            <div class="user-cell-name">${u.name}</div>
            <div class="user-cell-phone">${u.phone || u.id}</div>
          </div>
        </div>
      </td>
      <td><span class="card-count" style="font-size:15px;">🎴 ${u.cards.length}</span></td>
      <td class="val-gold">${App.formatCoins(u.netWorth)}</td>
    </tr>
  `).join('');
}

// ── Prime Points (live from Supabase, separate fetch + auto-refresh) ──
async function loadPPLeaderboard() {
  const el = document.getElementById('pp-lb-body');
  if (!el) return;

  if (ppLeaderboardRefreshInFlight) return;
  ppLeaderboardRefreshInFlight = true;

  // Only show the loading spinner on the very first load. Auto-refresh
  // ticks update the table (and podium) quietly so it feels "live".
  if (!ppLeaderboardLoadedOnce) {
    el.innerHTML = `<tr><td colspan="4"><div class="loader"><div class="spinner"></div> Loading...</div></td></tr>`;
  }

  try {
    const raw   = await API.getPPLeaderboard(50);
    const users = App.parseUsers(raw).filter(u => u.primePoints > 0);

    const countEl = document.getElementById('pp-lb-count');
    if (countEl) countEl.textContent = users.length;

    buildPodium('podium-pp', users, 'primePoints', v => `◈ ${v.toLocaleString()}`);

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
    if (!ppLeaderboardLoadedOnce) {
      el.innerHTML = `<tr><td colspan="4"><div class="empty"><div class="empty-icon">❌</div><div class="empty-text">Failed to load</div></div></td></tr>`;
    }
  } finally {
    ppLeaderboardRefreshInFlight = false;
  }
}

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

// ── Shared podium builder (top 3, any board) ───────────────────────────
function buildPodium(containerId, sorted, valueKey, formatFn) {
  const top = sorted.slice(0, 3);
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const posClass = ['p2', 'p1', 'p3'];
  const medals   = ['🥈', '🥇', '🥉'];
  const heights  = [52, 72, 38];

  const container = document.getElementById(containerId);
  if (!container) return;
  if (!top.length) { container.innerHTML = ''; return; }

  container.innerHTML = order.map((u, i) => {
    const isFirst = u === top[0];
    return `
      <div class="podium-slot ${posClass[i]}" onclick="openProfileModal('${u.phone || u.id}')">
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-avatar-wrap">
          ${isFirst ? '<div class="podium-crown">👑</div>' : ''}
          ${App.renderAvatar(u, isFirst ? 44 : 36)}
        </div>
        <div class="podium-name">${u.name}</div>
        <div class="podium-val">${formatFn(u[valueKey])}</div>
        <div class="podium-block" style="height:${heights[i]}px">${i === 1 ? '1' : (i === 0 ? '2' : '3')}</div>
      </div>
    `;
  }).join('');
}

// ── Tabs ────────────────────────────────────────────────────────────
function switchTab(tab, el) {
  document.getElementById('section-net').style.display   = tab === 'net'   ? '' : 'none';
  document.getElementById('section-cards').style.display = tab === 'cards' ? '' : 'none';
  document.getElementById('section-pp').style.display    = tab === 'pp'    ? '' : 'none';
  document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
}
