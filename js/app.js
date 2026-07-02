const App = (() => {
 function parseUser(raw) {
  if (!raw) return null;
  const d = typeof raw.data === 'string' ? JSON.parse(raw.data) : (raw.data || {});
  return {
    id:          raw.id,
    name:        d.name || d.username || 'Unknown',
    phone:       d.phoneNumber || '',
    coins:       Number(d.primos || d.coins || d.balance || 0),
    bank:        Number(d.bank || 0),
    netWorth:    Number(d.primos || d.coins || d.balance || 0) + Number(d.bank || 0),
    primePoints: Number(d.primePoints || 0),
    ppHistory:   Array.isArray(d.ppHistory) ? d.ppHistory : [],
    cards:       Array.isArray(d.cards) ? d.cards : [],
    souvenirs:   Array.isArray(d.souvenirs) ? d.souvenirs : [],
    guild:       d.guild || null,
    role:        d.role || null,
    rank:        d.rank || null,
    avatar:      d.avatar || null,
    bio:         d.bio || null,
    joinedAt:    d.registeredAt || d.joinedAt || raw.created_at || null,
    updatedAt:   raw.updated_at || null,
    // New: gems, bounty, and misc assets
    gemsBag:     d.gemsBag || { diamond: null, ruby: null, sapphire: null, emerald: null, opal: null },
    bounty:      Number(d.bounty || 0),
    assets:      d.assets || { gold: 0, stark: 0, land: 0, tech: 0, fuel: 0 },
    // Store raw data for update operations
    _raw:        d,
    _rowId:      raw.id,
  };
}
 
  function parseUsers(rows) {
    if (!rows) return [];
    return rows.map(parseUser).filter(Boolean);
  }
 
  function formatCoins(n) {
    n = Number(n) || 0;
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)         return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }
 
  function initials(name) {
    return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }
 
  function avatarColor(name) {
    const colors = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517'];
    let hash = 0;
    for (let c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
    return colors[Math.abs(hash) % colors.length];
  }
 
  function timeAgo(ts) {
    if (!ts) return '—';
    const date = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (isNaN(date)) return '—';
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return date.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  }
 
  const DEFAULT_AVATAR = 'https://padybdvevwazfilxopqy.supabase.co/storage/v1/object/public/media/alya_1781906906746_35.jpg';

  function renderAvatar(user, size = 40) {
    const bg       = avatarColor(user.name);
    const ini      = initials(user.name);
    const fontSize = Math.round(size * 0.35);
    const fallback = `const d=document.createElement('div');d.className='avatar';d.style.cssText='width:${size}px;height:${size}px;background:${bg};font-size:${fontSize}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;';d.textContent='${ini}';this.replaceWith(d);`;
    return `<img src="${DEFAULT_AVATAR}" width="${size}" height="${size}" alt="${user.name}" style="border-radius:50%;object-fit:cover;display:block;flex-shrink:0;" onerror="${fallback}">`;
  }
 
  function setLoading(el, state) {
    if (!el) return;
    el.classList.toggle('loading', state);
  }
 
  function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
  }
 
  function setActive(selector) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const el = document.querySelector(selector);
    if (el) el.classList.add('active');
  }
 
  // Role badge renderer
  function roleBadge(role) {
    if (!role) return '';
    const map = {
      admin: { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: '👑 Admin' },
      mod:   { color: '#60a5fa', bg: 'rgba(96,165,250,0.15)', label: '🛡 Mod' },
      vip:   { color: '#a78bfa', bg: 'rgba(167,139,250,0.15)', label: '⭐ VIP' },
    };
    const r = map[role.toLowerCase()] || { color: 'var(--text-2)', bg: 'var(--bg-3)', label: role };
    return `<span class="role-badge" style="background:${r.bg};color:${r.color};">${r.label}</span>`;
  }
 
  // PP history summary
  function ppStats(history) {
    if (!history || !history.length) return { wins: 0, losses: 0, games: 0, totalEarned: 0, totalSpent: 0 };
    const gameEntries = history.filter(h => !['ADMIN_GRANT','ADMIN_DEDUCT','CASHOUT'].includes(h.label));
    const wins    = gameEntries.filter(h => h.pts > 0).length;
    const losses  = gameEntries.filter(h => h.pts < 0).length;
    const earned  = history.filter(h => h.pts > 0).reduce((a, h) => a + h.pts, 0);
    const spent   = Math.abs(history.filter(h => h.pts < 0).reduce((a, h) => a + h.pts, 0));
    return { wins, losses, games: gameEntries.length, totalEarned: earned, totalSpent: spent };
  }
 
  return {
    parseUser,
    parseUsers,
    formatCoins,
    initials,
    avatarColor,
    renderAvatar,
    setLoading,
    showToast,
    setActive,
    timeAgo,
    roleBadge,
    ppStats,
  };
})();
 
