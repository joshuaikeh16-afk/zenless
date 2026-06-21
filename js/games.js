// ════════════════════════════════════════════════════════════════
//  games.js — AniGamble HQ · Prime Points Engine
//  Prime Points live in Supabase now (the same `data` JSONB column as
//  coins/cards/etc) via PPApi in api.js. No MongoDB involved anymore.
//  Withdrawals under 5,000 PP convert to Coins instantly; 5,000+ still
//  routes through a WhatsApp DM to the admin for manual review.
// ════════════════════════════════════════════════════════════════
 
'use strict';
 
// ────────────────────────────────────────────────────────────
// PLAYER STATE
// ────────────────────────────────────────────────────────────
let currentPlayer = null;
let gameActive    = false;

// Chains every PP-affecting write (bets, payouts, withdrawals) so they hit
// Supabase in order, each building on the previous write's confirmed state
// instead of a possibly-stale local snapshot. Local UI updates instantly
// either way — this only governs the order of the background sync.
let ppSyncChain = Promise.resolve();

function queuePPSync(fn) {
  const result = ppSyncChain.then(fn);
  ppSyncChain  = result.catch(() => {});
  return result;
}
 
async function loadPlayer() {
  const phone = document.getElementById('hud-phone').value.trim().replace(/\s+/g, '');
  if (!phone) { App.showToast('Enter your phone number first', 'info'); return; }
 
  const btn = document.getElementById('hud-load-btn');
  btn.textContent = 'Loading…';
  btn.disabled    = true;
 
  const raw  = await API.getUserByPhone(phone);
  const user = App.parseUser(raw?.[0]);
  if (!user) {
    btn.textContent = 'Load Player';
    btn.disabled    = false;
    App.showToast('Player not found. Check your number.', 'info');
    return;
  }

  currentPlayer = user;
  // Persist session so other pages (shop, profile) don't ask again
  sessionStorage.setItem('agi_member_phone', user.phone);
  sessionStorage.setItem('agi_member_name',  user.name);

  btn.textContent = 'Load Player';
  btn.disabled    = false;

  refreshHUD();
  // Hide load controls after successful login
  const loadSection = document.getElementById('hud-load-section');
  if (loadSection) loadSection.style.display = 'none';
  App.showToast(`Welcome, ${user.name}! 🎮`, 'info');
}
 
function refreshHUD() {
  if (!currentPlayer) return;
  const points  = currentPlayer.primePoints || 0;
  const history = currentPlayer.ppHistory || [];
  const wins    = history.filter(h => h.amount > 0).length;
  const games   = history.length;
  document.getElementById('hud-avatar').innerHTML    = App.renderAvatar(currentPlayer, 42);
  document.getElementById('hud-name').textContent    = currentPlayer.name;
  document.getElementById('hud-name').className      = 'hud-name';
  document.getElementById('hud-coins').textContent   = App.formatCoins(currentPlayer.coins);
  document.getElementById('hud-pp').textContent      = points.toLocaleString();
  document.getElementById('hud-pp-wins').textContent = `${wins}W / ${games}G`;
  // Show warning if PP is 0
  const ppEl = document.getElementById('hud-pp');
  if (ppEl) {
    ppEl.style.color = points === 0 ? 'var(--danger)' : '#a78bfa';
    ppEl.title = points === 0 ? 'No Prime Points — DM admin to buy some!' : `${points} Prime Points available to gamble`;
  }
  renderPPLeaderboard();
}
 
async function syncCoins(delta) {
  if (!currentPlayer) return;
  const newCoins = Math.max(0, currentPlayer.coins + delta);
  const updatedData = { ...currentPlayer._raw, primos: newCoins, coins: newCoins };
  await API.updateUser(currentPlayer.id, { data: updatedData });
  currentPlayer._raw     = updatedData;
  currentPlayer.coins    = newCoins;
  currentPlayer.netWorth = newCoins + (currentPlayer.bank || 0);
  refreshHUD();
}

// Apply a PP delta: update currentPlayer instantly for snappy gameplay, then
// queue the Supabase sync in the background (see queuePPSync / ppSyncChain above).
function applyPPDelta(delta, reason, grantedBy) {
  if (!currentPlayer) return;

  currentPlayer.primePoints = Math.max(0, (currentPlayer.primePoints || 0) + delta);
  currentPlayer.ppHistory   = currentPlayer.ppHistory || [];
  currentPlayer.ppHistory.unshift({ amount: delta, reason, granted_by: grantedBy, timestamp: new Date().toISOString() });
  if (currentPlayer.ppHistory.length > 30) currentPlayer.ppHistory.length = 30;
  currentPlayer.rank = PPApi.calcRank(currentPlayer.primePoints);
  refreshHUD();

  queuePPSync(async () => {
    if (!currentPlayer) return;
    const res = await PPApi.adjustPP(currentPlayer.id, currentPlayer._raw, delta, reason, grantedBy);
    if (res && currentPlayer) {
      currentPlayer.primePoints = res.primePoints;
      currentPlayer.rank        = res.rank;
      currentPlayer.ppHistory   = res.ppHistory;
      currentPlayer._raw        = { ...currentPlayer._raw, primePoints: res.primePoints, rank: res.rank, ppHistory: res.ppHistory };
    }
  });
}

