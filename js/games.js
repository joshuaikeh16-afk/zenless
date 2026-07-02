// ════════════════════════════════════════════════════════════════
//  games.js — AniGamble HQ · Arcade
//  Pure skill games. No betting, no Prime Points, no awarding.
//  Each game costs a flat 5 Primo "entry pass" to play a round —
//  it is a cover charge, not a wager. Nothing is ever paid out.
//  High scores are tracked locally per-device (localStorage).
// ════════════════════════════════════════════════════════════════

'use strict';

// ────────────────────────────────────────────────────────────
// PLAYER STATE
// ────────────────────────────────────────────────────────────
let currentPlayer = null;
const ENTRY_FEE = 5;

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
  sessionStorage.setItem('agi_member_phone', user.phone);
  sessionStorage.setItem('agi_member_name',  user.name);

  btn.textContent = 'Load Player';
  btn.disabled    = false;

  refreshHUD();
  const loadSection = document.getElementById('hud-load-section');
  if (loadSection) loadSection.style.display = 'none';
  App.showToast(`Welcome, ${user.name}! 🕹️`, 'info');
}

function refreshHUD() {
  if (!currentPlayer) return;
  document.getElementById('hud-avatar').innerHTML = App.renderAvatar(currentPlayer, 42);
  document.getElementById('hud-name').textContent  = currentPlayer.name;
  document.getElementById('hud-name').className    = 'hud-name';
  document.getElementById('hud-pp').textContent     = (currentPlayer.primePoints || 0).toLocaleString();
}

// ────────────────────────────────────────────────────────────
// ENTRY PASS — flat 5 Prime Point cover charge, never paid back out.
// Uses the same PPApi.adjustPP write path the rest of the site
// already relies on for Prime Points, so it actually persists.
// ────────────────────────────────────────────────────────────
let ppSyncChain = Promise.resolve();
function queuePPSync(fn) {
  const result = ppSyncChain.then(fn);
  ppSyncChain  = result.catch(() => {});
  return result;
}

async function payEntry(label) {
  if (!currentPlayer) { App.showToast('Load your player first!', 'info'); return false; }
  if ((currentPlayer.primePoints || 0) < ENTRY_FEE) {
    App.showToast(`You need ${ENTRY_FEE} ◈ Prime Points for an entry pass`, 'info');
    return false;
  }
  const res = await queuePPSync(() =>
    PPApi.adjustPP(currentPlayer.id, currentPlayer._raw, -ENTRY_FEE, `Arcade entry — ${label}`, 'game')
  );
  if (!res || res.failed) {
    App.showToast('Could not process entry pass — try again', 'info');
    return false;
  }
  currentPlayer.primePoints = res.primePoints;
  currentPlayer.rank        = res.rank;
  currentPlayer.ppHistory   = res.ppHistory;
  currentPlayer._raw        = { ...currentPlayer._raw, primePoints: res.primePoints, rank: res.rank, ppHistory: res.ppHistory };
  refreshHUD();
  App.showToast(`🎟️ Entry pass paid (${ENTRY_FEE} ◈) — enjoy ${label}!`, 'info');
  return true;
}

