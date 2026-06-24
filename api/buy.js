export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { groupId, buyerId, listingIndex } = req.body;

  const response = await fetch(
    `http://jobs.hidencloud.com:24633/api/economy/shop/${encodeURIComponent(groupId)}/buy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0',
      },
      body: JSON.stringify({ buyerId, listingIndex }),
    }
  );

  const data = await response.json();
  res.status(response.status).json(data);
}
