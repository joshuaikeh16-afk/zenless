// api/upload-deck.js
// Deploy at api/upload-deck.js in your Vercel project.
// Composites a 3x3 deck grid server-side using Jimp (pure JS, no native deps),
// uploads the result to imgbb, and returns the single URL.
//
// POST /api/upload-deck
// Body (JSON): { cards: [{name, preRenderedUrl}|null, ...] (length 9), imgbbKey: string }
// Returns (JSON): { url: string }

const Jimp = require('jimp');

const COLS = 3, ROWS = 3;
const TILE_W = 400, TILE_H = 560; // 5:7 ratio
const GAP = 20;
const WIDTH  = COLS * TILE_W + (COLS - 1) * GAP;
const HEIGHT = ROWS * TILE_H + (ROWS - 1) * GAP;
const BG_COLOR = 0x1a1a24ff;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { res.status(400).json({ error: 'Invalid JSON' }); return; }

  const { cards, imgbbKey } = body;
  if (!Array.isArray(cards) || cards.length !== 9 || !imgbbKey) {
    res.status(400).json({ error: 'Missing or invalid cards/imgbbKey' }); return;
  }

  // Fetch all card images in parallel
  const images = await Promise.all(cards.map(async card => {
    if (!card?.preRenderedUrl) return null;
    try {
      return await Jimp.read(card.preRenderedUrl);
    } catch {
      return null;
    }
  }));

  // Create canvas
  const canvas = new Jimp(WIDTH, HEIGHT, BG_COLOR);

  cards.forEach((card, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = col * (TILE_W + GAP), y = row * (TILE_H + GAP);
    const img = images[i];

    if (img) {
      // Cover-fit: scale so image fills tile, crop center
      const scaleX = TILE_W / img.bitmap.width;
      const scaleY = TILE_H / img.bitmap.height;
      const scale  = Math.max(scaleX, scaleY);
      img.scale(scale);

      const cropX = Math.floor((img.bitmap.width  - TILE_W) / 2);
      const cropY = Math.floor((img.bitmap.height - TILE_H) / 2);
      img.crop(cropX, cropY, TILE_W, TILE_H);

      canvas.composite(img, x, y);
    } else if (card) {
      // Placeholder tile for missing art
      const placeholder = new Jimp(TILE_W, TILE_H, 0x2a2a3aff);
      canvas.composite(placeholder, x, y);
    }
  });

  // Encode to PNG buffer and upload to imgbb as base64
  const buffer = await canvas.getBufferAsync(Jimp.MIME_PNG);
  const base64 = buffer.toString('base64');

  const params = new URLSearchParams({ key: imgbbKey, image: base64 });
  const upload = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: params });

  if (!upload.ok) {
    res.status(502).json({ error: `imgbb upload failed: ${upload.status}` }); return;
  }

  const json = await upload.json();
  if (!json.success || !json.data?.url) {
    res.status(502).json({ error: 'imgbb returned no URL' }); return;
  }

  res.status(200).json({ url: json.data.url });
};
