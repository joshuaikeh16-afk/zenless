// ── Zoo (pet care) ──────────────────────────────────────────────────
// Mirrors the WhatsApp bot's pet.js command logic so stats, cooldowns,
// and leveling behave identically whether a player uses .pet feed on
// WhatsApp or the Feed button here. Every action ends with a PATCH back
// to the bot economy via PetApi — the bot store is the source of truth.
//
// This build adds three purely-client "delight" layers on top of that
// contract, none of which touch the synced economy fields:
//   1. Action feedback  — bounce, particle bursts, rotating flavor text
//   2. Care streak       — daily-interaction streak + care score (localStorage)
//   3. Mood + rarity flair — mood badge derived from live stats, rarity aura

const PET_COOLDOWNS = {
  feed:  5 * 60 * 1000,
  train: 3 * 60 * 1000,
  play:  2 * 60 * 1000,
  clean: 10 * 60 * 1000,
};

const ITEM_NAMES = {
  pet_food: '🍗 Pet Food',
  pet_toy:  '🎾 Pet Toy',
};

// ── Flavor text pools ─────────────────────────────────────────────
// One random line per action so repeat care doesn't feel robotic.
const FLAVOR_TEXT = {
  feed: [
    '{name} scarfs it down in record time.',
    '{name} does a happy little food dance.',
    'Nom nom nom — {name} approves.',
    '{name} licks the bowl clean.',
  ],
  train: [
    '{name} pushes through one more rep!',
    '{name} is getting sharper by the minute.',
    '{name} nails the drill on the first try.',
    'Sweat, focus, growth — {name} is leveling up.',
  ],
  play: [
    '{name} chases the toy in gleeful circles.',
    '{name} pounces — victory!',
    '{name} is having the time of its life.',
    '{name} wants to go again already.',
  ],
  clean: [
    '{name} is squeaky clean now.',
    'Splash! {name} shakes off the water.',
    '{name} smells like fresh linen.',
    'Sparkling. {name} looks brand new.',
  ],
};

// Particle sets per action — kept small and legible at 18px.
const ACTION_PARTICLES = {
  feed:  ['🍗', '✨'],
  train: ['💪', '⭐'],
  play:  ['🎾', '💫'],
  clean: ['🫧', '✨'],
};

const LEVEL_UP_PARTICLES = ['🎉', '⭐', '✨', '🎊'];

const RARITY_CLASS = {
  common:    '',
  uncommon:  'rarity-uncommon',
  rare:      'rarity-rare',
  epic:      'rarity-epic',
  legendary: 'rarity-legendary',
};

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

let petUser     = null; // full bot economy object: { primos, bank, pets, activePetIndex, inventory, ... }
let activeIndex = 0;
let currentLid  = null;

document.addEventListener('DOMContentLoaded', async () => {
  renderSidebar('zoo');

  const user = App.getCurrentUser ? App.getCurrentUser() : null;
  if (!user || !user.lid) {
    showZooError("Couldn't find your account — please log in again.");
    return;
  }
  currentLid = user.lid;
  await loadZoo();
});

async function loadZoo() {
  const root = document.getElementById('zoo-root');
  root.style.display = 'none';
  document.getElementById('zoo-loading').style.display = '';

  const data = await PetApi.getPetEconomy(currentLid);
  document.getElementById('zoo-loading').style.display = 'none';

  if (!data) {
    showZooError('Failed to reach the pet server. Try again in a moment.');
    return;
  }

  // Same migration layer as the bot, in case this user hasn't touched
  // pets through the bot since the old single-pet format.
  if (data.pet && !data.pets) {
    data.pets = [data.pet];
    data.activePetIndex = 0;
    delete data.pet;
  }

  petUser = data;
  activeIndex = petUser.activePetIndex ?? 0;

  if (!petUser.pets || !petUser.pets.length) {
    showZooEmpty();
    return;
  }
  if (activeIndex >= petUser.pets.length || activeIndex < 0) activeIndex = 0;

  petUser.pets.forEach(updatePetStatsClient);
  root.style.display = '';
  renderZoo();
}

