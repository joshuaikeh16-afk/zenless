// fx.js — AniGamble HQ Forex & Markets engine
//
// Adds a self-contained "FX Credits" minigame economy on top of the existing
// Prime Points system. Players convert PP -> FX Credits, then trade forex
// pairs and a handful of hardcoded stocks/gold/land assets using flat 10x
// leverage. ALL prices (forex + stocks + gold + land) are hardcoded base
// values that nudge once per hour via a deterministic seeded random walk —
// every player sees the same price in a given hour, no external API or
// network dependency involved. Everything persists into the same per-user
// `data` JSONB blob Supabase already stores PP/cards/etc in, under two new
// fields:
//
//   data.fxCredits    -> number, the player's FX Credit balance
//   data.fxPositions  -> array of open positions, each:
//       { id, kind: 'forex'|'asset', symbol, side: 'buy'|'sell',
//         stake, leverage, entryPrice, openedAt }
//
// Closed trades are folded into ppHistory-style records under:
//   data.fxHistory -> array of { symbol, side, stake, pnl, closedAt }
//
// This module does NOT touch Supabase directly — same pattern as PPApi in
// api.js. Callers pass in the user's row id + current raw data object and
// get back the new values to merge, then call API.updateUserData themselves
// (or use the convenience wrappers below, which do it for you).