// Deduct / credit Prime Points for gambling (instant local update + background Supabase sync)
function syncPP(delta, gameLabel) {
  applyPPDelta(delta, gameLabel || 'bet', 'game');
}
 
// Award Prime Points (instant local update + background Supabase sync)
function awardPP(points, gameLabel) {
  applyPPDelta(points, gameLabel, 'game');
  if (points > 0) {
    showPPFlash(`+${points} PP`);
  }
}
 
function showPPFlash(text) {
  const el = document.getElementById('pp-flash');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1800);
}
 
function checkBet(betId) {
  const bet = parseInt(document.getElementById(betId).value);
  if (!currentPlayer)             { App.showToast('Load your player first!', 'info'); return null; }
  if (isNaN(bet) || bet < 50)     { App.showToast('Minimum bet is 50 Prime Points', 'info'); return null; }
  if (bet > (currentPlayer.primePoints || 0)) {
    App.showToast('Not enough Prime Points! Buy more via admin DM. ◈', 'info');
    return null;
  }
  return bet;
}
 
function setBet(id, val) { document.getElementById(id).value = val; }
 
// ────────────────────────────────────────────────────────────
// PRIME POINTS LEADERBOARD (sidebar)
// ────────────────────────────────────────────────────────────
async function renderPPLeaderboard() {
  const list = document.getElementById('pp-lb-list');
  if (!list) return;

  const rows  = await API.getPPLeaderboard(20);
  const board = App.parseUsers(rows).filter(u => (u.primePoints || 0) > 0);
  const medals = ['🥇','🥈','🥉'];
 
  if (!board.length) {
    list.innerHTML = `<div class="pp-lb-empty">No PP earned yet.<br>Play a game to appear here!</div>`;
    return;
  }
 
  list.innerHTML = board.map((entry, i) => `
    <div class="pp-lb-row ${currentPlayer && entry.phone === currentPlayer.phone ? 'pp-lb-me' : ''}">
      <span class="pp-lb-rank">${medals[i] || (i + 1)}</span>
      <div class="pp-lb-info">
        <div class="pp-lb-phone">${entry.name || entry.phone}</div>
        <div class="pp-lb-sub">${entry.rank || PPApi.calcRank(entry.primePoints)}</div>
      </div>
      <div class="pp-lb-pts">${entry.primePoints.toLocaleString()} <span class="pp-unit">PP</span></div>
    </div>
  `).join('');
}
 
// ────────────────────────────────────────────────────────────
// CASHOUT / WITHDRAW MODAL
// ────────────────────────────────────────────────────────────
function openCashoutModal() {
  if (!currentPlayer) { App.showToast('Load your player first!', 'info'); return; }
  const overlay = document.getElementById('cashout-modal');
  document.getElementById('co-player-name').textContent  = currentPlayer.name;
  document.getElementById('co-player-phone').textContent = currentPlayer.phone;
  document.getElementById('co-pp-balance').textContent   = (currentPlayer.primePoints || 0).toLocaleString();
  document.getElementById('co-amount').value             = '';
  document.getElementById('co-result').innerHTML         = '';
  overlay.classList.add('open');
}
 
function closeCashoutModal() {
  document.getElementById('cashout-modal').classList.remove('open');
}
 
