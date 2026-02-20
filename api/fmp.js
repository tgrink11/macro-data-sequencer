// api/fmp.js — Vercel Serverless proxy for Financial Modeling Prep API
// Supplements FRED with treasury yields and economic calendar.
// FMP_KEY stays server-side (env var). CDN-cached 1 hour.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const FMP_KEY = process.env.FMP_KEY;
  if (!FMP_KEY) {
    return res.status(500).json({ error: 'FMP_KEY not configured' });
  }

  const { type, from, to, name } = req.query;
  if (!type) {
    return res.status(400).json({ error: 'type param required (calendar, treasury, indicator)' });
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;

  try {
    let url;

    if (type === 'calendar') {
      url = `https://financialmodelingprep.com/api/v3/economic_calendar?apikey=${FMP_KEY}`;
      if (from && dateRe.test(from)) url += `&from=${from}`;
      if (to && dateRe.test(to)) url += `&to=${to}`;
    } else if (type === 'treasury') {
      url = `https://financialmodelingprep.com/api/v4/treasury?apikey=${FMP_KEY}`;
      if (from && dateRe.test(from)) url += `&from=${from}`;
      if (to && dateRe.test(to)) url += `&to=${to}`;
    } else if (type === 'indicator') {
      if (!name || !/^[A-Za-z_ ]{1,80}$/.test(name)) {
        return res.status(400).json({ error: 'Invalid indicator name' });
      }
      url = `https://financialmodelingprep.com/api/v3/economic?name=${encodeURIComponent(name)}&apikey=${FMP_KEY}`;
    } else {
      return res.status(400).json({ error: 'Invalid type. Use: calendar, treasury, indicator' });
    }

    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `FMP API error: ${response.status}`,
        detail: errText
      });
    }

    const data = await response.json();
    res.setHeader('Cache-Control', 's-maxage=3600, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