// ── Client-side mirror of updatePetStats() from the bot ──────────────
function updatePetStatsClient(pet) {
  const now = Date.now();
  const hours = Math.floor((now - (pet.lastUpdate || pet.adoptedAt)) / (1000 * 60 * 60));
  if (hours > 0) {
    pet.hunger = Math.min(100, pet.hunger + hours * 15);
    pet.cleanliness = Math.max(0, pet.cleanliness - hours * 10);
    pet.energy = Math.min(100, (pet.energy || 100) + hours * 10);
    if (hours > 2) pet.happiness = Math.max(0, pet.happiness - hours * 5);
    if (pet.hunger >= 80) pet.hp = Math.max(1, pet.hp - hours * 5);
    pet.lastUpdate = now;
  }
  pet.hp = Math.min(pet.hp, pet.maxHp);
}

function checkCooldown(lastAction, cooldownTime) {
  if (!lastAction) return { available: true, remaining: 0 };
  const remaining = cooldownTime - (Date.now() - lastAction);
  return { available: remaining <= 0, remaining: Math.max(0, remaining) };
}

function formatTime(ms) {
  return `${Math.ceil(ms / 1000 / 60)}m`;
}

// ── Care streak (client-side, per-account, per-day) ──────────────────
// Not part of the bot economy contract — this is a local delight layer,
// so it lives in localStorage keyed by lid. A "day" counts if the user
// took at least one pet action on it; consecutive days build a streak.
function streakKey() {
  return `zoo_streak_${currentLid}`;
}

function dayString(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(streakKey());
    if (!raw) return { streak: 0, careScore: 0, lastDay: null };
    return JSON.parse(raw);
  } catch {
    return { streak: 0, careScore: 0, lastDay: null };
  }
}

function saveStreak(s) {
  try { localStorage.setItem(streakKey(), JSON.stringify(s)); } catch {}
}

// Called once per pet action. Returns { streak, careScore, milestoneHit }.
function registerCareAction() {
  const s = loadStreak();
  const today = dayString(Date.now());
  let milestoneHit = null;

  if (s.lastDay !== today) {
    const yesterday = dayString(Date.now() - 24 * 60 * 60 * 1000);
    s.streak = (s.lastDay === yesterday) ? s.streak + 1 : 1;
    s.lastDay = today;
    if (STREAK_MILESTONES.includes(s.streak)) milestoneHit = s.streak;
  }

  s.careScore = (s.careScore || 0) + 1;
  saveStreak(s);
  return { streak: s.streak, careScore: s.careScore, milestoneHit };
}

// ── Mood, derived from live stats — purely presentational ────────────
function petMood(p) {
  if (p.hp <= p.maxHp * 0.25) return { emoji: '🤒', label: 'Unwell' };
  if (p.hunger >= 75) return { emoji: '😩', label: 'Starving' };
  if ((p.energy ?? 100) <= 15) return { emoji: '😴', label: 'Exhausted' };
  if (p.cleanliness <= 25) return { emoji: '🤢', label: 'Filthy' };
  if (p.happiness >= 80) return { emoji: '🥰', label: 'Thriving' };
  if (p.happiness <= 30) return { emoji: '😢', label: 'Sad' };
  return { emoji: '🙂', label: 'Content' };
}

// ── Rendering ──────────────────────────────────────────────────────
function renderZoo() {
  renderStreak();
  renderRoster();
  renderActivePet();
  renderInventory();
  startCooldownTicker();
}

function renderStreak() {
  const el = document.getElementById('zoo-streak');
  if (!el) return;
  const s = loadStreak();
  el.innerHTML = s.streak > 0
    ? `<span class="zoo-streak-flame">🔥</span> ${s.streak}-day streak · ${s.careScore} care actions`
    : `Take care of your pet daily to build a streak 🔥`;
}

