// ════════════════════════════════════════════════════════════════
//  items-catalog.js — AniGamble HQ · Shop item catalog
//  Converted from ES-module syntax (export const/function) to a
//  plain global, to match how config.js / api.js / app.js are
//  loaded on this site (plain <script src>, no import/export).
//  Source of truth: the WhatsApp bot's .shop catalog.
// ════════════════════════════════════════════════════════════════

const CARD_SHOP = {
  "tools": [
    {
      "id": "shovel",
      "name": "⛏️ Basic Shovel",
      "price": 5000,
      "type": "tool",
      "description": "Dig for primos (2 hour cooldown)"
    },
    {
      "id": "fishing_rod",
      "name": "🎣 Fishing Rod",
      "price": 8000,
      "type": "tool",
      "description": "Fish for rewards (1 hour cooldown)"
    },
    {
      "id": "gun",
      "name": "🔫 Robber's Gun",
      "price": 15000,
      "type": "tool",
      "description": "Rob other users (4 hour cooldown)"
    }
  ],
  "upgrades": [
    {
      "id": "bank_small",
      "name": "🏦 Small Bank Upgrade",
      "price": 10000,
      "type": "upgrade",
      "capacity": 50000,
      "description": "+50K bank capacity"
    },
    {
      "id": "bank_medium",
      "name": "🏦 Medium Bank Upgrade",
      "price": 25000,
      "type": "upgrade",
      "capacity": 100000,
      "description": "+100K bank capacity"
    },
    {
      "id": "bank_large",
      "name": "🏦 Large Bank Upgrade",
      "price": 50000,
      "type": "upgrade",
      "capacity": 250000,
      "description": "+250K bank capacity"
    },
    {
      "id": "bank_premium",
      "name": "🏦 Premium Bank Upgrade",
      "price": 250000,
      "type": "upgrade",
      "capacity": 1000000,
      "description": "+1,000,000 bank capacity"
    },
    {
      "id": "bank_3m",
      "name": "🏦 Elite Bank Vault",
      "price": 500000,
      "type": "upgrade",
      "capacity": 3000000,
      "description": "+3,000,000 bank capacity"
    },
    {
      "id": "bank_5m",
      "name": "🏦 Titan Bank Vault",
      "price": 750000,
      "type": "upgrade",
      "capacity": 5000000,
      "description": "+5,000,000 bank capacity"
    }
  ],
  "services": [
    {
      "id": "lottery_ticket",
      "name": "🎟️ Lottery Ticket",
      "price": 250000,
      "type": "service",
      "description": "Enters you into the lottery pool"
    }
  ],
  "investments": [
    { "id": "gold",  "name": "🥇 Solid Gold Bullion",        "rate": 42396,   "riskPct": 0, "secure": true,  "description": "Secure store of value." },
    { "id": "stark", "name": "📈 StarkCorp High-Yield Shares", "rate": 2207,    "riskPct": 2, "secure": false, "description": "Equity position, modest volatility." },
    { "id": "land",  "name": "🗺️ Commercial Real Estate Deed", "rate": 1186936, "riskPct": 0, "secure": true,  "description": "High-value, low-risk asset." },
    { "id": "oil",   "name": "🛢️ Crude Oil Futures",          "rate": 3000,    "riskPct": 2, "secure": false, "description": "Commodity futures contract." },
    { "id": "tech",  "name": "💾 Quantum Computing Chips",    "rate": 376580,  "riskPct": 5, "secure": false, "description": "High-growth, higher-risk tech asset." },
    { "id": "bonds", "name": "📜 Sovereign Treasury Bonds",   "rate": 207290,  "riskPct": 0, "secure": true,  "description": "Government-backed, secure." },
    { "id": "art",   "name": "🎨 Digital Asset Collectible",  "rate": 139,     "riskPct": 10, "secure": false, "description": "Speculative collectible, highest volatility." }
  ]
};

function getItemById(itemId) {
  const allItems = [...CARD_SHOP.tools, ...CARD_SHOP.upgrades, ...CARD_SHOP.services];
  return allItems.find(item => item.id === itemId);
}

function getInvestmentById(assetId) {
  return CARD_SHOP.investments.find(a => a.id === assetId);
}

function getItemsByType(type) {
  return CARD_SHOP[type] || [];
}
