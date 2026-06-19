/* ══════════════════════════════════════════════════════════════
   celebrate.js — fire a center-screen celebration burst
   Usage:
     celebrate({
       type: 'win' | 'jackpot' | 'levelup' | 'rank' | 'lose',
       icon: '🎉',           // any emoji or short text/icon class
       title: 'You won!',
       value: '+4,250',
       subtitle: 'Crash cashed out at 3.4x',
       confetti: true,       // default true for win/jackpot/levelup/rank
       autoClose: 3500       // ms, 0 = don't auto close
     });
   ══════════════════════════════════════════════════════════════ */

(function () {
  let overlayEl = null;

  function ensureOverlay() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.className = 'celebrate-overlay';
    overlayEl.innerHTML = '<div class="celebrate-card"></div>';
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) closeCelebrate();
    });
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function spawnConfetti(card, colors) {
    const count = 26;
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      const color = colors[Math.floor(Math.random() * colors.length)];
      piece.style.background = color;
      piece.style.left = Math.random() * 100 + '%';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      const duration = 1.1 + Math.random() * 0.9;
      const delay = Math.random() * 0.25;
      piece.style.animationDuration = duration + 's';
      piece.style.animationDelay = delay + 's';
      piece.style.transform = `scale(${0.6 + Math.random() * 0.7})`;
      card.appendChild(piece);
      setTimeout(() => piece.remove(), (duration + delay) * 1000 + 100);
    }
  }

  const TYPE_CONFIG = {
    win:     { confetti: true,  colors: ['#22d472', '#4eebA0', '#0e3a22'] },
    jackpot: { confetti: true,  colors: ['#f0c040', '#ffd76a', '#7c5dfa'] },
    levelup: { confetti: true,  colors: ['#7c5dfa', '#5b8af5', '#a78bfa'] },
    rank:    { confetti: true,  colors: ['#a78bfa', '#5b8af5', '#7c5dfa'] },
    lose:    { confetti: false, colors: [] }
  };

  window.celebrate = function (opts) {
    const {
      type = 'win',
      icon = '✦',
      title = '',
      value = '',
      subtitle = '',
      confetti,
      autoClose = 3500
    } = opts || {};

    const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.win;
    const showConfetti = confetti !== undefined ? confetti : cfg.confetti;

    const overlay = ensureOverlay();
    const card = overlay.querySelector('.celebrate-card');
    card.className = 'celebrate-card t-' + type;
    card.innerHTML = `
      <button class="celebrate-close" aria-label="Close">✕</button>
      <div class="celebrate-glow"></div>
      <div class="celebrate-icon">${icon}</div>
      ${title ? `<div class="celebrate-title">${title}</div>` : ''}
      ${value ? `<div class="celebrate-value">${value}</div>` : ''}
      ${subtitle ? `<div class="celebrate-subtitle">${subtitle}</div>` : ''}
      <button class="celebrate-dismiss">Nice</button>
    `;

    card.querySelector('.celebrate-close').addEventListener('click', closeCelebrate);
    card.querySelector('.celebrate-dismiss').addEventListener('click', closeCelebrate);

    requestAnimationFrame(() => {
      overlay.classList.add('show');
      if (showConfetti) spawnConfetti(card, cfg.colors);
    });

    if (overlay._timer) clearTimeout(overlay._timer);
    if (autoClose > 0) {
      overlay._timer = setTimeout(closeCelebrate, autoClose);
    }
  };

  function closeCelebrate() {
    if (!overlayEl) return;
    overlayEl.classList.remove('show');
  }

  window.closeCelebrate = closeCelebrate;
})();