async function submitCashout() {
  const amount = parseInt(document.getElementById('co-amount').value);
  const note   = document.getElementById('co-note').value.trim();
  const resEl  = document.getElementById('co-result');
  const btn    = document.getElementById('co-submit-btn');

  if (!currentPlayer) return;
  const MIN_WITHDRAW = 500;
  const points = currentPlayer.primePoints || 0;

  if (isNaN(amount) || amount < MIN_WITHDRAW) {
    resEl.innerHTML = `<div class="co-error">Minimum withdrawal is ${MIN_WITHDRAW} PP.</div>`;
    return;
  }
  if (amount > points) {
    resEl.innerHTML = `<div class="co-error">You only have ${points.toLocaleString()} PP.</div>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Processing…';

  // Under the instant limit — convert PP straight into Coins, no admin needed
  if (amount < PPApi.INSTANT_LIMIT) {
    const result = await queuePPSync(() => PPApi.withdrawToCoins(currentPlayer.id, currentPlayer._raw, amount));
    btn.disabled = false;
    btn.textContent = 'Withdraw →';

    if (!result || !result.success) {
      resEl.innerHTML = `<div class="co-error">Something went wrong — try again.</div>`;
      return;
    }

    currentPlayer.primePoints = result.primePoints;
    currentPlayer.rank        = result.rank;
    currentPlayer.coins       = result.newCoins;
    currentPlayer.netWorth    = result.newCoins + (currentPlayer.bank || 0);
    currentPlayer._raw        = {
      ...currentPlayer._raw,
      primePoints: result.primePoints,
      rank: result.rank,
      primos: result.newCoins,
      coins: result.newCoins,
    };
    refreshHUD();

    resEl.innerHTML = `
      <div class="co-success">
        <div class="co-success-title">✅ Converted instantly!</div>
        <div class="co-success-sub">${amount.toLocaleString()} PP → ${App.formatCoins(result.coinsGained)} Coins added to your wallet.</div>
      </div>`;
    document.getElementById('co-amount').value = '';
    return;
  }

  // 5,000 PP or more — deduct now, route to the admin via WhatsApp for manual review
  const coinsEquivalent = amount * PPApi.PP_TO_COIN_RATE;
  const ADMIN_WHATSAPP = '2348123534689'; // ← replace with actual admin number
  const msg = encodeURIComponent(
    `[PP WITHDRAWAL — LARGE AMOUNT]\n` +
    `Name: ${currentPlayer.name}\n` +
    `Phone: ${currentPlayer.phone}\n` +
    `Amount: ${amount.toLocaleString()} Prime Points (≈ ${coinsEquivalent.toLocaleString()} Coins)\n` +
    (note ? `Note: ${note}\n` : '') +
    `Time: ${new Date().toLocaleString()}`
  );
  const waLink = `https://wa.me/${ADMIN_WHATSAPP}?text=${msg}`;

  const res = await queuePPSync(() => PPApi.adjustPP(currentPlayer.id, currentPlayer._raw, -amount, 'Withdraw (manual review)', 'system'));
  btn.disabled = false;
  btn.textContent = 'Withdraw →';

  if (res) {
    currentPlayer.primePoints = res.primePoints;
    currentPlayer.rank        = res.rank;
    currentPlayer.ppHistory   = res.ppHistory;
    currentPlayer._raw        = { ...currentPlayer._raw, primePoints: res.primePoints, rank: res.rank, ppHistory: res.ppHistory };
    refreshHUD();
  }
 
  resEl.innerHTML = `
    <div class="co-success">
      <div class="co-success-title">✅ Request ready!</div>
      <div class="co-success-sub">${amount.toLocaleString()} PP deducted — this amount needs manual review. Send the pre-filled message to the admin to complete it.</div>
      <a class="co-wa-btn" href="${waLink}" target="_blank" rel="noopener">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
        Open WhatsApp to send request
      </a>
    </div>
  `;
}
 
// ────────────────────────────────────────────────────────────
// GAME TABS
// ────────────────────────────────────────────────────────────
function switchGame(id, el) {
  document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.game-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  if (el) el.classList.add('active');
}
 
// ────────────────────────────────────────────────────────────
// SHARED HELPERS
// ────────────────────────────────────────────────────────────
const gameLogs = { minesweeper: [], tictactoe: [], crash: [], scramble: [], coinflip: [], diceduel: [] };
 
function addLog(game, text, win) {
  gameLogs[game].unshift({ text, win, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  if (gameLogs[game].length > 6) gameLogs[game].pop();
  renderLog(game);
}
 
function renderLog(game) {
  const idMap = { minesweeper: 'mine', tictactoe: 'ttt', crash: 'crash', scramble: 'scr', coinflip: 'cf', diceduel: 'dd' };
  const el = document.getElementById(idMap[game] + '-log-list');
  if (!el) return;
  if (!gameLogs[game].length) { el.innerHTML = '<span style="color:var(--text-3)">No games yet</span>'; return; }
  el.innerHTML = gameLogs[game].map(l => `
    <div class="log-item">
      <span class="log-game">${l.time}</span>
      <span class="${l.win ? 'log-win' : 'log-lose'}">${l.text}</span>
    </div>
  `).join('');
}
 
function showResult(id, win, title, sub) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `result-banner ${win ? 'win' : 'lose'} show`;
  el.innerHTML = `<div>${title}</div><div class="result-amt">${sub}</div>`;
  setTimeout(() => el.classList.remove('show'), 5500);
}
 
// Prime Points per game win/lose
const PP_RATES = {
  minesweeper: { win: 50, lose: 0 },
  tictactoe:   { win: 30, lose: 0 },
  crash:       { win: 20, lose: 0 },  // per cashout
  scramble:    { win: 25, lose: 0 },
  coinflip:    { win: 10, lose: 0 },
  diceduel:    { win: 15, lose: 0 },
};
 
// ════════════════════════════════════════════════════════════
//  GAME 1 — MINESWEEPER
// ════════════════════════════════════════════════════════════
let mineState = null;
 
function startMinesweeper() {
  const bet = checkBet('mine-bet');
  if (bet === null) return;
 
  const ROWS = 10, COLS = 10, MINES = 20;
  const cells = Array(ROWS * COLS).fill(null).map((_, i) => ({ idx: i, mine: false, revealed: false, flagged: false, adj: 0 }));
 
  let placed = 0;
  while (placed < MINES) {
    const r = Math.floor(Math.random() * ROWS * COLS);
    if (!cells[r].mine) { cells[r].mine = true; placed++; }
  }
  cells.forEach((c, i) => {
    if (c.mine) return;
    const row = Math.floor(i / COLS), col = i % COLS;
    let adj = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = row + dr, nc = col + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && cells[nr * COLS + nc].mine) adj++;
    }
    c.adj = adj;
  });
 
  const safeCells = ROWS * COLS - MINES;
  mineState = { cells, rows: ROWS, cols: COLS, mines: MINES, bet, safe: safeCells, revealed: 0, active: true };
 
  document.getElementById('mine-cells-left').textContent = safeCells;
  document.getElementById('mine-win-amount').textContent = App.formatCoins(bet * 4);
  document.getElementById('mine-start-btn').textContent  = 'Restart';
  document.getElementById('mine-result').classList.remove('show');
  syncPP(-bet, 'bet');
  renderMineGrid();
}
 
