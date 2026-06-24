export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const response = await fetch(
    `http://jobs.hidencloud.com:24633/api/economy/shop/120363424601999307%40g.us`,
    {
      headers: {
        'x-api-key': '936f46f583278e85da40457c6be357fd22b87f63dd4ca1c0',
      },
    }
  );

  const data = await response.json();
  res.status(response.status).json(data);
}