// ────────────────────────────────────────────────────────────
// HIGH SCORE HELPERS (per-device, localStorage)
// ────────────────────────────────────────────────────────────
function getHS(key, def = 0) {
  const v = localStorage.getItem('agi_hs_' + key);
  return v === null ? def : parseInt(v);
}
function setHS(key, val) { localStorage.setItem('agi_hs_' + key, val); }
function updateHSDisplay(key, elId, formatter) {
  const el = document.getElementById(elId);
  if (!el) return;
  const val = getHS(key, formatter ? undefined : 0);
  el.textContent = formatter ? formatter(getHS(key, 0)) : val;
}
function shuffleArr(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function refreshAllHighScores() {
  updateHSDisplay('snake', 'snake-hs');
  updateHSDisplay('tetris', 'tet-hs');
  updateHSDisplay('memory_moves', 'mem-hs', v => v === 0 ? '—' : v);
  updateHSDisplay('typing_wpm', 'typ-hs');
  updateHSDisplay('reaction_streak', 'rx-hs');
  updateHSDisplay('breaker', 'brk-hs');
  updateHSDisplay('trivia', 'triv-hs');
  updateHSDisplay('slider_' + (sliderPendingSize || 3), 'slider-hs', v => v === 0 ? '—' : v);
  const list = document.getElementById('hs-panel-list');
  if (!list) return;
  const rows = [
    ['🐍 Snake', getHS('snake'), 'pts'],
    ['🧱 Tetris', getHS('tetris'), 'pts'],
    ['🃏 Memory', getHS('memory_moves', 0), 'moves'],
    ['⌨️ Typing', getHS('typing_wpm'), 'wpm'],
    ['⚡ Reaction', getHS('reaction_streak'), 'streak'],
    ['🧱 Breaker', getHS('breaker'), 'pts'],
    ['🧠 Trivia', getHS('trivia'), 'pts'],
    ['🧩 Puzzle 3×3', getHS('slider_3', 0), 'moves'],
  ];
  list.innerHTML = rows.map(([name, val, unit]) => `
    <div class="hs-row">
      <span class="hs-row-name">${name}</span>
      <span class="hs-row-val">${val || '—'}${val ? ' ' + unit : ''}</span>
    </div>
  `).join('');
}

// ────────────────────────────────────────────────────────────
// TAB SWITCHING — pauses inactive games to save CPU/state
// ────────────────────────────────────────────────────────────
function switchGame(id, el) {
  document.querySelectorAll('.game-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.game-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + id).classList.add('active');
  if (el) el.classList.add('active');
  pauseInactiveGames(id);
}
function pauseInactiveGames(activeId) {
  if (activeId !== 'snake' && snake) { clearInterval(snake.timer); snake.active = false; }
  if (activeId !== 'tetris' && tetris) { clearInterval(tetris.timer); tetris.active = false; }
  if (activeId !== 'breaker' && breaker) { cancelAnimationFrame(breaker.raf); clearInterval(breaker.laserTimer); breaker.active = false; }
  if (activeId !== 'reaction' && reaction) { reaction.active = false; }
  if (activeId !== 'typing' && typing) { typing.active = false; }
  if (activeId !== 'trivia' && trivia) { clearTimeout(trivia.timer); trivia.active = false; }
  if (activeId !== 'memory' && memory) { clearInterval(memory.timer); memory.active = false; }
  if (activeId !== 'slider' && slider) { slider.active = false; }
}

// ════════════════════════════════════════════════════════════
//  GAME 1 — NEON SNAKE
// ════════════════════════════════════════════════════════════
let snake = null;
const SNAKE_COLS = 20, SNAKE_ROWS = 20, SNAKE_CELL = 20;

function startSnake() {
  if (snake && snake.active) return;
  payEntry('Neon Snake').then(ok => { if (ok) initSnakeGame(); });
}
function initSnakeGame() {
  const canvas = document.getElementById('snake-canvas');
  const ctx = canvas.getContext('2d');
  snake = {
    body: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
    dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 },
    score: 0, baseSpeed: 150, speed: 150, active: true, ctx, canvas,
  };
  snake.food = randomFood(snake.body);
  document.getElementById('snake-score').textContent = '0';
  document.getElementById('snake-speed').textContent = '1.0x';
  document.getElementById('snake-overlay').innerHTML = '';
  document.getElementById('snake-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  clearInterval(snake.timer);
  snake.timer = setInterval(snakeTick, snake.speed);
  drawSnake();
}
function randomFood(body) {
  let pos;
  do { pos = { x: Math.floor(Math.random() * SNAKE_COLS), y: Math.floor(Math.random() * SNAKE_ROWS) }; }
  while (body.some(s => s.x === pos.x && s.y === pos.y));
  return pos;
}
function snakeTick() {
  if (!snake || !snake.active) return;
  snake.dir = snake.nextDir;
  const head = { x: snake.body[0].x + snake.dir.x, y: snake.body[0].y + snake.dir.y };
  if (head.x < 0 || head.x >= SNAKE_COLS || head.y < 0 || head.y >= SNAKE_ROWS ||
      snake.body.some(s => s.x === head.x && s.y === head.y)) {
    return snakeGameOver();
  }
  snake.body.unshift(head);
  if (head.x === snake.food.x && head.y === snake.food.y) {
    snake.score += 10;
    document.getElementById('snake-score').textContent = snake.score;
    snake.food = randomFood(snake.body);
    snake.speed = Math.max(60, snake.speed - 3);
    document.getElementById('snake-speed').textContent = (snake.baseSpeed / snake.speed).toFixed(1) + 'x';
    clearInterval(snake.timer);
    snake.timer = setInterval(snakeTick, snake.speed);
  } else {
    snake.body.pop();
  }
  drawSnake();
}
function drawSnake() {
  const { ctx, canvas } = snake;
  ctx.fillStyle = '#0a0a12';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.shadowBlur = 15; ctx.shadowColor = '#f5c518'; ctx.fillStyle = '#f5c518';
  ctx.beginPath();
  ctx.arc(snake.food.x * SNAKE_CELL + 10, snake.food.y * SNAKE_CELL + 10, 8, 0, Math.PI * 2);
  ctx.fill();
  snake.body.forEach((seg, i) => {
    const t = 1 - i / snake.body.length;
    ctx.shadowBlur = 12;
    ctx.shadowColor = i === 0 ? '#a78bfa' : '#7C5DFA';
    ctx.fillStyle = i === 0 ? '#c4b5fd' : `rgba(124,93,250,${0.35 + t * 0.6})`;
    ctx.fillRect(seg.x * SNAKE_CELL + 1, seg.y * SNAKE_CELL + 1, SNAKE_CELL - 2, SNAKE_CELL - 2);
  });
  ctx.shadowBlur = 0;
}
function snakeGameOver() {
  clearInterval(snake.timer);
  snake.active = false;
  const hs = getHS('snake');
  if (snake.score > hs) { setHS('snake', snake.score); App.showToast('🏆 New high score!', 'info'); }
  refreshAllHighScores();
  document.getElementById('snake-overlay').innerHTML = `<div class="stage-gameover">💥 Game Over<br><span>Score: ${snake.score}</span></div>`;
  document.getElementById('snake-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}
function snakeSetDir(x, y) {
  if (!snake || !snake.active) return;
  if (snake.dir.x !== -x || snake.dir.y !== -y) snake.nextDir = { x, y };
}

// ════════════════════════════════════════════════════════════
//  GAME 2 — TETRIS
// ════════════════════════════════════════════════════════════
const TETRIS_COLS = 10, TETRIS_ROWS = 20, TETRIS_CELL = 24;
const TETROMINOES = {
  I: { shape: [[1, 1, 1, 1]], color: '#22d3ee' },
  O: { shape: [[1, 1], [1, 1]], color: '#f5c518' },
  T: { shape: [[0, 1, 0], [1, 1, 1]], color: '#a78bfa' },
  S: { shape: [[0, 1, 1], [1, 1, 0]], color: '#22c55e' },
  Z: { shape: [[1, 1, 0], [0, 1, 1]], color: '#ef4444' },
  J: { shape: [[1, 0, 0], [1, 1, 1]], color: '#3b82f6' },
  L: { shape: [[0, 0, 1], [1, 1, 1]], color: '#f97316' },
};
let tetris = null;

function startTetris() { payEntry('Tetris').then(ok => { if (ok) initTetris(); }); }
function newTetrisPiece() {
  const keys = Object.keys(TETROMINOES);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const def = TETROMINOES[key];
  return { key, shape: def.shape.map(r => r.slice()), color: def.color, x: Math.floor((TETRIS_COLS - def.shape[0].length) / 2), y: 0 };
}
function initTetris() {
  tetris = {
    grid: Array.from({ length: TETRIS_ROWS }, () => Array(TETRIS_COLS).fill(null)),
    current: newTetrisPiece(), next: newTetrisPiece(),
    score: 0, lines: 0, level: 1, dropInterval: 800, active: true, paused: false,
  };
  document.getElementById('tet-score').textContent = '0';
  document.getElementById('tet-lines').textContent = '0';
  document.getElementById('tet-level').textContent = '1';
  document.getElementById('tet-overlay').innerHTML = '';
  document.getElementById('tet-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  clearInterval(tetris.timer);
  tetris.timer = setInterval(tetrisDrop, tetris.dropInterval);
  drawTetris();
}
function tetrisCollide(shape, x, y) {
  for (let r = 0; r < shape.length; r++) for (let c = 0; c < shape[r].length; c++) {
    if (!shape[r][c]) continue;
    const gx = x + c, gy = y + r;
    if (gx < 0 || gx >= TETRIS_COLS || gy >= TETRIS_ROWS) return true;
    if (gy >= 0 && tetris.grid[gy][gx]) return true;
  }
  return false;
}
function tetrisRotate(shape) {
  const rows = shape.length, cols = shape[0].length;
  return Array.from({ length: cols }, (_, c) => Array.from({ length: rows }, (_, r) => shape[rows - 1 - r][c]));
}
function tetrisDrop() {
  if (!tetris || !tetris.active || tetris.paused) return;
  const p = tetris.current;
  if (!tetrisCollide(p.shape, p.x, p.y + 1)) p.y++;
  else return tetrisLock();
  drawTetris();
}
function tetrisLock() {
  const p = tetris.current;
  p.shape.forEach((row, r) => row.forEach((v, c) => {
    if (!v) return;
    const gy = p.y + r, gx = p.x + c;
    if (gy < 0) return;
    tetris.grid[gy][gx] = p.color;
  }));
  const cleared = [];
  for (let r = 0; r < TETRIS_ROWS; r++) if (tetris.grid[r].every(c => c)) cleared.push(r);
  if (cleared.length) {
    tetrisClearAnim(cleared, () => {
      cleared.forEach(r => { tetris.grid.splice(r, 1); tetris.grid.unshift(Array(TETRIS_COLS).fill(null)); });
      tetris.lines += cleared.length;
      tetris.score += [0, 100, 300, 500, 800][cleared.length] * tetris.level;
      const newLevel = Math.floor(tetris.lines / 10) + 1;
      if (newLevel !== tetris.level) {
        tetris.level = newLevel;
        tetris.dropInterval = Math.max(120, 800 - (tetris.level - 1) * 70);
        clearInterval(tetris.timer);
        tetris.timer = setInterval(tetrisDrop, tetris.dropInterval);
      }
      document.getElementById('tet-score').textContent = tetris.score;
      document.getElementById('tet-lines').textContent = tetris.lines;
      document.getElementById('tet-level').textContent = tetris.level;
      spawnNextTetris();
    });
  } else {
    spawnNextTetris();
  }
}
function spawnNextTetris() {
  tetris.current = tetris.next;
  tetris.next = newTetrisPiece();
  if (tetrisCollide(tetris.current.shape, tetris.current.x, tetris.current.y)) return tetrisGameOver();
  drawTetris();
}
function tetrisClearAnim(rows, cb) {
  const canvas = document.getElementById('tet-canvas');
  const ctx = canvas.getContext('2d');
  let flashes = 0;
  const flash = setInterval(() => {
    flashes++;
    rows.forEach(r => {
      ctx.fillStyle = flashes % 2 ? '#fff' : '#0a0a12';
      ctx.fillRect(0, r * TETRIS_CELL, canvas.width, TETRIS_CELL);
    });
    if (flashes >= 4) { clearInterval(flash); cb(); }
  }, 60);
}
function tetrisGhostY(p) {
  let gy = p.y;
  while (!tetrisCollide(p.shape, p.x, gy + 1)) gy++;
  return gy;
}
function drawTetris() {
  const canvas = document.getElementById('tet-canvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  for (let c = 0; c <= TETRIS_COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TETRIS_CELL, 0); ctx.lineTo(c * TETRIS_CELL, canvas.height); ctx.stroke(); }
  for (let r = 0; r <= TETRIS_ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TETRIS_CELL); ctx.lineTo(canvas.width, r * TETRIS_CELL); ctx.stroke(); }
  tetris.grid.forEach((row, r) => row.forEach((color, c) => {
    if (color) { ctx.fillStyle = color; ctx.fillRect(c * TETRIS_CELL + 1, r * TETRIS_CELL + 1, TETRIS_CELL - 2, TETRIS_CELL - 2); }
  }));
  const p = tetris.current;
  const gy = tetrisGhostY(p);
  ctx.globalAlpha = 0.22;
  p.shape.forEach((row, r) => row.forEach((v, c) => { if (v) { ctx.fillStyle = p.color; ctx.fillRect((p.x + c) * TETRIS_CELL + 1, (gy + r) * TETRIS_CELL + 1, TETRIS_CELL - 2, TETRIS_CELL - 2); } }));
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 8; ctx.shadowColor = p.color;
  p.shape.forEach((row, r) => row.forEach((v, c) => { if (v) { ctx.fillStyle = p.color; ctx.fillRect((p.x + c) * TETRIS_CELL + 1, (p.y + r) * TETRIS_CELL + 1, TETRIS_CELL - 2, TETRIS_CELL - 2); } }));
  ctx.shadowBlur = 0;
  drawTetrisNext();
}
function drawTetrisNext() {
  const canvas = document.getElementById('tet-next-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const n = tetris.next, cell = 20;
  const offX = (canvas.width - n.shape[0].length * cell) / 2;
  const offY = (canvas.height - n.shape.length * cell) / 2;
  ctx.fillStyle = n.color;
  n.shape.forEach((row, r) => row.forEach((v, c) => { if (v) ctx.fillRect(offX + c * cell + 1, offY + r * cell + 1, cell - 2, cell - 2); }));
}
function tetrisGameOver() {
  clearInterval(tetris.timer);
  tetris.active = false;
  const hs = getHS('tetris');
  if (tetris.score > hs) { setHS('tetris', tetris.score); App.showToast('🏆 New high score!', 'info'); }
  refreshAllHighScores();
  document.getElementById('tet-overlay').innerHTML = `<div class="stage-gameover">💥 Game Over<br><span>Score: ${tetris.score}</span></div>`;
  document.getElementById('tet-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}
function tetrisMove(dx) {
  if (!tetris || !tetris.active) return;
  const p = tetris.current;
  if (!tetrisCollide(p.shape, p.x + dx, p.y)) { p.x += dx; drawTetris(); }
}
function tetrisRotatePiece() {
  if (!tetris || !tetris.active) return;
  const p = tetris.current;
  const rotated = tetrisRotate(p.shape);
  if (!tetrisCollide(rotated, p.x, p.y)) p.shape = rotated;
  else if (!tetrisCollide(rotated, p.x - 1, p.y)) { p.shape = rotated; p.x -= 1; }
  else if (!tetrisCollide(rotated, p.x + 1, p.y)) { p.shape = rotated; p.x += 1; }
  else return;
  drawTetris();
}
function tetrisHardDrop() {
  if (!tetris || !tetris.active) return;
  const p = tetris.current;
  p.y = tetrisGhostY(p);
  tetrisLock();
  drawTetris();
}

// ════════════════════════════════════════════════════════════
//  GAME 3 — MEMORY MATCH
// ════════════════════════════════════════════════════════════
const MEMORY_EMOJI = ['🍥', '🗡️', '👹', '⛩️', '🐉', '🔥', '🌸', '🎌'];
let memory = null;

function startMemory() { payEntry('Memory Match').then(ok => { if (ok) initMemory(); }); }
function initMemory() {
  let cards = [...MEMORY_EMOJI, ...MEMORY_EMOJI].map((emoji, i) => ({ id: i, emoji, flipped: false, matched: false }));
  cards = shuffleArr(cards);
  memory = { cards, first: null, second: null, busy: false, moves: 0, matches: 0, combo: 1, startTime: Date.now(), lastMatchTime: Date.now(), active: true };
  document.getElementById('mem-moves').textContent = '0';
  document.getElementById('mem-combo').textContent = '×1';
  document.getElementById('mem-time').textContent = '0s';
  document.getElementById('mem-overlay').innerHTML = '';
  document.getElementById('mem-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  clearInterval(memory.timer);
  memory.timer = setInterval(() => {
    if (memory.active) document.getElementById('mem-time').textContent = Math.floor((Date.now() - memory.startTime) / 1000) + 's';
  }, 500);
  renderMemory();
}
function renderMemory() {
  const grid = document.getElementById('mem-grid');
  grid.innerHTML = '';
  memory.cards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'mem-card' + (card.flipped || card.matched ? ' flipped' : '') + (card.matched ? ' matched' : '');
    el.innerHTML = `<div class="mem-card-inner"><div class="mem-card-front">❔</div><div class="mem-card-back">${card.emoji}</div></div>`;
    if (!card.flipped && !card.matched) el.addEventListener('click', () => memoryFlip(card.id));
    grid.appendChild(el);
  });
}
function memoryFlip(id) {
  if (!memory || !memory.active || memory.busy) return;
  const card = memory.cards.find(c => c.id === id);
  if (card.flipped || card.matched) return;
  card.flipped = true;
  if (!memory.first) { memory.first = card; renderMemory(); return; }
  memory.second = card;
  memory.moves++;
  document.getElementById('mem-moves').textContent = memory.moves;
  renderMemory();
  memory.busy = true;
  const elapsedSinceMatch = Date.now() - memory.lastMatchTime;
  setTimeout(() => {
    if (memory.first.emoji === memory.second.emoji) {
      memory.first.matched = true; memory.second.matched = true;
      memory.matches++;
      memory.combo = elapsedSinceMatch < 4000 ? Math.min(5, memory.combo + 1) : 1;
      document.getElementById('mem-combo').textContent = '×' + memory.combo;
      memory.lastMatchTime = Date.now();
      App.showToast(memory.combo > 1 ? `🔥 Combo ×${memory.combo}!` : 'Match!', 'info');
      if (memory.matches === memory.cards.length / 2) memoryWin();
    } else {
      memory.first.flipped = false; memory.second.flipped = false;
      memory.combo = 1;
      document.getElementById('mem-combo').textContent = '×1';
    }
    memory.first = null; memory.second = null; memory.busy = false;
    renderMemory();
  }, 700);
}
function memoryWin() {
  memory.active = false;
  clearInterval(memory.timer);
  const time = Math.floor((Date.now() - memory.startTime) / 1000);
  const hs = getHS('memory_moves', 0);
  if (hs === 0 || memory.moves < hs) { setHS('memory_moves', memory.moves); App.showToast('🏆 New best moves!', 'info'); }
  refreshAllHighScores();
  document.getElementById('mem-overlay').innerHTML = `<div class="stage-gameover">🎉 Cleared!<br><span>${memory.moves} moves · ${time}s</span></div>`;
  document.getElementById('mem-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}

// ════════════════════════════════════════════════════════════
//  GAME 4 — TYPING RACE
// ════════════════════════════════════════════════════════════
const TYPING_SENTENCES = [
  "The rubber pirate sails toward his dream with an unbreakable crew.",
  "A silver haired assassin trains under the shadow of the mountain.",
  "Ancient scrolls speak of a demon slayer who breathes like thunder.",
  "The academy hero rises early to save everyone with a smile.",
  "Ninjas hide in the leaves while shadows whisper old village secrets.",
  "A lone swordsman wanders searching for strength beyond the horizon.",
  "The alchemist brothers seek a stone to restore what they lost.",
  "Titans breach the walls as soldiers scramble to defend humanity.",
  "A detective in the shadows solves cases no one else can crack.",
  "Dragons circle the sky above a kingdom built on old magic.",
];
let typing = null;

function startTyping() { payEntry('Typing Race').then(ok => { if (ok) initTyping(); }); }
function initTyping() {
  const sentence = TYPING_SENTENCES[Math.floor(Math.random() * TYPING_SENTENCES.length)];
  typing = { sentence, typed: '', startTime: null, active: true, errors: 0 };
  document.getElementById('typ-wpm').textContent = '0';
  document.getElementById('typ-acc').textContent = '100%';
  document.getElementById('typ-overlay').innerHTML = '';
  document.getElementById('typ-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  const input = document.getElementById('typ-input');
  input.value = ''; input.disabled = false; input.focus();
  renderTypingText();
  renderKeyboardHighlight(sentence[0]);
}
function renderTypingText() {
  const el = document.getElementById('typ-text');
  const { sentence, typed } = typing;
  el.innerHTML = sentence.split('').map((ch, i) => {
    let cls = 'typ-pending';
    if (i < typed.length) cls = typed[i] === ch ? 'typ-correct' : 'typ-wrong';
    else if (i === typed.length) cls = 'typ-cursor';
    return `<span class="${cls}">${ch === ' ' ? '&nbsp;' : ch}</span>`;
  }).join('');
}
function typingInputHandler(e) {
  if (!typing || !typing.active) return;
  if (!typing.startTime) typing.startTime = Date.now();
  const val = e.target.value;
  typing.typed = val;
  let errors = 0;
  for (let i = 0; i < val.length; i++) if (val[i] !== typing.sentence[i]) errors++;
  typing.errors = errors;
  const acc = val.length ? Math.round(((val.length - errors) / val.length) * 100) : 100;
  document.getElementById('typ-acc').textContent = acc + '%';
  const mins = (Date.now() - typing.startTime) / 60000;
  const wpm = mins > 0 ? Math.round((val.length / 5) / mins) : 0;
  document.getElementById('typ-wpm').textContent = wpm;
  renderTypingText();
  renderKeyboardHighlight(typing.sentence[val.length] || '');
  if (val === typing.sentence) finishTyping();
}
function finishTyping() {
  typing.active = false;
  document.getElementById('typ-input').disabled = true;
  const mins = (Date.now() - typing.startTime) / 60000;
  const wpm = Math.round((typing.sentence.length / 5) / Math.max(mins, 0.01));
  const acc = Math.round(((typing.sentence.length - typing.errors) / typing.sentence.length) * 100);
  const hs = getHS('typing_wpm');
  if (wpm > hs) { setHS('typing_wpm', wpm); App.showToast('🏆 New best WPM!', 'info'); }
  refreshAllHighScores();
  document.getElementById('typ-overlay').innerHTML = `<div class="stage-gameover">✅ Done!<br><span>${wpm} WPM · ${acc}% accuracy</span></div>`;
  document.getElementById('typ-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}
const KB_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
function renderKeyboardHighlight(nextChar) {
  const kb = document.getElementById('typ-keyboard');
  if (!kb) return;
  const upper = (nextChar || '').toUpperCase();
  kb.querySelectorAll('.kb-key').forEach(k => {
    k.classList.toggle('kb-active', k.dataset.key === upper && nextChar !== '');
  });
}
function buildKeyboard() {
  const kb = document.getElementById('typ-keyboard');
  if (!kb) return;
  kb.innerHTML = KB_ROWS.map(row => `<div class="kb-row">${row.split('').map(k => `<div class="kb-key" data-key="${k}">${k}</div>`).join('')}</div>`).join('');
}

// ════════════════════════════════════════════════════════════
//  GAME 5 — REACTION BLITZ
// ════════════════════════════════════════════════════════════
let reaction = null;

function startReaction() { payEntry('Reaction Blitz').then(ok => { if (ok) initReaction(); }); }
function initReaction() {
  reaction = { streak: 0, active: true, windowMs: 1400, round: 0 };
  document.getElementById('rx-streak').textContent = '0';
  document.getElementById('rx-overlay').innerHTML = '';
  document.getElementById('rx-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  document.getElementById('rx-arena').innerHTML = '<div class="rx-msg">Get ready…</div>';
  setTimeout(reactionSpawn, 900);
}
function reactionSpawn() {
  if (!reaction || !reaction.active) return;
  const arena = document.getElementById('rx-arena');
  arena.innerHTML = '';
  const size = Math.max(34, 70 - reaction.round * 1.5);
  const target = document.createElement('div');
  target.className = 'rx-target';
  target.style.width = target.style.height = size + 'px';
  const maxX = Math.max(0, arena.clientWidth - size), maxY = Math.max(0, arena.clientHeight - size);
  target.style.left = (Math.random() * maxX) + 'px';
  target.style.top = (Math.random() * maxY) + 'px';
  arena.appendChild(target);
  let hit = false;
  target.addEventListener('click', () => {
    hit = true;
    reaction.streak++; reaction.round++;
    document.getElementById('rx-streak').textContent = reaction.streak;
    reaction.windowMs = Math.max(500, reaction.windowMs - 25);
    target.classList.add('rx-hit');
    setTimeout(reactionSpawn, 180);
  });
  setTimeout(() => { if (!hit && reaction.active) reactionMiss(); }, reaction.windowMs);
}
function reactionMiss() {
  reaction.active = false;
  document.getElementById('rx-arena').innerHTML = '<div class="rx-msg">💨 Missed!</div>';
  const hs = getHS('reaction_streak');
  if (reaction.streak > hs) { setHS('reaction_streak', reaction.streak); App.showToast('🏆 New best streak!', 'info'); }
  refreshAllHighScores();
  document.getElementById('rx-overlay').innerHTML = `<div class="stage-gameover">Streak ended<br><span>${reaction.streak} hits</span></div>`;
  document.getElementById('rx-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}

// ════════════════════════════════════════════════════════════
//  GAME 6 — BRICK BREAKER
// ════════════════════════════════════════════════════════════
let breaker = null;
const BRICK_W = 44, BRICK_H = 16, BRICK_PAD = 4, BRICK_TOP = 30, BRICK_LEFT = 8;

function startBreaker() { payEntry('Brick Breaker').then(ok => { if (ok) initBreaker(); }); }
function buildBricks(level) {
  const rows = Math.min(3 + level, 7), cols = 8;
  const bricks = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const power = Math.random() < 0.12 ? ['multi', 'wide', 'laser'][Math.floor(Math.random() * 3)] : null;
    bricks.push({ r, c, alive: true, power, hp: r < 2 ? 1 : (Math.random() < 0.3 ? 2 : 1) });
  }
  return bricks;
}
function initBreaker() {
  const canvas = document.getElementById('brk-canvas');
  breaker = {
    canvas, ctx: canvas.getContext('2d'),
    paddle: { x: canvas.width / 2 - 40, w: 80, y: canvas.height - 20 },
    balls: [{ x: canvas.width / 2, y: canvas.height - 40, vx: 3, vy: -3, r: 6 }],
    bricks: buildBricks(1), level: 1, score: 0, lives: 3, active: true, powerups: [], lasers: [], laserActive: false,
  };
  document.getElementById('brk-score').textContent = '0';
  document.getElementById('brk-lives').textContent = '3';
  document.getElementById('brk-level').textContent = '1';
  document.getElementById('brk-overlay').innerHTML = '';
  document.getElementById('brk-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  cancelAnimationFrame(breaker.raf);
  setupBreakerControls();
  breakerLoop();
}
function breakerLoop() {
  if (!breaker || !breaker.active) return;
  breakerUpdate();
  breakerDraw();
  breaker.raf = requestAnimationFrame(breakerLoop);
}
function breakerUpdate() {
  const b = breaker;
  b.balls.forEach(ball => {
    ball.x += ball.vx; ball.y += ball.vy;
    if (ball.x < ball.r || ball.x > b.canvas.width - ball.r) ball.vx *= -1;
    if (ball.y < ball.r) ball.vy *= -1;
    if (ball.y + ball.r >= b.paddle.y && ball.y + ball.r <= b.paddle.y + 12 &&
        ball.x >= b.paddle.x && ball.x <= b.paddle.x + b.paddle.w && ball.vy > 0) {
      const hitPos = (ball.x - b.paddle.x) / b.paddle.w - 0.5;
      ball.vx = hitPos * 6; ball.vy = -Math.abs(ball.vy);
    }
    b.bricks.forEach(brick => {
      if (!brick.alive) return;
      const bx = BRICK_LEFT + brick.c * (BRICK_W + BRICK_PAD), by = BRICK_TOP + brick.r * (BRICK_H + BRICK_PAD);
      if (ball.x + ball.r > bx && ball.x - ball.r < bx + BRICK_W && ball.y + ball.r > by && ball.y - ball.r < by + BRICK_H) {
        brick.hp--;
        if (brick.hp <= 0) {
          brick.alive = false; b.score += 10;
          if (brick.power) b.powerups.push({ x: bx + BRICK_W / 2, y: by, type: brick.power });
        }
        ball.vy *= -1;
      }
    });
  });
  b.balls = b.balls.filter(ball => ball.y < b.canvas.height + 20);
  if (b.balls.length === 0) {
    b.lives--;
    document.getElementById('brk-lives').textContent = b.lives;
    if (b.lives <= 0) return breakerGameOver();
    b.balls = [{ x: b.canvas.width / 2, y: b.canvas.height - 40, vx: 3, vy: -3, r: 6 }];
    b.paddle.w = 80; b.laserActive = false;
  }
  b.powerups.forEach(p => p.y += 2.5);
  b.powerups = b.powerups.filter(p => {
    if (p.y > b.paddle.y && p.y < b.paddle.y + 12 && p.x > b.paddle.x && p.x < b.paddle.x + b.paddle.w) {
      applyPowerup(p.type); return false;
    }
    return p.y < b.canvas.height;
  });
  if (b.laserActive) {
    b.lasers.forEach(l => l.y -= 6);
    b.lasers = b.lasers.filter(l => l.y > 0);
    b.bricks.forEach(brick => {
      if (!brick.alive) return;
      const bx = BRICK_LEFT + brick.c * (BRICK_W + BRICK_PAD), by = BRICK_TOP + brick.r * (BRICK_H + BRICK_PAD);
      b.lasers.forEach(l => {
        if (l.x > bx && l.x < bx + BRICK_W && l.y > by && l.y < by + BRICK_H) {
          brick.hp = 0; brick.alive = false; b.score += 10; l.y = -100;
        }
      });
    });
  }
  document.getElementById('brk-score').textContent = b.score;
  if (b.bricks.every(br => !br.alive)) breakerNextLevel();
}
function applyPowerup(type) {
  const b = breaker;
  if (type === 'multi') {
    const extra = b.balls.slice(0, 2).map(ball => ({ ...ball, vx: ball.vx + (Math.random() - 0.5) * 3 }));
    b.balls.push(...extra);
    App.showToast('⚡ Multi-Ball!', 'info');
  } else if (type === 'wide') {
    b.paddle.w = Math.min(150, b.paddle.w + 30);
    App.showToast('📏 Wide Paddle!', 'info');
  } else if (type === 'laser') {
    b.laserActive = true;
    App.showToast('🔫 Laser Ready!', 'info');
    clearInterval(b.laserTimer);
    b.laserTimer = setInterval(() => {
      if (b.laserActive) b.lasers.push({ x: b.paddle.x + 10, y: b.paddle.y }, { x: b.paddle.x + b.paddle.w - 10, y: b.paddle.y });
    }, 400);
  }
}
function breakerNextLevel() {
  breaker.level++;
  document.getElementById('brk-level').textContent = breaker.level;
  breaker.bricks = buildBricks(breaker.level);
  breaker.balls = [{ x: breaker.canvas.width / 2, y: breaker.canvas.height - 40, vx: 3 + breaker.level * 0.3, vy: -3 - breaker.level * 0.3, r: 6 }];
  App.showToast(`🚀 Level ${breaker.level}!`, 'info');
}
function breakerDraw() {
  const { ctx, canvas } = breaker;
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  breaker.bricks.forEach(brick => {
    if (!brick.alive) return;
    const bx = BRICK_LEFT + brick.c * (BRICK_W + BRICK_PAD), by = BRICK_TOP + brick.r * (BRICK_H + BRICK_PAD);
    ctx.fillStyle = brick.power ? '#f5c518' : (brick.hp > 1 ? '#7F77DD' : '#7C5DFA');
    ctx.fillRect(bx, by, BRICK_W, BRICK_H);
  });
  ctx.fillStyle = '#a78bfa';
  ctx.fillRect(breaker.paddle.x, breaker.paddle.y, breaker.paddle.w, 10);
  ctx.fillStyle = '#fff';
  breaker.balls.forEach(ball => { ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = '#22d3ee';
  breaker.powerups.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = '#ef4444';
  breaker.lasers.forEach(l => ctx.fillRect(l.x - 1, l.y - 8, 2, 8));
}
function setupBreakerControls() {
  const canvas = breaker.canvas;
  const move = clientX => {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    breaker.paddle.x = Math.max(0, Math.min(canvas.width - breaker.paddle.w, x - breaker.paddle.w / 2));
  };
  canvas.onmousemove = e => { if (breaker.active) move(e.clientX); };
  canvas.ontouchmove = e => { if (breaker.active) { move(e.touches[0].clientX); e.preventDefault(); } };
}
function breakerGameOver() {
  breaker.active = false;
  cancelAnimationFrame(breaker.raf);
  clearInterval(breaker.laserTimer);
  const hs = getHS('breaker');
  if (breaker.score > hs) { setHS('breaker', breaker.score); App.showToast('🏆 New high score!', 'info'); }
  refreshAllHighScores();
  document.getElementById('brk-overlay').innerHTML = `<div class="stage-gameover">💥 Game Over<br><span>Score: ${breaker.score}</span></div>`;
  document.getElementById('brk-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}

// ════════════════════════════════════════════════════════════
//  GAME 7 — TRIVIA QUIZ
// ════════════════════════════════════════════════════════════
const TRIVIA_BANK = [
  { q: "Which pirate captain wears a straw hat?", opts: ["Luffy", "Zoro", "Sanji", "Ace"], a: 0 },
  { q: "In Naruto, what village is Kakashi from?", opts: ["Suna", "Kiri", "Konoha", "Iwa"], a: 2 },
  { q: "What is the capital of Japan?", opts: ["Osaka", "Kyoto", "Tokyo", "Nagoya"], a: 2 },
  { q: "How many Dragon Balls are needed to summon Shenron?", opts: ["5", "6", "7", "9"], a: 2 },
  { q: "What organ pumps blood through the human body?", opts: ["Lungs", "Heart", "Liver", "Kidney"], a: 1 },
  { q: "In One Punch Man, what is Saitama's hero rank?", opts: ["S-Class", "A-Class", "B-Class", "C-Class"], a: 0 },
  { q: "Which planet is known as the Red Planet?", opts: ["Venus", "Mars", "Jupiter", "Saturn"], a: 1 },
  { q: "What breathing style does Tanjiro primarily use?", opts: ["Sound", "Water", "Flame", "Insect"], a: 1 },
  { q: "What is the largest ocean on Earth?", opts: ["Atlantic", "Indian", "Arctic", "Pacific"], a: 3 },
  { q: "Who is known as the Copy Ninja?", opts: ["Itachi", "Kakashi", "Obito", "Jiraiya"], a: 1 },
  { q: "How many hearts does an octopus have?", opts: ["1", "2", "3", "4"], a: 2 },
  { q: "In Death Note, what is Light Yagami's alias?", opts: ["L", "Kira", "Near", "Mello"], a: 1 },
  { q: "What is the chemical symbol for gold?", opts: ["Go", "Gd", "Au", "Ag"], a: 2 },
  { q: "Which anime features the Elric brothers?", opts: ["Bleach", "Fullmetal Alchemist", "Naruto", "Fairy Tail"], a: 1 },
  { q: "Which Sin is Meliodas in Seven Deadly Sins?", opts: ["Pride", "Wrath", "Sloth", "Envy"], a: 2 },
];
let trivia = null;

function startTrivia() { payEntry('Trivia Quiz').then(ok => { if (ok) initTrivia(); }); }
function initTrivia() {
  trivia = { pool: shuffleArr(TRIVIA_BANK).slice(0, 10), idx: 0, score: 0, streak: 0, active: true, timer: null };
  document.getElementById('triv-score').textContent = '0';
  document.getElementById('triv-streak').textContent = '0';
  document.getElementById('triv-overlay').innerHTML = '';
  document.getElementById('triv-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  triviaShowQuestion();
}
function triviaShowQuestion() {
  if (trivia.idx >= trivia.pool.length) return triviaFinish();
  const q = trivia.pool[trivia.idx];
  document.getElementById('triv-qnum').textContent = `Q${trivia.idx + 1}/${trivia.pool.length}`;
  document.getElementById('triv-question').textContent = q.q;
  document.getElementById('triv-opts').innerHTML = q.opts.map((o, i) => `<button class="triv-opt-btn" onclick="triviaAnswer(${i})">${o}</button>`).join('');
  const bar = document.getElementById('triv-timerbar');
  bar.style.transition = 'none'; bar.style.width = '100%';
  requestAnimationFrame(() => { bar.style.transition = 'width 15s linear'; bar.style.width = '0%'; });
  clearTimeout(trivia.timer);
  trivia.timer = setTimeout(() => triviaAnswer(-1), 15000);
}
function triviaAnswer(choice) {
  if (!trivia || !trivia.active) return;
  clearTimeout(trivia.timer);
  const q = trivia.pool[trivia.idx];
  const correct = choice === q.a;
  document.querySelectorAll('.triv-opt-btn').forEach((btn, i) => {
    btn.disabled = true;
    if (i === q.a) btn.classList.add('triv-correct');
    else if (i === choice) btn.classList.add('triv-wrong');
  });
  if (correct) {
    trivia.streak++;
    const bonus = 10 + Math.min(trivia.streak, 5) * 5;
    trivia.score += bonus;
    App.showToast(trivia.streak > 1 ? `🔥 Streak ×${trivia.streak}! +${bonus}` : `✅ Correct! +${bonus}`, 'info');
  } else {
    trivia.streak = 0;
  }
  document.getElementById('triv-score').textContent = trivia.score;
  document.getElementById('triv-streak').textContent = trivia.streak;
  trivia.idx++;
  setTimeout(triviaShowQuestion, 1100);
}
function triviaFinish() {
  trivia.active = false;
  const hs = getHS('trivia');
  if (trivia.score > hs) { setHS('trivia', trivia.score); App.showToast('🏆 New high score!', 'info'); }
  refreshAllHighScores();
  document.getElementById('triv-question').textContent = '';
  document.getElementById('triv-opts').innerHTML = '';
  document.getElementById('triv-timerbar').style.width = '0%';
  document.getElementById('triv-overlay').innerHTML = `<div class="stage-gameover">🎓 Quiz Complete!<br><span>Score: ${trivia.score}</span></div>`;
  document.getElementById('triv-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}

// ════════════════════════════════════════════════════════════
//  GAME 8 — SLIDING PUZZLE
// ════════════════════════════════════════════════════════════
let slider = null;
let sliderPendingSize = 3;

function setSliderSize(n) {
  sliderPendingSize = n;
  document.querySelectorAll('.slider-size-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('slider-size-' + n).classList.add('active');
  document.getElementById('slider-overlay').innerHTML = '';
  document.getElementById('slider-moves').textContent = '0';
  refreshAllHighScores();
  const grid = document.getElementById('slider-grid');
  grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  grid.innerHTML = `<div class="slider-locked">Hit Play to shuffle a ${n}×${n} board</div>`;
}
function startSlider() { payEntry('Sliding Puzzle').then(ok => { if (ok) initSlider(); }); }
function initSlider() {
  const n = sliderPendingSize;
  let tiles = Array.from({ length: n * n - 1 }, (_, i) => i + 1);
  tiles.push(null);
  do { tiles = shuffleArr(tiles); } while (!isSolvable(tiles, n) || isSolved(tiles));
  slider = { n, tiles, moves: 0, active: true };
  document.getElementById('slider-moves').textContent = '0';
  document.getElementById('slider-overlay').innerHTML = '';
  document.getElementById('slider-start-btn').textContent = `Restart — ${ENTRY_FEE} ◈`;
  renderSlider();
}
function isSolved(tiles) {
  for (let i = 0; i < tiles.length - 1; i++) if (tiles[i] !== i + 1) return false;
  return true;
}
function isSolvable(tiles, n) {
  const arr = tiles.filter(t => t !== null);
  let inv = 0;
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (arr[i] > arr[j]) inv++;
  if (n % 2 === 1) return inv % 2 === 0;
  const blankRow = Math.floor(tiles.indexOf(null) / n);
  return (inv + blankRow) % 2 === 1;
}
function renderSlider() {
  const grid = document.getElementById('slider-grid');
  grid.style.gridTemplateColumns = `repeat(${slider.n}, 1fr)`;
  grid.innerHTML = '';
  slider.tiles.forEach((val, i) => {
    const el = document.createElement('div');
    el.className = 'slider-tile' + (val === null ? ' empty' : '');
    if (val !== null) { el.textContent = val; el.addEventListener('click', () => sliderMove(i)); }
    grid.appendChild(el);
  });
}
function sliderMove(i) {
  if (!slider || !slider.active) return;
  const n = slider.n, blank = slider.tiles.indexOf(null);
  const ri = Math.floor(i / n), ci = i % n, rb = Math.floor(blank / n), cb = blank % n;
  if ((ri === rb && Math.abs(ci - cb) === 1) || (ci === cb && Math.abs(ri - rb) === 1)) {
    [slider.tiles[i], slider.tiles[blank]] = [slider.tiles[blank], slider.tiles[i]];
    slider.moves++;
    document.getElementById('slider-moves').textContent = slider.moves;
    renderSlider();
    if (isSolved(slider.tiles)) sliderWin();
  }
}
function sliderWin() {
  slider.active = false;
  const key = 'slider_' + slider.n;
  const hs = getHS(key, 0);
  if (hs === 0 || slider.moves < hs) { setHS(key, slider.moves); App.showToast('🏆 New best!', 'info'); }
  refreshAllHighScores();
  document.getElementById('slider-overlay').innerHTML = `<div class="stage-gameover">🧩 Solved!<br><span>${slider.moves} moves</span></div>`;
  document.getElementById('slider-start-btn').textContent = `Play Again — ${ENTRY_FEE} ◈`;
}

// ════════════════════════════════════════════════════════════
//  GLOBAL INPUT — keyboard controls shared across games
// ════════════════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (snake && snake.active) {
    if (e.key === 'ArrowUp' || e.key === 'w') snakeSetDir(0, -1);
    else if (e.key === 'ArrowDown' || e.key === 's') snakeSetDir(0, 1);
    else if (e.key === 'ArrowLeft' || e.key === 'a') snakeSetDir(-1, 0);
    else if (e.key === 'ArrowRight' || e.key === 'd') snakeSetDir(1, 0);
  }
  if (tetris && tetris.active) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowLeft') tetrisMove(-1);
    else if (e.key === 'ArrowRight') tetrisMove(1);
    else if (e.key === 'ArrowDown') tetrisDrop();
    else if (e.key === 'ArrowUp') tetrisRotatePiece();
    else if (e.key === ' ') tetrisHardDrop();
  }
  if (breaker && breaker.active) {
    if (e.key === 'ArrowLeft') breaker.paddle.x = Math.max(0, breaker.paddle.x - 25);
    if (e.key === 'ArrowRight') breaker.paddle.x = Math.min(breaker.canvas.width - breaker.paddle.w, breaker.paddle.x + 25);
  }
});

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  renderSidebar('games');
  refreshAllHighScores();
  buildKeyboard();

  const sessionPhone = sessionStorage.getItem('agi_member_phone');
  if (sessionPhone) {
    const raw = await API.getUserByPhone(sessionPhone);
    const user = App.parseUser(raw?.[0]);
    if (user) {
      currentPlayer = user;
      refreshHUD();
      const loadSection = document.getElementById('hud-load-section');
      if (loadSection) loadSection.style.display = 'none';
      App.showToast(`Welcome back, ${user.name}! 🕹️`, 'info');
    }
  }
  const savedPhone = sessionStorage.getItem('agi_member_phone');
  if (savedPhone) {
    const phoneInput = document.getElementById('hud-phone');
    if (phoneInput) phoneInput.value = savedPhone;
  }

  document.getElementById('hud-load-btn').addEventListener('click', loadPlayer);
  document.getElementById('hud-phone').addEventListener('keydown', e => { if (e.key === 'Enter') loadPlayer(); });

  // Snake grid init
  const snakeCanvas = document.getElementById('snake-canvas');
  snakeCanvas.width = SNAKE_COLS * SNAKE_CELL;
  snakeCanvas.height = SNAKE_ROWS * SNAKE_CELL;
  const sctx = snakeCanvas.getContext('2d');
  sctx.fillStyle = '#0a0a12'; sctx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);
  let touchSX = 0, touchSY = 0;
  snakeCanvas.addEventListener('touchstart', e => { touchSX = e.touches[0].clientX; touchSY = e.touches[0].clientY; });
  snakeCanvas.addEventListener('touchend', e => {
    if (!snake || !snake.active) return;
    const dx = e.changedTouches[0].clientX - touchSX, dy = e.changedTouches[0].clientY - touchSY;
    if (Math.abs(dx) > Math.abs(dy)) { if (dx > 20) snakeSetDir(1, 0); else if (dx < -20) snakeSetDir(-1, 0); }
    else { if (dy > 20) snakeSetDir(0, 1); else if (dy < -20) snakeSetDir(0, -1); }
  });

  // Tetris grid init
  const tetCanvas = document.getElementById('tet-canvas');
  tetCanvas.width = TETRIS_COLS * TETRIS_CELL;
  tetCanvas.height = TETRIS_ROWS * TETRIS_CELL;
  const tctx = tetCanvas.getContext('2d');
  tctx.fillStyle = '#0a0a12'; tctx.fillRect(0, 0, tetCanvas.width, tetCanvas.height);

  // Typing input
  document.getElementById('typ-input').addEventListener('input', typingInputHandler);

  // Slider default board preview
  setSliderSize(3);
});
