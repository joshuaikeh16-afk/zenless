 const CONFIG = {
  supabase: {
    url: 'https://padybdvevwazfilxopqy.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZHliZHZldndhemZpbHhvcHF5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzM5OTgwNCwiZXhwIjoyMDkyOTc1ODA0fQ.bI3epdb6N4T21At5xkAHcJnKbPKUd0-l2vzr4xGZN8w',
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
 
