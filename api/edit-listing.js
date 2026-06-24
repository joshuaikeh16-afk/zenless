export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { groupId, sellerId, listingIndex, newPrice } = req.body;

  // Fetch listings, update price, save back
  const getRes = await fetch(
    `http://jobs.hidencloud.com:24633/api/economy/shop/${encodeURIComponent(groupId)}`,
    { headers: { 'x-api-key': '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0' } }
  );
  const listings = await getRes.json();
  const idx = listingIndex - 1;

  if (idx < 0 || idx >= listings.length)
    return res.status(400).json({ success: false, message: '❌ Invalid listing.' });
  if (listings[idx].sellerId !== sellerId)
    return res.status(403).json({ success: false, message: '❌ Not your listing.' });

  listings[idx].price = newPrice;

  const patchRes = await fetch(
    `http://jobs.hidencloud.com:24633/api/economy/raw`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0',
      },
      body: JSON.stringify({ __shop: listings }),
    }
  );
  const data = await patchRes.json();
  res.status(200).json({ success: true });
}