function renderRoster() {
  document.getElementById('zoo-roster').innerHTML = petUser.pets.map((pet, i) => {
    const rarityClass = RARITY_CLASS[(pet.rarity || 'common').toLowerCase()] || '';
    const mood = petMood(pet);
    return `
    <div class="zoo-roster-card ${i === activeIndex ? 'active' : ''} ${rarityClass}" onclick="switchPet(${i})">
      <span class="zoo-mood-badge" title="${mood.label}">${mood.emoji}</span>
      <img src="assets/pets/${pet.type}.png" onerror="this.style.display='none'" class="zoo-roster-img" />
      <div class="zoo-roster-name">${pet.name}</div>
      <div class="zoo-roster-sub">Lv.${pet.level} · ${pet.displayName || pet.type}</div>
      ${i === activeIndex ? '<span class="zoo-roster-badge">ACTIVE</span>' : ''}
      <button class="zoo-roster-release" onclick="event.stopPropagation(); releasePet(${i})" title="Release">✕</button>
    </div>
  `;
  }).join('');
}

function renderActivePet() {
  const p = petUser.pets[activeIndex];
  const expToLevel = p.expToLevel || 100;
  const feedCD  = checkCooldown(p.lastFed, PET_COOLDOWNS.feed);
  const trainCD = checkCooldown(p.lastTrained, PET_COOLDOWNS.train);
  const playCD  = checkCooldown(p.lastPlayed, PET_COOLDOWNS.play);
  const cleanCD = checkCooldown(p.lastCleaned, PET_COOLDOWNS.clean);
  const ageDays = Math.floor((Date.now() - p.adoptedAt) / (1000 * 60 * 60 * 24));
  const rarityClass = RARITY_CLASS[(p.rarity || 'common').toLowerCase()] || '';
  const mood = petMood(p);

  const container = document.getElementById('zoo-active');
  container.className = `zoo-active-inner ${rarityClass}`;
  container.innerHTML = `
    <div class="zoo-pet-header" id="zoo-pet-header">
      <div id="zoo-particles"></div>
      <img src="assets/pets/${p.type}.png" onerror="this.style.display='none'" class="zoo-pet-img" id="zoo-pet-img" />
      <div>
        <div class="zoo-pet-name">${p.name} <span class="zoo-mood-tag" title="${mood.label}">${mood.emoji} ${mood.label}</span></div>
        <div class="zoo-pet-sub">${p.displayName || p.type} · Lv.${p.level} · ${p.rarity || 'Common'} · ${ageDays}d old</div>
      </div>
    </div>
    <div class="zoo-flavor" id="zoo-flavor"></div>
    <div class="zoo-stats" id="zoo-stats">
      ${statRow('⭐ EXP', p.exp, expToLevel, '#a78bfa')}
      ${statRow('❤️ HP', p.hp, p.maxHp, '#34d399')}
      ${statRow('😊 Happiness', p.happiness, 100, '#fbbf24')}
      ${statRow('🍗 Hunger', 100 - p.hunger, 100, '#f87171', `${p.hunger}% hungry`)}
      ${statRow('⚡ Energy', p.energy || 100, 100, '#60a5fa')}
      ${statRow('🧼 Clean', p.cleanliness, 100, '#22d3ee')}
    </div>
    <div class="zoo-actions">
      ${actionBtn('feed', '🍗 Feed', feedCD)}
      ${actionBtn('train', '💪 Train', trainCD)}
      ${actionBtn('play', '🎾 Play', playCD)}
      ${actionBtn('clean', '🧼 Clean', cleanCD)}
    </div>
  `;
}

function statRow(label, val, max, color, overrideText) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  return `
    <div class="zoo-stat-row">
      <span class="zoo-stat-label">${label}</span>
      <span class="zoo-stat-bar"><span style="width:${pct}%;background:${color}"></span></span>
      <span class="zoo-stat-val">${overrideText || `${val}/${max}`}</span>
    </div>
  `;
}