// ── Sidebar (shared across all pages) ────────────────────────────────────
function _initSidebarToggle() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const hamburger = document.getElementById('topbar-hamburger');
  if (!sidebar) return;

  function openSidebar() {
    sidebar.classList.add('open');
    if (overlay) { overlay.style.display = 'block'; setTimeout(() => overlay.classList.add('open'), 10); }
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    if (overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.style.display = 'none', 260); }
    document.body.style.overflow = '';
  }

  if (hamburger) hamburger.addEventListener('click', openSidebar);
  if (overlay)   overlay.addEventListener('click', closeSidebar);
}

function _injectTopbarAndOverlay(activePage) {
  // Only inject if not already present
  if (document.getElementById('topbar')) return;

  // Topbar
  const topbar = document.createElement('div');
  topbar.className = 'topbar';
  topbar.id = 'topbar';
  topbar.innerHTML = `
    <div class="topbar-brand">🎴 ${CONFIG.app.name}</div>
    <button class="topbar-hamburger" id="topbar-hamburger" aria-label="Open menu">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
  `;
  document.body.prepend(topbar);

  // Overlay
  if (!document.getElementById('sidebar-overlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebar-overlay';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);
  }
}

function renderSidebar(activePage) {
  const navIcon = {
    index:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
    leaderboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    profile:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`,
    guilds:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    games:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M8 12h2m-1-1v2"/><circle cx="15" cy="11" r="0.8" fill="currentColor"/><circle cx="17" cy="13" r="0.8" fill="currentColor"/></svg>`,
    forex:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 17 9 11 13 15 21 6"/><polyline points="15 6 21 6 21 12"/></svg>`,
    staff:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    admin:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 1 0 4.93 19.07 10 10 0 0 0 19.07 4.93Z"/></svg>`,
    settings:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 1 0 4.93 19.07 10 10 0 1 0 19.07 4.93Z"/></svg>`,
  };
 
  const pages = [
 { id: 'index',       label: 'Overview',    href: 'index.html' },
    { id: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html' },
    { id: 'profile',     label: 'Profile', href: 'profile.html' },
    { id: 'guilds',      label: 'Guilds',      href: 'guilds.html' },
   { id: 'games',       label: 'Games',       href: 'games.html' },
   { id: 'forex',       label: 'Markets',     href: 'forex.html' },
    { id: 'staff',       label: 'Shop',       href: 'shop.html' },
     //{ id: 'admin',       label: 'Deck',       href: 'deck.html' },
  ];
 
  const el = document.getElementById('sidebar');
  if (!el) return;
 
  const isLoggedIn = typeof Auth !== 'undefined' && Auth.isLoggedIn();
  const adminLink = isLoggedIn ? `
    <div class="nav-label" style="margin-top:0.75rem;">Admin</div>
    <a href="admin.html" class="nav-link ${activePage === 'admin' ? 'active' : ''}" style="${activePage !== 'admin' ? 'color:var(--danger);opacity:0.85' : ''}">
      ${navIcon.admin} Admin Panel
    </a>
  ` : '';
 
  const footerRight = isLoggedIn
    ? `<button onclick="Auth.logout()" style="background:none;border:none;color:var(--text-3);font-size:11px;cursor:pointer;padding:0;" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-3)'">Sign out</button>`
    : '';
 
  _injectTopbarAndOverlay(activePage);

  el.innerHTML = `
    <div class="sidebar-brand">
      <div class="brand-icon">🎴</div>
      <div>
        <div class="brand-name">${CONFIG.app.name}</div>
        <div class="brand-tag">${CONFIG.app.tagline}</div>
      </div>
    </div>
    <nav class="nav-section">
      <div class="nav-label">Menu</div>
      ${pages.map(p => `
        <a href="${p.href}" class="nav-link ${activePage === p.id ? 'active' : ''}">
          ${navIcon[p.id]} ${p.label}
        </a>
      `).join('')}
      ${adminLink}
    </nav>
    <div class="sidebar-footer">
      <span>v${CONFIG.app.version}</span>
      ${footerRight}
    </div>
  `;

  _initSidebarToggle();
}
 
// ── Global profile modal (used on index/leaderboard) ─────────────────────
async function openProfileModal(phoneOrId) {
  const overlay = document.getElementById('modal');
  const content = document.getElementById('modal-content');
  if (!overlay || !content) return;
 
  overlay.style.display = 'flex';
  content.innerHTML = `<div class="loader"><div class="spinner"></div> Loading profile...</div>`;
 
  let raw;
  if (phoneOrId && /^\d+$/.test(phoneOrId.replace(/\s+/g, ''))) {
    raw = await API.getUserByPhone(phoneOrId);
  } else {
    raw = await API.getUserById(phoneOrId);
  }
 
  const user = App.parseUser(raw?.[0]);
  if (!user) {
    content.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-text">Profile not found</div></div>`;
    return;
  }
 
  content.innerHTML = buildProfileHTML(user);
 
  overlay.onclick = e => { if (e.target === overlay) closeModal(); };
}
 
function closeModal() {
  const overlay = document.getElementById('modal');
  if (overlay) overlay.style.display = 'none';
}
 
function buildProfileHTML(u) {
  const stats = App.ppStats(u.ppHistory);
  const winRate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;
 
  const cardItems = u.cards.length
    ? u.cards.map(c => {
        const card = typeof c === 'object' ? c : { name: c };
        const tierColor = { C: '#9ca3af', R: '#3b82f6', SR: '#a855f7', SSR: '#f59e0b', UR: '#ef4444' }[card.tier] || '#9ca3af';
        const safeJson = JSON.stringify(JSON.stringify(card));
        return `
          <div class="inv-item" onclick="openCardModal(${safeJson})" style="cursor:pointer;gap:8px;padding:6px 8px;align-items:center;">
            ${card.preRenderedUrl
              ? `<img src="${card.preRenderedUrl}" style="width:28px;height:38px;object-fit:cover;border-radius:4px;flex-shrink:0;">`
              : `<span style="font-size:16px;">🃏</span>`
            }
            <div style="min-width:0;flex:1;">
              <div style="font-size:12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${card.name || 'Unknown'}</div>
              <div style="font-size:10px;color:${tierColor};font-weight:600;">${card.badge || card.tier || ''}</div>
            </div>
            <span style="font-size:10px;color:var(--text-3);">›</span>
          </div>`;
      }).join('')
    : `<div class="inv-empty">No cards</div>`;
 
  const souvItems = u.souvenirs.length
    ? u.souvenirs.map(s => `<div class="inv-item"><span>🎁</span><span>${s.name || s}</span></div>`).join('')
    : `<div class="inv-empty">No souvenirs</div>`;
 
  const recentPP = u.ppHistory.slice(-5).reverse().map(h => `
    <div class="pp-entry ${h.pts > 0 ? 'pp-gain' : 'pp-loss'}">
      <span>${h.label || 'Game'}</span>
      <span>${h.pts > 0 ? '+' : ''}${h.pts} ◈</span>
    </div>
  `).join('') || '<div class="inv-empty">No activity yet</div>';
 
  return `
    <div class="modal-close" onclick="closeModal()">✕</div>
 
    <div class="modal-hero">
      ${App.renderAvatar(u, 64)}
      <div class="modal-hero-info">
        <div class="modal-hero-name">${u.name}</div>
        <div class="modal-hero-meta">
          ${u.phone || u.id}
          ${u.role ? App.roleBadge(u.role) : ''}
        </div>
        ${u.guild ? `<div class="modal-guild">⚔️ ${u.guild}</div>` : ''}
        ${u.bio ? `<div class="modal-bio">${u.bio}</div>` : ''}
      </div>
    </div>
 
    <div class="modal-stats-row">
      <div class="mstat">
        <div class="mstat-val gold">${App.formatCoins(u.netWorth)}</div>
        <div class="mstat-label">Net Worth</div>
      </div>
      <div class="mstat">
        <div class="mstat-val purple">◈ ${u.primePoints.toLocaleString()}</div>
        <div class="mstat-label">Prime Points</div>
      </div>
      <div class="mstat">
        <div class="mstat-val">${u.cards.length}</div>
        <div class="mstat-label">Cards</div>
      </div>
      <div class="mstat">
        <div class="mstat-val green">${winRate}%</div>
        <div class="mstat-label">Win Rate</div>
      </div>
    </div>
 
    <div class="modal-two-col">
      <div>
        <div class="modal-section-title">💰 Balance</div>
        <div class="balance-row"><span>Wallet</span><strong>${App.formatCoins(u.coins)}</strong></div>
        <div class="balance-row"><span>Bank</span><strong>${App.formatCoins(u.bank)}</strong></div>
        <div class="balance-row total"><span>Net Worth</span><strong class="gold">${App.formatCoins(u.netWorth)}</strong></div>
 
        <div class="modal-section-title" style="margin-top:1rem;">◈ Prime Points</div>
        <div class="balance-row"><span>Balance</span><strong class="purple">◈ ${u.primePoints.toLocaleString()}</strong></div>
        <div class="balance-row"><span>Total Earned</span><strong>◈ ${stats.totalEarned.toLocaleString()}</strong></div>
        <div class="balance-row"><span>Games Played</span><strong>${stats.games}</strong></div>
        <div class="balance-row"><span>Record</span><strong>${stats.wins}W / ${stats.losses}L</strong></div>
      </div>
      <div>
        <div class="modal-section-title">📋 Recent PP Activity</div>
        <div class="pp-history">${recentPP}</div>
      </div>
    </div>
 
    <div class="modal-inv-row">
      <div>
        <div class="modal-section-title">🃏 Cards (${u.cards.length})</div>
        <div class="inv-grid">${cardItems}</div>
      </div>
      <div>
        <div class="modal-section-title">🎁 Souvenirs (${u.souvenirs.length})</div>
        <div class="inv-grid">${souvItems}</div>
      </div>
    </div>
 
    ${u.joinedAt ? `<div class="modal-footer-meta">Joined ${App.timeAgo(u.joinedAt)}</div>` : ''}
  `;
}
 
// Legacy alias
const openProfile = openProfileModal;
// ── Card Detail Modal ─────────────────────────────────────────────────────
async function openCardModal(cardJson) {
  const card = typeof cardJson === 'string' ? JSON.parse(cardJson) : cardJson;

  // Create or reuse overlay
  let overlay = document.getElementById('card-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'card-modal-overlay';
    overlay.style.cssText = `
      display:none;position:fixed;inset:0;z-index:3000;
      background:#000;overflow-y:auto;
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeCardModal(); });
  }

  overlay.style.display = 'block';
  overlay.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;">
      <div style="color:#fff;font-size:14px;opacity:0.6;">Loading card…</div>
    </div>`;

  // Fetch card from _shop
  let shopCard = null;
  try {
    const { url, key } = CONFIG.supabase;
    const res = await fetch(`${url}/rest/v1/_shop?id=eq.${encodeURIComponent(card.id)}&select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const rows = await res.json();
    shopCard = rows?.[0] || null;
  } catch (e) { shopCard = null; }

  // Fetch owners
  let owners = [];
  try {
    const { url, key } = CONFIG.supabase;
    const res = await fetch(`${url}/rest/v1/economy_full?select=data`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const rows = await res.json();
    owners = rows.map(r => {
      const d = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
      const cards = Array.isArray(d.cards) ? d.cards : [];
      return cards.some(c => (c.id || c) === card.id) ? (d.name || d.username || 'Unknown') : null;
    }).filter(Boolean);
  } catch (e) { owners = []; }

  const TIER_MAP = {
    C:   { color: '#9ca3af', label: 'Common',      dot: '⚪' },
    R:   { color: '#3b82f6', label: 'Rare',         dot: '🔵' },
    SR:  { color: '#a855f7', label: 'Super Rare',   dot: '🟣' },
    SSR: { color: '#f59e0b', label: 'Super SR',     dot: '🟡' },
    UR:  { color: '#ef4444', label: 'Ultra Rare',   dot: '🔴' },
  };
  const tierInfo  = TIER_MAP[card.tier] || { color: '#9ca3af', label: card.tier || 'Unknown', dot: '⚪' };
  const imgUrl    = card.preRenderedUrl || shopCard?.image_url || shopCard?.preRenderedUrl || null;
  const lore      = shopCard?.desc || shopCard?.description || shopCard?.lore || '';
  const series    = card.seriesName || shopCard?.series || shopCard?.seriesName || '';
  const worth     = card.worth != null ? Number(card.worth).toLocaleString() : (shopCard?.price != null ? Number(shopCard.price).toLocaleString() : '—');
  const shortId   = card.id ? '#' + card.id.split('-')[0] : '';
  const acquired  = card.acquiredAt ? App.timeAgo(card.acquiredAt) : null;

  overlay.innerHTML = `
    <div style="min-height:100vh;background:#000;display:flex;flex-direction:column;max-width:520px;margin:0 auto;">

      <!-- Full-bleed card image -->
      <div style="position:relative;width:100%;background:#050510;">
        <!-- Close button -->
        <button onclick="closeCardModal()" style="
          position:absolute;top:14px;left:14px;z-index:10;
          width:36px;height:36px;border-radius:50%;
          background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.15);
          color:#fff;font-size:16px;cursor:pointer;
          display:flex;align-items:center;justify-content:center;
          backdrop-filter:blur(8px);transition:background 0.2s;
        " onmouseover="this.style.background='rgba(255,255,255,0.15)'" onmouseout="this.style.background='rgba(0,0,0,0.6)'">
          ‹
        </button>

        ${imgUrl
          ? `<img src="${imgUrl}" alt="${card.name || 'Card'}"
               style="width:100%;display:block;max-height:75vh;object-fit:cover;"
               onerror="this.parentElement.style.minHeight='320px';this.style.display='none';">`
          : `<div style="height:360px;display:flex;align-items:center;justify-content:center;font-size:96px;background:radial-gradient(ellipse at 50% 40%,${tierInfo.color}33,transparent 70%);">🃏</div>`
        }

        <!-- Tier badge overlay on image -->
        <div style="
          position:absolute;top:14px;right:14px;
          background:rgba(0,0,0,0.65);border:1px solid ${tierInfo.color};
          color:${tierInfo.color};font-size:11px;font-weight:700;
          padding:4px 12px;border-radius:20px;letter-spacing:0.06em;
          backdrop-filter:blur(8px);
        ">${card.badge || tierInfo.dot + ' ' + tierInfo.label}</div>
      </div>

      <!-- Info panel -->
      <div style="
        flex:1;background:#111118;padding:1.5rem 1.25rem 2rem;
        border-top:2px solid ${tierInfo.color};
      ">

        <!-- Header -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:0.25rem;">
          <div style="
            width:4px;height:24px;border-radius:2px;
            background:${tierInfo.color};flex-shrink:0;
          "></div>
          <div style="font-size:14px;font-weight:700;color:#ccc;letter-spacing:0.06em;text-transform:uppercase;">
            📋 Card Info
          </div>
        </div>
        <div style="height:1px;background:rgba(255,255,255,0.08);margin:0.75rem 0 1rem;"></div>

        <!-- Info rows -->
        <div style="display:flex;flex-direction:column;gap:0.65rem;margin-bottom:1.25rem;">
          <div style="display:flex;align-items:center;gap:10px;font-size:14px;">
            <div style="width:3px;height:18px;border-radius:2px;background:${tierInfo.color};flex-shrink:0;"></div>
            <span style="font-size:16px;">🎴</span>
            <span style="font-weight:700;color:#fff;font-size:15px;">${card.name || 'Unknown'}</span>
          </div>
          ${series ? `
          <div style="display:flex;align-items:center;gap:10px;font-size:14px;">
            <div style="width:3px;height:18px;border-radius:2px;background:${tierInfo.color};flex-shrink:0;"></div>
            <span style="font-size:16px;">📚</span>
            <span style="color:#ccc;font-style:italic;">${series}</span>
          </div>` : ''}
          <div style="display:flex;align-items:center;gap:10px;font-size:14px;">
            <div style="width:3px;height:18px;border-radius:2px;background:${tierInfo.color};flex-shrink:0;"></div>
            <span style="font-size:16px;">🏷️</span>
            <span style="color:#ccc;">Tier: <strong style="color:${tierInfo.color};">${card.tier || '?'}</strong> — ${tierInfo.dot} ${tierInfo.label}</span>
          </div>
          <div style="display:flex;align-items:center;gap:10px;font-size:14px;">
            <div style="width:3px;height:18px;border-radius:2px;background:${tierInfo.color};flex-shrink:0;"></div>
            <span style="font-size:16px;">💎</span>
            <span style="color:#ccc;">Value: <strong style="color:#f59e0b;">${worth} Primos</strong></span>
          </div>
          ${shortId ? `
          <div style="display:flex;align-items:center;gap:10px;font-size:14px;">
            <div style="width:3px;height:18px;border-radius:2px;background:${tierInfo.color};flex-shrink:0;"></div>
            <span style="font-size:16px;">🪪</span>
            <span style="
              background:#1a1a2a;border:1px solid rgba(255,255,255,0.1);
              color:#aaa;padding:2px 10px;border-radius:6px;font-size:13px;
              font-family:monospace;
            ">${shortId}</span>
          </div>` : ''}
          ${acquired ? `
          <div style="display:flex;align-items:center;gap:10px;font-size:14px;">
            <div style="width:3px;height:18px;border-radius:2px;background:${tierInfo.color};flex-shrink:0;"></div>
            <span style="font-size:16px;">📅</span>
            <span style="color:#888;">Acquired ${acquired}</span>
          </div>` : ''}
        </div>

        <div style="height:1px;background:rgba(255,255,255,0.08);margin-bottom:1.25rem;"></div>

        ${lore ? `
          <div style="
            background:#0d0d18;border-left:3px solid ${tierInfo.color};
            padding:0.75rem 1rem;border-radius:0 8px 8px 0;
            font-size:13px;color:#aaa;line-height:1.6;font-style:italic;
            margin-bottom:1.25rem;
          ">${lore}</div>
        ` : ''}

        <!-- Owners -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:0.75rem;">
          <span style="font-size:18px;">👤</span>
          <span style="font-size:15px;font-weight:700;color:#fff;">Owners (${owners.length}):</span>
        </div>
        ${owners.length > 0
          ? owners.map((name, i) => `
            <div style="
              display:flex;align-items:center;gap:10px;
              padding:0.4rem 0;
              font-size:14px;color:#ccc;
              border-bottom:1px solid rgba(255,255,255,0.05);
            ">
              <span style="color:#888;min-width:20px;">${i + 1}.</span>
              <span>${name}</span>
            </div>`).join('')
          : `<div style="font-size:13px;color:#555;padding:0.5rem 0;">No owners yet</div>`
        }

        <!-- Scroll hint -->
        <div style="text-align:center;margin-top:2rem;color:#333;font-size:12px;">
          <div style="font-size:20px;">⌄</div>
        </div>
      </div>
    </div>
  `;

  // Scroll to top
  overlay.scrollTop = 0;
}

function closeCardModal() {
  const overlay = document.getElementById('card-modal-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
                                            }