function renderMineGrid() {
  const { cells, rows, cols } = mineState;
  const grid = document.getElementById('mine-grid');
  grid.style.gridTemplateColumns = `repeat(${cols}, 34px)`;
  grid.innerHTML = '';
  cells.forEach((c, i) => {
    const el = document.createElement('div');
    el.className = 'mine-cell';
    if (c.revealed) {
      el.classList.add('revealed');
      el.textContent = c.mine ? '💣' : c.adj ? c.adj : '';
      if (!c.mine && c.adj) el.classList.add(`n${c.adj}`);
      if (c.mine) el.classList.add('mine-boom');
    } else if (c.flagged) {
      el.classList.add('flagged');
      el.textContent = '🚩';
    }
    if (!c.revealed && mineState.active) {
      el.addEventListener('click', () => mineReveal(i));
      el.addEventListener('contextmenu', e => { e.preventDefault(); mineFlag(i); });
    }
    grid.appendChild(el);
  });
}
 
function mineReveal(idx) {
  if (!mineState || !mineState.active) return;
  const { cells, cols, rows } = mineState;
  const c = cells[idx];
  if (c.revealed || c.flagged) return;
 
  if (c.mine) {
    cells.forEach(cell => { if (cell.mine) cell.revealed = true; });
    mineState.active = false;
    renderMineGrid();
    showResult('mine-result', false, '💥 Hit a mine!', `-${App.formatCoins(mineState.bet)} ◈ PP`);
    addLog('minesweeper', `Hit mine — lost ${App.formatCoins(mineState.bet)}`, false);
    awardPP(PP_RATES.minesweeper.lose, 'Minesweeper');
    return;
  }
 
  const flood = [idx];
  while (flood.length) {
    const fi = flood.pop();
    if (cells[fi].revealed) continue;
    cells[fi].revealed = true;
    mineState.revealed++;
    if (cells[fi].adj === 0) {
      const row = Math.floor(fi / cols), col = fi % cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr, nc = col + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          const ni = nr * cols + nc;
          if (!cells[ni].revealed && !cells[ni].mine) flood.push(ni);
        }
      }
    }
  }
 
  document.getElementById('mine-cells-left').textContent = mineState.safe - mineState.revealed;
 
  if (mineState.revealed >= mineState.safe) {
    mineState.active = false;
    const win = mineState.bet * 4;
    syncPP(win, 'payout');
    renderMineGrid();
    showResult('mine-result', true, '🎉 Board cleared!', `+${App.formatCoins(win)} ◈ won · +${PP_RATES.minesweeper.win} PP`);
    addLog('minesweeper', `Cleared! Won ${App.formatCoins(win)}`, true);
    awardPP(PP_RATES.minesweeper.win, 'Minesweeper');
    return;
  }
  renderMineGrid();
}
 
function mineFlag(idx) {
  if (!mineState || !mineState.active) return;
  mineState.cells[idx].flagged = !mineState.cells[idx].flagged;
  renderMineGrid();
}
 
// ════════════════════════════════════════════════════════════
//  GAME 2 — TIC-TAC-TOE (Minimax bot)
// ════════════════════════════════════════════════════════════
let tttState = null;
 
function startTTT() {
  const bet = checkBet('ttt-bet');
  if (bet === null) return;
  tttState = { board: Array(9).fill(''), human: 'X', bot: 'O', bet, active: true };
  document.getElementById('ttt-start-btn').textContent = 'New Game';
  document.getElementById('ttt-status').textContent    = 'Your turn — play X';
  document.getElementById('ttt-result').classList.remove('show');
  syncPP(-bet, 'bet');
  renderTTT();
}
 
