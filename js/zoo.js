// ── Zoo (pet care) ──────────────────────────────────────────────────
// Mirrors the WhatsApp bot's pet.js command logic so stats, cooldowns,
// and leveling behave identically whether a player uses .pet feed on
// WhatsApp or the Feed button here. Every action ends with a PATCH back
// to the bot economy via PetApi — the bot store is the source of truth.

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

// ── Rendering ──────────────────────────────────────────────────────
function renderZoo() {
  renderRoster();
  renderActivePet();
  renderInventory();
}

function renderRoster() {
  document.getElementById('zoo-roster').innerHTML = petUser.pets.map((pet, i) => `
    <div class="zoo-roster-card ${i === activeIndex ? 'active' : ''}" onclick="switchPet(${i})">
      <img src="assets/pets/${pet.type}.png" onerror="this.style.display='none'" class="zoo-roster-img" />
      <div class="zoo-roster-name">${pet.name}</div>
      <div class="zoo-roster-sub">Lv.${pet.level} · ${pet.displayName || pet.type}</div>
      ${i === activeIndex ? '<span class="zoo-roster-badge">ACTIVE</span>' : ''}
      <button class="zoo-roster-release" onclick="event.stopPropagation(); releasePet(${i})" title="Release">✕</button>
    </div>
  `).join('');
}

function renderActivePet() {
  const p = petUser.pets[activeIndex];
  const expToLevel = p.expToLevel || 100;
  const feedCD  = checkCooldown(p.lastFed, PET_COOLDOWNS.feed);
  const trainCD = checkCooldown(p.lastTrained, PET_COOLDOWNS.train);
  const playCD  = checkCooldown(p.lastPlayed, PET_COOLDOWNS.play);
  const cleanCD = checkCooldown(p.lastCleaned, PET_COOLDOWNS.clean);
  const ageDays = Math.floor((Date.now() - p.adoptedAt) / (1000 * 60 * 60 * 24));

  document.getElementById('zoo-active').innerHTML = `
    <div class="zoo-pet-header">
      <img src="assets/pets/${p.type}.png" onerror="this.style.display='none'" class="zoo-pet-img" />
      <div>
        <div class="zoo-pet-name">${p.name}</div>
        <div class="zoo-pet-sub">${p.displayName || p.type} · Lv.${p.level} · ${p.rarity || 'Common'} · ${ageDays}d old</div>
      </div>
    </div>
    <div class="zoo-stats">
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
  return `
    <button class="zoo-action-btn" ${cd.available ? '' : 'disabled'} onclick="doPetAction('${action}')">
      ${label}${cd.available ? '' : ` · ${formatTime(cd.remaining)}`}
    </button>
  `;
}

function renderInventory() {
  const inv = petUser.inventory || {};
  const entries = Object.entries(inv).filter(([id, qty]) => ITEM_NAMES[id] && qty > 0);
  document.getElementById('zoo-inventory').innerHTML = entries.length
    ? entries.map(([id, qty]) => `<span class="zoo-inv-item">${ITEM_NAMES[id]} ×${qty}</span>`).join('')
    : `<span class="zoo-inv-empty">Backpack empty — visit the shop for food &amp; toys</span>`;
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
      showZooToast(`🎉 ${p.name} reached Level ${p.level}!`);
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