function actionBtn(action, label, cd) {
  const totalMs = PET_COOLDOWNS[action];
  const pct = cd.available ? 100 : Math.round(((totalMs - cd.remaining) / totalMs) * 100);
  return `
    <button class="zoo-action-btn" ${cd.available ? '' : 'disabled'} onclick="doPetAction('${action}')" data-action="${action}">
      <span class="zoo-action-label">${label}${cd.available ? '' : ` · ${formatTime(cd.remaining)}`}</span>
      <span class="zoo-cd-track"><span class="zoo-cd-fill" style="width:${pct}%"></span></span>
    </button>
  `;
}

// Refresh just the cooldown text/bars every 15s without a full re-render,
// so the pet doesn't visually "flicker" while nothing else changed.
let cooldownTimer = null;
function startCooldownTicker() {
  clearInterval(cooldownTimer);
  cooldownTimer = setInterval(() => {
    if (!petUser) return;
    const p = petUser.pets[activeIndex];
    if (!p) return;
    document.querySelectorAll('#zoo-active [data-action]').forEach(btn => {
      const action = btn.dataset.action;
      const lastMap = { feed: p.lastFed, train: p.lastTrained, play: p.lastPlayed, clean: p.lastCleaned };
      const cd = checkCooldown(lastMap[action], PET_COOLDOWNS[action]);
      const label = { feed: '🍗 Feed', train: '💪 Train', play: '🎾 Play', clean: '🧼 Clean' }[action];
      btn.outerHTML = actionBtn(action, label, cd);
    });
  }, 15000);
}

function renderInventory() {
  const inv = petUser.inventory || {};
  const entries = Object.entries(inv).filter(([id, qty]) => ITEM_NAMES[id] && qty > 0);
  document.getElementById('zoo-inventory').innerHTML = entries.length
    ? entries.map(([id, qty]) => `<span class="zoo-inv-item">${ITEM_NAMES[id]} ×${qty}</span>`).join('')
    : `<span class="zoo-inv-empty">Backpack empty — visit the shop for food &amp; toys</span>`;
}

// ── Feedback effects ──────────────────────────────────────────────
function bouncePet() {
  const img = document.getElementById('zoo-pet-img');
  if (!img) return;
  img.classList.remove('bounce');
  void img.offsetWidth; // restart animation
  img.classList.add('bounce');
}

function spawnParticles(emojis, count = 8) {
  const layer = document.getElementById('zoo-particles');
  if (!layer) return;
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'zoo-particle';
    span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    const dx = (Math.random() - 0.5) * 80;
    span.style.setProperty('--dx', `${dx}px`);
    span.style.left = `${30 + Math.random() * 40}%`;
    span.style.top = `${20 + Math.random() * 20}%`;
    span.style.animationDelay = `${Math.random() * 0.15}s`;
    layer.appendChild(span);
    setTimeout(() => span.remove(), 1200);
  }
}