function renderTTT() {
  const board = document.getElementById('ttt-board');
  board.innerHTML = '';
  tttState.board.forEach((cell, i) => {
    const el = document.createElement('div');
    el.className  = 'ttt-cell';
    el.textContent = cell;
    if (!cell && tttState.active) el.addEventListener('click', () => tttMove(i));
    board.appendChild(el);
  });
}
 
function tttMove(idx) {
  if (!tttState || !tttState.active || tttState.board[idx]) return;
  tttState.board[idx] = tttState.human;
  if (checkTTTWin(tttState.board, tttState.human)) { endTTT('win'); return; }
  if (tttState.board.every(c => c)) { endTTT('draw'); return; }
  document.getElementById('ttt-status').textContent = 'Bot thinking…';
  renderTTT();
  setTimeout(() => {
    const move = bestTTTMove(tttState.board);
    tttState.board[move] = tttState.bot;
    if (checkTTTWin(tttState.board, tttState.bot)) { endTTT('lose'); return; }
    if (tttState.board.every(c => c)) { endTTT('draw'); return; }
    document.getElementById('ttt-status').textContent = 'Your turn — play X';
    renderTTT();
  }, 400);
}
 
function endTTT(result) {
  tttState.active = false;
  if (result === 'win') {
    const win = tttState.bet * 3;
    syncPP(win, 'payout');
    highlightTTT(tttState.human);
    showResult('ttt-result', true, '🏆 You beat the bot!', `+${App.formatCoins(win)} ◈ won · +${PP_RATES.tictactoe.win} PP`);
    addLog('tictactoe', `Beat bot — won ${App.formatCoins(win)}`, true);
    awardPP(PP_RATES.tictactoe.win, 'Tic-Tac-Toe');
    document.getElementById('ttt-status').textContent = 'You won! 🏆';
  } else if (result === 'lose') {
    highlightTTT(tttState.bot);
    showResult('ttt-result', false, '🤖 Bot wins.', `-${App.formatCoins(tttState.bet)} ◈ PP`);
    addLog('tictactoe', `Lost to bot`, false);
    document.getElementById('ttt-status').textContent = 'Bot wins 🤖';
  } else {
    const ret = Math.floor(tttState.bet * 0.7);
    syncPP(ret, 'payout');
    showResult('ttt-result', false, '🤝 Draw — house takes 30%', `−${App.formatCoins(tttState.bet - ret)} 🪙`);
    addLog('tictactoe', `Draw — lost ${App.formatCoins(tttState.bet - ret)}`, false);
    document.getElementById('ttt-status').textContent = 'Draw!';
  }
  renderTTT();
}
 
const TTT_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function checkTTTWin(b, p) { return TTT_LINES.some(l => l.every(i => b[i] === p)); }
function highlightTTT(p) {
  const line = TTT_LINES.find(l => l.every(i => tttState.board[i] === p));
  if (!line) return;
  document.querySelectorAll('.ttt-cell').forEach((el, i) => {
    if (line.includes(i)) el.classList.add(p === tttState.human ? 'win-cell' : 'lose-cell');
  });
}
function minimax(b, isMax, d) {
  if (checkTTTWin(b, tttState.bot))   return 10 - d;
  if (checkTTTWin(b, tttState.human)) return d - 10;
  if (b.every(c => c)) return 0;
  const moves = b.map((c,i) => c ? null : i).filter(i => i !== null);
  if (isMax) {
    let best = -Infinity;
    for (const m of moves) { b[m] = tttState.bot; best = Math.max(best, minimax(b, false, d+1)); b[m] = ''; }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) { b[m] = tttState.human; best = Math.min(best, minimax(b, true, d+1)); b[m] = ''; }
    return best;
  }
}
function bestTTTMove(b) {
  let best = -Infinity, move = -1;
  b.forEach((c,i) => {
    if (c) return;
    b[i] = tttState.bot;
    const s = minimax(b, false, 0);
    b[i] = '';
    if (s > best) { best = s; move = i; }
  });
  return move;
}
 
// ════════════════════════════════════════════════════════════
//  GAME 3 — NUMBER CRASH
// ════════════════════════════════════════════════════════════
let crashState    = null;
let crashInterval = null;
 
