// ════════════════════════════════════════════════════════════════
//  /api/bot-economy/[lid].js  —  Vercel serverless proxy
//
//  The WhatsApp bot's economy API lives at jobs.hidencloud.com over
//  plain http://. Browsers on our https:// site refuse to call that
//  directly ("mixed content"), so the front end (api.js) calls THIS
//  endpoint instead — same origin, https — and this function forwards
//  the request to the bot server-side, where mixed-content rules don't
//  apply (it's just Node making a normal request, not a browser tab).
//
//  Set BOT_ECONOMY_KEY as an environment variable in your Vercel
//  project settings (Project → Settings → Environment Variables) so it
//  doesn't need to ship to the browser at all. The hardcoded value
//  below is just a fallback so this keeps working if you haven't set
//  that yet — swap it out once you have.
// ════════════════════════════════════════════════════════════════

const BOT_ECONOMY_BASE = 'http://jobs.hidencloud.com:24633/api/economy/users';
const BOT_ECONOMY_KEY  = process.env.BOT_ECONOMY_KEY || '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed — use PATCH' });
  }

  const { lid } = req.query;
  if (!lid) {
    return res.status(400).json({ error: 'Missing lid in URL' });
  }

  try {
    const botRes = await fetch(`${BOT_ECONOMY_BASE}/${encodeURIComponent(lid)}`, {
      method: 'PATCH',
      headers: {
        'x-api-key': BOT_ECONOMY_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body || {}),
    });

    const data = await botRes.json().catch(() => null);
    return res.status(botRes.status).json(data);
  } catch (err) {
    console.error('[Bot Economy Proxy Error]', err);
    return res.status(502).json({ error: 'Bot economy server unreachable' });
  }
}
