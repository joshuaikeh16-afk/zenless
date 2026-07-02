 const CONFIG = {
  supabase: {
    url: 'https://padybdvevwazfilxopqy.supabase.co',
    key: '936f46f583278e85da0457c6be357fd22b87f63dd4ca1c0',
    table: 'economy_full',
  },
  mongo: {
  apiKey: 'anigamble_secret_123', // same value as API_KEY in anigamble-api/.env
},
  app: {
    name: 'AniGamble HQ',
    tagline: 'Cards · Souvenirs · Coins',
    version: '2.0.0',
  },
  currency: {
    symbol: '🪙',
    name: 'Prime Coins',
  },
  primePoints: {
    symbol: '◈',
    name: 'Prime Points',
    // How many Prime Points = 1 Naira (for cashout)
    ratePerNaira: 100,
  },
  admin: {
    password: 'anigamble2025',
    sessionKey: 'agi_admin_session',
  },
};
 