function startCrash() {
  if (crashState && crashState.running) return;
  const bet = checkBet('crash-bet');
  if (bet === null) return;
 
  const r       = Math.random();
  const crashAt = Math.max(1.01, 1 / (1 - r * 0.92));
  crashState    = { bet, crashAt, current: 1.00, running: true, cashedOut: false };
  syncPP(-bet, 'bet');
 
  document.getElementById('crash-start-btn').disabled    = true;
  document.getElementById('crash-cashout-btn').disabled  = false;
  document.getElementById('crash-sub').textContent       = 'Running — cash out before it crashes!';
  document.getElementById('crash-result').classList.remove('show');
 
  let tick = 0;
  crashInterval = setInterval(() => {
    tick += 0.06;
    crashState.current = +(1 + Math.pow(tick, 1.6) * 0.04).toFixed(2);
    const pct   = Math.min(100, ((crashState.current - 1) / (crashState.crashAt - 1)) * 100);
    const color = crashState.current < 1.5 ? 'var(--gold)' : crashState.current < 2.5 ? '#639922' : crashState.current < 5 ? 'var(--accent)' : '#D4537E';
    document.getElementById('crash-fill').style.width   = pct + '%';
    document.getElementById('crash-mult').style.color   = color;
    document.getElementById('crash-mult').textContent   = crashState.current.toFixed(2) + '×';
    if (crashState.current >= crashState.crashAt) { clearInterval(crashInterval); crashBoom(); }
  }, 80);
}
 
function crashCashout() {
  if (!crashState || !crashState.running || crashState.cashedOut) return;
  crashState.cashedOut = true;
  clearInterval(crashInterval);
  crashState.running   = false;
 
  const payout = Math.floor(crashState.bet * crashState.current);
  const pp     = PP_RATES.crash.win;
  syncPP(payout, 'payout');
  awardPP(pp, 'Number Crash');
 
  document.getElementById('crash-cashout-btn').disabled  = true;
  document.getElementById('crash-start-btn').disabled    = false;
  document.getElementById('crash-sub').textContent       = `Cashed out at ${crashState.current.toFixed(2)}×`;
  document.getElementById('crash-fill').style.background = 'var(--success)';
  showResult('crash-result', true, `💰 Cashed out at ${crashState.current.toFixed(2)}×`, `+${App.formatCoins(payout)} ◈ won · +${pp} PP`);
  addLog('crash', `${crashState.current.toFixed(2)}× → +${App.formatCoins(payout)}`, true);
}
 
function crashBoom() {
  crashState.running = false;
  document.getElementById('crash-cashout-btn').disabled  = true;
  document.getElementById('crash-start-btn').disabled    = false;
  document.getElementById('crash-mult').textContent      = '💥 ' + crashState.crashAt.toFixed(2) + '×';
  document.getElementById('crash-mult').style.color      = 'var(--danger)';
  document.getElementById('crash-sub').textContent       = 'Crashed!';
  document.getElementById('crash-fill').style.background = 'var(--danger)';
  document.getElementById('crash-fill').style.width      = '100%';
  if (!crashState.cashedOut) {
    showResult('crash-result', false, `💥 Crashed at ${crashState.crashAt.toFixed(2)}×`, `-${App.formatCoins(crashState.bet)} ◈ PP`);
    addLog('crash', `Crashed at ${crashState.crashAt.toFixed(2)}×`, false);
  }
}
 
// ════════════════════════════════════════════════════════════
//  GAME 4 — WORD SCRAMBLE
// ════════════════════════════════════════════════════════════
const WORD_LIST = [
  { word: 'NARUTO',   hint: 'Hokage-in-training, 9 tails' },
  { word: 'BLEACH',   hint: 'Soul Reapers and Hollows' },
  { word: 'TOTORO',   hint: 'Studio Ghibli forest spirit' },
  { word: 'VEGETA',   hint: 'Prince of all Saiyans' },
  { word: 'ITACHI',   hint: 'Uchiha who loved his brother' },
  { word: 'KAKASHI',  hint: 'The Copy Ninja, always masked' },
  { word: 'LUFFY',    hint: 'Rubber pirate, future King' },
  { word: 'ZORO',     hint: 'Three swords, one direction' },
  { word: 'GINTOKI',  hint: 'Silver samurai, odd jobs' },
  { word: 'SHINICHI', hint: 'Teen detective, small body' },
  { word: 'MIKASA',   hint: 'AoT elite soldier, black hair' },
  { word: 'LEVI',     hint: "Humanity's strongest soldier" },
  { word: 'SAITAMA',  hint: 'One punch defeats everything' },
  { word: 'RIMURU',   hint: 'Reincarnated slime lord' },
  { word: 'AINZ',     hint: 'Undead overlord of Nazarick' },
  { word: 'FRIEZA',   hint: 'Emperor of the universe' },
  { word: 'GOKU',     hint: 'Saiyan raised on Earth' },
  { word: 'REINER',   hint: 'Armored Titan, AoT warrior' },
  { word: 'KILLUA',   hint: 'HxH assassin with white hair' },
  { word: 'GINTAMA',  hint: 'Samurai comedy set in Edo' },
];
 
let scrState = null;
let scrTimer = null;
 
function scrambleWord(word) {
  const arr = word.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const s = arr.join('');
  return s === word ? scrambleWord(word) : s;
}
 
