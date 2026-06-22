// api/proxy-image.js
// Deploy this file at api/proxy-image.js in your Vercel project root.
// It fetches card art server-side and re-serves it same-origin, so the
// browser never needs CORS headers from the original CDN at all.
//
// Usage from the front end:
//   /api/proxy-image?url=<encodeURIComponent(originalImageUrl)>

const ALLOWED_HOSTS = [
  'cdn7.mazoku.cc',
  // Add any other card-art CDNs you use here.
];

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    res.status(400).send('Missing url parameter');
    return;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).send('Invalid url parameter');
    return;
  }

  // Only proxy known image hosts — don't turn this into an open relay.
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    res.status(403).send('Host not allowed');
    return;
  }

  try {
    const upstream = await fetch(parsed.toString());
    if (!upstream.ok) {
      res.status(upstream.status).send(`Upstream error: ${upstream.status}`);
      return;
    }

    const buffer = await upstream.arrayBuffer();
    const contentType = upstream.headers.get('content-type') || 'image/webp';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Cache aggressively at the edge/CDN — card art rarely changes.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    console.error('[proxy-image]', err);
    res.status(502).send('Failed to fetch upstream image');
  }
}