const FxApi = (() => {
  const CONVERSION_RATE   = 1;    // 1 PP = 1 FX Credit
  const LEVERAGE          = 10;   // flat leverage for every trade
  const HISTORY_CAP       = 40;
  const ASSET_NUDGE_PCT   = 0.015; // max ±1.5% hourly random nudge for hardcoded assets

  // ── Hardcoded assets ────────────────────────────────────────────
  // Invented companies/assets styled like real tickers — not real entities,
  // not real market data. Prices nudge once per hour (see priceForHour).
  const ASSETS = [
    { symbol: 'ORN', name: 'Orion Dynamics',      type: 'stock', basePrice: 142.50 },
    { symbol: 'VXL', name: 'Vexel Technologies',  type: 'stock', basePrice: 88.20  },
    { symbol: 'CRB', name: 'Crimson Robotics',    type: 'stock', basePrice: 215.75 },
    { symbol: 'HLC', name: 'Halcyon Biotech',     type: 'stock', basePrice: 64.10  },
    { symbol: 'NWE', name: 'Northwind Energy',    type: 'stock', basePrice: 51.30  },
    { symbol: 'QTZ', name: 'Quartz Interactive',  type: 'stock', basePrice: 176.90 },
    { symbol: 'FRO', name: 'Ferro Industrial',    type: 'stock', basePrice: 39.45  },
    { symbol: 'LUM', name: 'Lumen Aerospace',     type: 'stock', basePrice: 301.60 },
    { symbol: 'XAU', name: 'Gold (oz)',           type: 'metal', basePrice: 2380.00 },
    { symbol: 'MRD', name: 'Coastal Plot — Meridian Bay',   type: 'land', basePrice: 18500 },
    { symbol: 'THN', name: 'Highland Acreage — Thornfield', type: 'land', basePrice: 9200  },
    { symbol: 'SBL', name: 'Desert Parcel — Sable Dunes',   type: 'land', basePrice: 5400  },
  ];

  const FOREX_PAIRS = [
    { symbol: 'EUR/USD', basePrice: 1.0870 },
    { symbol: 'GBP/USD', basePrice: 1.2660 },
    { symbol: 'USD/JPY', basePrice: 156.20 },
    { symbol: 'AUD/USD', basePrice: 0.6580 },
    { symbol: 'USD/CAD', basePrice: 1.3700 },
    { symbol: 'USD/CHF', basePrice: 0.8800 },
    { symbol: 'NZD/USD', basePrice: 0.6100 },
  ];

  // Deterministic seeded "random" per hour so every player sees the same
  // nudged price in a given hour, without needing a server to broadcast it.
  // Seed = symbol + current hour bucket (UTC).
  function seededRandom(seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = (h * 31 + seed.charCodeAt(i)) & 0xffffffff;
    }
    // xorshift-ish scramble, returns 0..1
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  }

  function currentHourBucket() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
  }

  // Walk the asset's price forward one hourly nudge per hour elapsed since
  // a fixed epoch, compounding deterministically — so the "current" price
  // is stable within an hour and consistent for every player.
  function assetPrice(symbol, basePrice, nudgePct = ASSET_NUDGE_PCT, driftPct = 0.04) {
    const bucket = currentHourBucket();
    const seed = symbol + ':' + bucket;
    const r = seededRandom(seed); // 0..1
    const pct = (r * 2 - 1) * nudgePct;

    const d = new Date();
    const dayBucket = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    const driftSeed = seededRandom(symbol + ':drift:' + dayBucket);
    const drift = (driftSeed * 2 - 1) * driftPct;

    const price = basePrice * (1 + drift) * (1 + pct);
    return Math.max(0.0001, price);
  }

  function getAssets() {
    return ASSETS.map(a => ({ ...a, price: assetPrice(a.symbol, a.basePrice) }));
  }

  function getAsset(symbol) {
    const a = ASSETS.find(x => x.symbol === symbol);
    if (!a) return null;
    return { ...a, price: assetPrice(a.symbol, a.basePrice) };
  }

  // ── Forex rates (hardcoded, same hourly-walk model as other assets) ────
  // Real forex pairs move far less in % terms than stocks day to day, so use
  // a tighter nudge/drift band to keep them feeling realistic.
  const FOREX_NUDGE_PCT = 0.004; // ±0.4% hourly
  const FOREX_DRIFT_PCT = 0.012; // ±1.2% daily drift

  function getForexRates() {
    return FOREX_PAIRS.map(p => ({
      symbol: p.symbol,
      price: assetPrice(p.symbol, p.basePrice, FOREX_NUDGE_PCT, FOREX_DRIFT_PCT),
    }));
  }

  function getForexRate(symbol) {
    return getForexRates().find(r => r.symbol === symbol) || null;
  }

  // ── In-between tick generator (for the live chart) ──────────────────
  // Generates a smooth, deterministic-but-jittery path of points between
  // "now" and the stable hourly value, purely for visual chart movement.
  // Does NOT affect the real tradable price — entryPrice/closePrice always
  // use assetPrice()/getForexRate() above.
  function generateTickPath(basePriceNow, points = 30, volatility = 0.0006) {
    const path = [];
    let p = basePriceNow;
    for (let i = 0; i < points; i++) {
      // small mean-reverting random walk around the real hourly price
      const pull = (basePriceNow - p) * 0.15;
      const noise = (Math.random() * 2 - 1) * basePriceNow * volatility;
      p = p + pull + noise;
      path.push(p);
    }
    return path;
  }

  // ── Credits & positions ─────────────────────────────────────────
  function getCredits(data) {
    return Number(data?.fxCredits || 0);
  }

  function getPositions(data) {
    return Array.isArray(data?.fxPositions) ? data.fxPositions : [];
  }

  function getHistory(data) {
    return Array.isArray(data?.fxHistory) ? data.fxHistory : [];
  }

  function pushFxHistory(data, entry) {
    const history = getHistory(data).slice();
    history.unshift({ ...entry, closedAt: new Date().toISOString() });
    if (history.length > HISTORY_CAP) history.length = HISTORY_CAP;
    return history;
  }

  // Convert PP -> FX Credits. Caller must have already deducted the PP
  // amount from primePoints if PP loss should be enforced; this just adds
  // the credit side. Kept separate so callers can validate PP balance first.
  function buyCredits(data, ppAmount) {
    ppAmount = Math.max(0, Number(ppAmount) || 0);
    const creditsGained = ppAmount * CONVERSION_RATE;
    const newCredits = getCredits(data) + creditsGained;
    return { fxCredits: newCredits, creditsGained };
  }

  // Convert FX Credits -> PP (cash out).
  function sellCredits(data, creditAmount) {
    creditAmount = Math.max(0, Number(creditAmount) || 0);
    const have = getCredits(data);
    const amount = Math.min(have, creditAmount);
    const ppGained = amount / CONVERSION_RATE;
    return { fxCredits: have - amount, ppGained };
  }

  // Open a position. `entryPrice` must be the current price/rate the caller
  // already fetched (from getAsset or getForexRate) at time of opening.
  // `stopLoss`/`takeProfit` are optional absolute price levels. They're
  // validated against side+entry so a SL/TP can't be set on the wrong side
  // of the entry price (which would trigger instantly or never).
  function openPosition(data, { kind, symbol, side, stake, entryPrice, stopLoss, takeProfit }) {
    stake = Number(stake) || 0;
    const credits = getCredits(data);
    if (stake <= 0) throw new Error('Stake must be greater than 0');
    if (stake > credits) throw new Error('Not enough FX Credits');
    if (!entryPrice || entryPrice <= 0) throw new Error('Invalid entry price');

    stopLoss   = stopLoss   ? Number(stopLoss)   : null;
    takeProfit = takeProfit ? Number(takeProfit) : null;

    if (stopLoss !== null && (!isFinite(stopLoss) || stopLoss <= 0)) throw new Error('Invalid stop-loss price');
    if (takeProfit !== null && (!isFinite(takeProfit) || takeProfit <= 0)) throw new Error('Invalid take-profit price');

    if (side === 'buy') {
      if (stopLoss !== null && stopLoss >= entryPrice) throw new Error('Stop-loss must be below entry price for a BUY');
      if (takeProfit !== null && takeProfit <= entryPrice) throw new Error('Take-profit must be above entry price for a BUY');
    } else {
      if (stopLoss !== null && stopLoss <= entryPrice) throw new Error('Stop-loss must be above entry price for a SELL');
      if (takeProfit !== null && takeProfit >= entryPrice) throw new Error('Take-profit must be below entry price for a SELL');
    }

    const position = {
      id: 'fx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      kind,          // 'forex' | 'asset'
      symbol,
      side,          // 'buy' | 'sell'
      stake,
      leverage: LEVERAGE,
      entryPrice,
      stopLoss,
      takeProfit,
      openedAt: new Date().toISOString(),
    };

    const positions = getPositions(data).concat(position);
    const newCredits = credits - stake;
    return { fxCredits: newCredits, fxPositions: positions, position };
  }

  // Compute live P/L for a position given the current price.
  function calcPnL(position, currentPrice) {
    if (!currentPrice || currentPrice <= 0) return 0;
    const pctMove = (currentPrice - position.entryPrice) / position.entryPrice;
    const directional = position.side === 'sell' ? -pctMove : pctMove;
    return position.stake * directional * position.leverage;
  }

  // Close a position: credits the stake back plus/minus P/L (P/L can exceed
  // -stake in theory at 10x, so floor the loss at -stake to avoid negative
  // balances — same "can't lose more than you put in" guarantee real margin
  // accounts enforce via stop-outs).
  function closePosition(data, positionId, currentPrice, reason = 'manual') {
    const positions = getPositions(data);
    const idx = positions.findIndex(p => p.id === positionId);
    if (idx === -1) throw new Error('Position not found');

    const position = positions[idx];
    let pnl = calcPnL(position, currentPrice);
    if (pnl < -position.stake) pnl = -position.stake; // floor loss at stake

    const remaining = positions.slice();
    remaining.splice(idx, 1);

    const newCredits = getCredits(data) + position.stake + pnl;
    const history = pushFxHistory(data, {
      symbol: position.symbol,
      side: position.side,
      stake: position.stake,
      pnl: Math.round(pnl * 100) / 100,
      reason, // 'manual' | 'sl' | 'tp'
    });

    return {
      fxCredits: Math.max(0, newCredits),
      fxPositions: remaining,
      fxHistory: history,
      pnl,
    };
  }

  // ── Stop-loss / take-profit ──────────────────────────────────────
  // Returns 'tp', 'sl', or null depending on whether currentPrice has
  // crossed the position's stop-loss or take-profit level. Take-profit is
  // checked first so a price that gaps through both in one tick (rare with
  // hourly nudges, but possible right at an hour rollover) resolves as a win.
  function checkTrigger(position, currentPrice) {
    if (!currentPrice || currentPrice <= 0) return null;
    if (position.side === 'buy') {
      if (position.takeProfit && currentPrice >= position.takeProfit) return 'tp';
      if (position.stopLoss && currentPrice <= position.stopLoss) return 'sl';
    } else {
      if (position.takeProfit && currentPrice <= position.takeProfit) return 'tp';
      if (position.stopLoss && currentPrice >= position.stopLoss) return 'sl';
    }
    return null;
  }

  // Scans all open positions and closes any whose SL/TP has been hit.
  // `priceLookupFn(symbol, kind)` must return the current live price for
  // that position (caller supplies this since fx.js itself doesn't track
  // a live asset cache). Returns the new data fields to persist, plus a
  // `closed` array describing what got auto-closed (for toasts/logging).
  function autoClosePositions(data, priceLookupFn) {
    let working = data;
    const closed = [];

    for (const pos of getPositions(working).slice()) {
      const price = priceLookupFn(pos.symbol, pos.kind);
      const trigger = checkTrigger(pos, price);
      if (!trigger) continue;

      const result = closePosition(working, pos.id, price, trigger);
      working = { ...working, fxCredits: result.fxCredits, fxPositions: result.fxPositions, fxHistory: result.fxHistory };
      closed.push({ position: pos, trigger, pnl: result.pnl, price });
    }

    return {
      fxCredits:   working.fxCredits   ?? getCredits(data),
      fxPositions: working.fxPositions ?? getPositions(data),
      fxHistory:   working.fxHistory   ?? getHistory(data),
      closed,
    };
  }

  // ── Net worth (for leaderboard) ──────────────────────────────────
  // Credits on hand + the current mark-to-market value of every open
  // position (stake +/- live P/L, floored at 0 per position same as a
  // real close would do).
  function getCurrentMarketPrice(symbol) {
    const forexHit = FOREX_PAIRS.find(p => p.symbol === symbol);
    if (forexHit) return assetPrice(symbol, forexHit.basePrice, FOREX_NUDGE_PCT, FOREX_DRIFT_PCT);
    const assetHit = ASSETS.find(a => a.symbol === symbol);
    if (assetHit) return assetPrice(assetHit.symbol, assetHit.basePrice);
    return null;
  }

  function getNetWorth(data) {
    const credits = getCredits(data);
    const positions = getPositions(data);
    const openValue = positions.reduce((sum, p) => {
      const price = getCurrentMarketPrice(p.symbol);
      if (!price) return sum + p.stake;
      const pnl = Math.max(-p.stake, calcPnL(p, price));
      return sum + p.stake + pnl;
    }, 0);
    return Math.round((credits + openValue) * 100) / 100;
  }

  // ── Candlestick history ───────────────────────────────────────────
  // Reconstructs deterministic hourly OHLC candles for the last `count`
  // hours using the exact same seeded model as assetPrice(), so the most
  // recent candle's close always matches the live tradable price. Open is
  // the previous candle's close (a real walk, not independent noise); high
  // and low get a small deterministic wiggle beyond open/close so candles
  // have visible wicks instead of being flat bars.
  function getCandles(symbol, basePrice, { count = 24, nudgePct = ASSET_NUDGE_PCT, driftPct = 0.04 } = {}) {
    const now = new Date();
    const raw = [];

    for (let i = count - 1; i >= 0; i--) {
      const bucketDate = new Date(now.getTime() - i * 3600 * 1000);
      const bucket = `${bucketDate.getUTCFullYear()}-${bucketDate.getUTCMonth()}-${bucketDate.getUTCDate()}-${bucketDate.getUTCHours()}`;
      const dayBucket = `${bucketDate.getUTCFullYear()}-${bucketDate.getUTCMonth()}-${bucketDate.getUTCDate()}`;

      const r = seededRandom(symbol + ':' + bucket);
      const pct = (r * 2 - 1) * nudgePct;
      const driftSeed = seededRandom(symbol + ':drift:' + dayBucket);
      const drift = (driftSeed * 2 - 1) * driftPct;
      const close = Math.max(0.0001, basePrice * (1 + drift) * (1 + pct));

      raw.push({ bucket, close, pct });
    }

    return raw.map((c, i) => {
      const open = i === 0 ? c.close * (1 - c.pct * 0.5) : raw[i - 1].close;
      const wiggleSeed = seededRandom(symbol + ':wick:' + c.bucket);
      const wiggle = Math.abs(wiggleSeed * 2 - 1) * Math.max(Math.abs(c.close - open), c.close * nudgePct * 0.5)
                     + c.close * nudgePct * 0.3;
      const high = Math.max(open, c.close) + wiggle;
      const low  = Math.max(0.0001, Math.min(open, c.close) - wiggle);
      return { time: c.bucket, open, high, low, close: c.close };
    });
  }

  function getCandlesForAsset(symbol, count = 24) {
    const a = ASSETS.find(x => x.symbol === symbol);
    if (!a) return [];
    return getCandles(symbol, a.basePrice, { count });
  }

  function getCandlesForForex(symbol, count = 24) {
    const p = FOREX_PAIRS.find(x => x.symbol === symbol);
    if (!p) return [];
    return getCandles(symbol, p.basePrice, { count, nudgePct: FOREX_NUDGE_PCT, driftPct: FOREX_DRIFT_PCT });
  }

  return {
    CONVERSION_RATE, LEVERAGE,
    ASSETS, FOREX_PAIRS,
    getAssets, getAsset,
    getForexRates, getForexRate,
    generateTickPath,
    getCredits, getPositions, getHistory,
    buyCredits, sellCredits,
    openPosition, closePosition, calcPnL,
    checkTrigger, autoClosePositions,
    getNetWorth,
    getCandles, getCandlesForAsset, getCandlesForForex,
  };
})();