function startScramble() {
  if (scrState && scrState.active) return;
  const bet = checkBet('scr-bet');
  if (bet === null) return;
 
  const pick = WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
  scrState   = { bet, word: pick.word, active: true, timeLeft: 20 };
  syncPP(-bet, 'bet');
 
  document.getElementById('scr-word').textContent      = scrambleWord(pick.word).split('').join(' ');
  document.getElementById('scr-hint').textContent      = `Hint: ${pick.hint}`;
  document.getElementById('scr-answer').value          = '';
  document.getElementById('scr-answer').disabled       = false;
  document.getElementById('scr-answer').focus();
  document.getElementById('scr-start-btn').textContent = 'Restart Round';
  document.getElementById('scr-result').classList.remove('show');
  updateScrTimer(20);
 
  clearInterval(scrTimer);
  scrTimer = setInterval(() => {
    scrState.timeLeft--;
    updateScrTimer(scrState.timeLeft);
    if (scrState.timeLeft <= 0) { clearInterval(scrTimer); endScramble(false); }
  }, 1000);
}
 
function updateScrTimer(t) {
  const el = document.getElementById('scr-timer');
  el.textContent = t + 's';
  el.className   = 'scramble-timer' + (t <= 5 ? ' danger' : '');
}
 
function endScramble(win) {
  if (!scrState || !scrState.active) return;
  scrState.active = false;
  clearInterval(scrTimer);
  document.getElementById('scr-answer').disabled = true;
  document.getElementById('scr-word').textContent = scrState.word.split('').join(' ');
  if (win) {
    const payout = Math.floor(scrState.bet * 2.5);
    syncPP(payout, 'payout');
    awardPP(PP_RATES.scramble.win, 'Word Scramble');
    showResult('scr-result', true, '🎉 Correct!', `+${App.formatCoins(payout)} ◈ won · +${PP_RATES.scramble.win} PP`);
    addLog('scramble', `Solved ${scrState.word} → +${App.formatCoins(payout)}`, true);
  } else {
    showResult('scr-result', false, `⏰ Time up! Answer: ${scrState.word}`, `-${App.formatCoins(scrState.bet)} ◈ PP`);
    addLog('scramble', `Failed "${scrState.word}" — lost ${App.formatCoins(scrState.bet)}`, false);
  }
  document.getElementById('scr-timer').textContent    = '—';
  document.getElementById('scr-start-btn').textContent = 'New Round';
}
 
// ════════════════════════════════════════════════════════════
//  GAME 5 — COIN FLIP
// ════════════════════════════════════════════════════════════
let cfFlipping = false;
 
function playCoinFlip(choice) {
  if (cfFlipping) return;
  const bet = checkBet('cf-bet');
  if (bet === null) return;
 
  cfFlipping = true;
  document.querySelectorAll('.cf-choice-btn').forEach(b => b.disabled = true);
  document.getElementById('cf-result').classList.remove('show');
 
  const coin     = document.getElementById('cf-coin');
  const resultEl = document.getElementById('cf-result');
  const outcome  = Math.random() < 0.5 ? 'heads' : 'tails';
  const win      = outcome === choice;
 
  syncPP(-bet, 'bet');
  coin.classList.add('cf-spinning');
 
  // Reveal after spin animation
  setTimeout(() => {
    coin.classList.remove('cf-spinning');
    coin.textContent = outcome === 'heads' ? '🪙' : '🌑';
    coin.setAttribute('data-face', outcome);
 
    if (win) {
      const payout = bet * 2;
      syncPP(payout, 'payout');
      awardPP(PP_RATES.coinflip.win, 'Coin Flip');
      showResult('cf-result', true, `✅ ${outcome.toUpperCase()}! You guessed right.`, `+${App.formatCoins(payout)} ◈ won · +${PP_RATES.coinflip.win} PP`);
      addLog('coinflip', `${choice} → ${outcome} WIN +${App.formatCoins(payout)}`, true);
    } else {
      showResult('cf-result', false, `❌ ${outcome.toUpperCase()}. Wrong guess.`, `-${App.formatCoins(bet)} ◈ PP`);
      addLog('coinflip', `${choice} → ${outcome} LOSE`, false);
    }
 
    cfFlipping = false;
    document.querySelectorAll('.cf-choice-btn').forEach(b => b.disabled = false);
  }, 900);
}
 
// ════════════════════════════════════════════════════════════
//  GAME 6 — HIGH-LOW DICE DUEL
// ════════════════════════════════════════════════════════════
// Player picks High (4–6) or Low (1–3). Both player and bot
// roll a d6. Player wins if their roll is in the chosen range
// AND beats the bot's roll. Wins = 2.2× bet.
let ddRolling = false;
 
