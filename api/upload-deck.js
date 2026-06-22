// api/upload-deck.js
// POST /api/upload-deck
// Body: { cards: [{name, preRenderedUrl}|null, ...] (length 9), imgbbKey: string }
// Returns: { urls: [string|null, ...] } — one imgbb URL per slot (null if no card or fetch failed)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { res.status(400).json({ error: 'Invalid JSON' }); return; }

  const { cards, imgbbKey } = body;
  if (!Array.isArray(cards) || !imgbbKey) {
    res.status(400).json({ error: 'Missing cards or imgbbKey' }); return;
  }

  // Upload each card image to imgbb by URL — imgbb fetches it server-side, no CORS
  const urls = await Promise.all(cards.map(async card => {
    if (!card?.preRenderedUrl) return null;
    try {
      const params = new URLSearchParams({ key: imgbbKey, image: card.preRenderedUrl });
      const r = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: params });
      const j = await r.json();
      return j?.data?.url || null;
    } catch {
      return null;
    }
  }));

  res.status(200).json({ urls });
};
