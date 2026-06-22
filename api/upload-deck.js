// api/upload-deck.js
const Jimp = require('jimp');

const COLS = 3, ROWS = 3;
const TILE_W = 400, TILE_H = 560;
const GAP = 20;
const WIDTH  = COLS * TILE_W + (COLS - 1) * GAP;
const HEIGHT = ROWS * TILE_H + (ROWS - 1) * GAP;
const BG_COLOR = 0x1a1a24ff;

async function fetchImageBuffer(url) {
  // Fetch the raw image bytes directly (server-side — no CORS restriction)
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const arrayBuffer = await r.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { res.status(400).json({ error: 'Invalid JSON' }); return; }

  const { cards, imgbbKey } = body;
  if (!Array.isArray(cards) || cards.length !== 9 || !imgbbKey) {
    res.status(400).json({ error: 'Missing or invalid cards/imgbbKey' }); return;
  }

  // Fetch all card images in parallel directly — no proxy needed server-side
  const images = await Promise.all(cards.map(async card => {
    if (!card?.preRenderedUrl) return null;
    try {
      const buffer = await fetchImageBuffer(card.preRenderedUrl);
      return await Jimp.read(buffer);
    } catch (e) {
      console.error('[upload-deck] Failed:', card.preRenderedUrl, e.message);
      return null;
    }
  }));

  // Composite
  const canvas = new Jimp(WIDTH, HEIGHT, BG_COLOR);
  cards.forEach((card, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = col * (TILE_W + GAP), y = row * (TILE_H + GAP);
    const img = images[i];
    if (img) {
      const scale = Math.max(TILE_W / img.bitmap.width, TILE_H / img.bitmap.height);
      img.scale(scale);
      const cropX = Math.floor((img.bitmap.width  - TILE_W) / 2);
      const cropY = Math.floor((img.bitmap.height - TILE_H) / 2);
      img.crop(cropX, cropY, TILE_W, TILE_H);
      canvas.composite(img, x, y);
    } else if (card) {
      canvas.composite(new Jimp(TILE_W, TILE_H, 0x2a2a3aff), x, y);
    }
  });

  const buffer = await canvas.quality(85).getBufferAsync(Jimp.MIME_JPEG);
  const base64 = buffer.toString('base64');

  const params = new URLSearchParams({ key: imgbbKey, image: base64 });
  const upload = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: params });
  const json = await upload.json();

  console.log('[upload-deck] imgbb response:', JSON.stringify(json));

  if (!json.success || !json.data?.url) {
    res.status(502).json({ error: `imgbb error: ${json?.error?.message || JSON.stringify(json)}` }); return;
  }

  res.status(200).json({ url: json.data.url });
};