function showFlavorLine(action, petName) {
  const pool = FLAVOR_TEXT[action];
  if (!pool) return;
  const line = pool[Math.floor(Math.random() * pool.length)].replace('{name}', petName);
  const el = document.getElementById('zoo-flavor');
  if (!el) return;
  el.textContent = line;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function pulseStats() {
  const el = document.getElementById('zoo-stats');
  if (!el) return;
  el.classList.remove('level-pulse');
  void el.offsetWidth;
  el.classList.add('level-pulse');
}

// ── Actions ────────────────────────────────────────────────────────
function switchPet(i) {
  if (i === activeIndex) return;
  activeIndex = i;
  petUser.activePetIndex = i;
  renderZoo();
  PetApi.savePetEconomy(currentLid, { activePetIndex: i }); // fire-and-forget
}

async function releasePet(i) {
  const pet = petUser.pets[i];
  if (!confirm(`Release ${pet.name}? This can't be undone.`)) return;

  petUser.pets.splice(i, 1);
  if (!petUser.pets.length) {
    await PetApi.savePetEconomy(currentLid, { pets: [], activePetIndex: 0 });
    showZooEmpty();
    return;
  }
  if (activeIndex >= petUser.pets.length) activeIndex = petUser.pets.length - 1;
  petUser.activePetIndex = activeIndex;

  await PetApi.savePetEconomy(currentLid, { pets: petUser.pets, activePetIndex: activeIndex });
  renderZoo();
}

async function doPetAction(action) {
  const p = petUser.pets[activeIndex];
  const inv = petUser.inventory || (petUser.inventory = {});
  let leveledUp = false;

  if (action === 'feed') {
    if (!checkCooldown(p.lastFed, PET_COOLDOWNS.feed).available) return;
    if (!inv['pet_food']) return showZooToast('No Pet Food left! Visit the shop.');
    inv['pet_food'] -= 1;
    if (inv['pet_food'] <= 0) delete inv['pet_food'];
    p.hunger = Math.max(0, p.hunger - 35);
    p.hp = Math.min(p.maxHp, p.hp + 15);
    p.lastFed = Date.now();

  } else if (action === 'train') {
    if (!checkCooldown(p.lastTrained, PET_COOLDOWNS.train).available) return;
    if ((p.energy || 100) < 20) return showZooToast(`${p.name} has critically low energy.`);
    p.energy = Math.max(0, p.energy - 20);
    p.exp += 30;
    p.lastTrained = Date.now();
    const expToLevel = p.expToLevel || 100;
    if (p.exp >= expToLevel) {
      p.level++;
      p.exp -= expToLevel;
      p.maxHp += 10;
      p.hp = p.maxHp;
      p.expToLevel = Math.round(expToLevel * 1.25);
      leveledUp = true;
    }

  } else if (action === 'play') {
    if (!checkCooldown(p.lastPlayed, PET_COOLDOWNS.play).available) return;
    p.energy = Math.max(0, p.energy - 15);
    p.happiness = Math.min(100, p.happiness + 25);
    p.cleanliness = Math.max(0, p.cleanliness - 15);
    p.lastPlayed = Date.now();

  } else if (action === 'clean') {
    if (!checkCooldown(p.lastCleaned, PET_COOLDOWNS.clean).available) return;
    p.cleanliness = 100;
    p.lastCleaned = Date.now();
  }

  renderZoo();
  bouncePet();
  spawnParticles(ACTION_PARTICLES[action] || ['✨']);
  showFlavorLine(action, p.name);

  const { streak, milestoneHit } = registerCareAction();
  renderStreak();
  if (milestoneHit) {
    showZooToast(`🔥 ${milestoneHit}-day care streak! ${p.name} feels the bond.`);
  }

  if (leveledUp) {
    setTimeout(() => {
      spawnParticles(LEVEL_UP_PARTICLES, 14);
      pulseStats();
      showZooToast(`🎉 ${p.name} reached Level ${p.level}!`);
    }, 250);
  }

  const result = await PetApi.savePetEconomy(currentLid, { pets: petUser.pets, inventory: inv });
  if (!result) showZooToast('⚠️ Saved locally but failed to sync — try again.');
}

// ── UI helpers ─────────────────────────────────────────────────────
function showZooToast(msg) {
  const t = document.getElementById('zoo-toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showZooToast._t);
  showZooToast._t = setTimeout(() => t.classList.remove('show'), 2500);
}

function showZooError(msg) {
  document.getElementById('zoo-loading').style.display = 'none';
  document.getElementById('zoo-empty').style.display = '';
  document.getElementById('zoo-empty').innerHTML =
    `<div class="empty-icon">❌</div><div class="empty-text">${msg}</div>`;
}

function showZooEmpty() {
  document.getElementById('zoo-root').style.display = 'none';
  document.getElementById('zoo-empty').style.display = '';
  document.getElementById('zoo-empty').innerHTML = `
    <div class="empty-icon">🐾</div>
    <div class="empty-text">No pets yet — adopt one from the Pet Shop!</div>
  `;
}