function playDiceDuel(choice) {
  if (ddRolling) return;
  const bet = checkBet('dd-bet');
  if (bet === null) return;
 
  ddRolling = true;
  syncPP(-bet, 'bet');
  document.querySelectorAll('.dd-choice-btn').forEach(b => b.disabled = true);
  document.getElementById('dd-result').classList.remove('show');
 
  const playerDie = document.getElementById('dd-player-die');
  const botDie    = document.getElementById('dd-bot-die');
  playerDie.classList.add('dd-rolling');
  botDie.classList.add('dd-rolling');
 
  // Animate rolling
  let ticks = 0;
  const rollAnim = setInterval(() => {
    playerDie.textContent = DICE_FACES[Math.floor(Math.random() * 6)];
    botDie.textContent    = DICE_FACES[Math.floor(Math.random() * 6)];
    ticks++;
    if (ticks >= 12) {
      clearInterval(rollAnim);
      const playerRoll = Math.floor(Math.random() * 6) + 1;
      const botRoll    = Math.floor(Math.random() * 6) + 1;
 
      playerDie.classList.remove('dd-rolling');
      botDie.classList.remove('dd-rolling');
      playerDie.textContent = DICE_FACES[playerRoll - 1];
      botDie.textContent    = DICE_FACES[botRoll - 1];
 
      document.getElementById('dd-player-val').textContent = playerRoll;
      document.getElementById('dd-bot-val').textContent    = botRoll;
 
      const inRange = choice === 'high' ? playerRoll >= 4 : playerRoll <= 3;
      const win     = inRange && playerRoll > botRoll;
 
      if (win) {
        const payout = Math.floor(bet * 2.2);
        syncPP(payout, 'payout');
        awardPP(PP_RATES.diceduel.win, 'Dice Duel');
        showResult('dd-result', true, `🎲 ${playerRoll} vs ${botRoll} — You win!`, `+${App.formatCoins(payout)} ◈ won · +${PP_RATES.diceduel.win} PP`);
        addLog('diceduel', `${choice} · ${playerRoll} vs ${botRoll} WIN +${App.formatCoins(payout)}`, true);
        playerDie.classList.add('dd-win');
      } else {
        let reason = '';
        if (!inRange)          reason = `${playerRoll} not in ${choice} range`;
        else if (playerRoll <= botRoll) reason = `tie/bot higher`;
        showResult('dd-result', false, `🎲 ${playerRoll} vs ${botRoll} — ${reason}`, `-${App.formatCoins(bet)} ◈ PP`);
        addLog('diceduel', `${choice} · ${playerRoll} vs ${botRoll} LOSE`, false);
        botDie.classList.add('dd-lose');
      }
 
      ddRolling = false;
      document.querySelectorAll('.dd-choice-btn').forEach(b => b.disabled = false);
      setTimeout(() => {
        playerDie.classList.remove('dd-win');
        botDie.classList.remove('dd-lose');
      }, 1200);
    }
  }, 80);
}
 
const DICE_FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];
 
// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  renderSidebar('games');
  renderPPLeaderboard();

  // Auto-load player from member session (set by member-login.html)
  const sessionPhone = sessionStorage.getItem('agi_member_phone');
  if (sessionPhone) {
    const raw  = await API.getUserByPhone(sessionPhone);
    const user = App.parseUser(raw?.[0]);
    if (user) {
      currentPlayer = user;
      refreshHUD();
      const loadSection = document.getElementById('hud-load-section');
      if (loadSection) loadSection.style.display = 'none';
      App.showToast(`Welcome back, ${user.name}! 🎮`, 'info');
    }
  }

  // Pre-fill phone input from session even if auto-load failed
  const savedPhone = sessionStorage.getItem('agi_member_phone');
  if (savedPhone) {
    const phoneInput = document.getElementById('hud-phone');
    if (phoneInput) phoneInput.value = savedPhone;
  }

  document.getElementById('hud-load-btn').addEventListener('click', loadPlayer);
  document.getElementById('hud-phone').addEventListener('keydown', e => { if (e.key === 'Enter') loadPlayer(); });
 
  // Word scramble live check
  document.getElementById('scr-answer').addEventListener('input', e => {
    if (!scrState || !scrState.active) return;
    if (e.target.value.toUpperCase().trim() === scrState.word) endScramble(true);
  });
 
  // Cashout modal close on overlay click
  document.getElementById('cashout-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('cashout-modal')) closeCashoutModal();
  });
 
  // Init empty mine grid
  const grid = document.getElementById('mine-grid');
  grid.style.gridTemplateColumns = 'repeat(10, 34px)';
  for (let i = 0; i < 100; i++) {
    const el = document.createElement('div');
    el.className = 'mine-cell';
    grid.appendChild(el);
  }
 
  // Init TTT board
  const board = document.getElementById('ttt-board');
  for (let i = 0; i < 9; i++) {
    const el = document.createElement('div');
    el.className = 'ttt-cell';
    board.appendChild(el);
  }
 
  // Init dice faces
  document.getElementById('dd-player-die').textContent = DICE_FACES[0];
  document.getElementById('dd-bot-die').textContent    = DICE_FACES[0];
});
