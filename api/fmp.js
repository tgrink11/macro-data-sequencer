// api/fmp.js — Vercel Serverless proxy for Financial Modeling Prep API
// Supplements FRED with the economic calendar (forward-looking releases) and
// same-day Treasury yields. FRED remains the yield-curve source of record, but
// it publishes each day's curve the NEXT business day; FMP's treasury-rates
// carries Treasury's official daily par curve the same afternoon (~4–6pm ET),
// so the dashboard overlays it on top of FRED when it's newer.
// FMP_KEY stays server-side (env var). CDN-cached 1 hour (treasury: 15 min).

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
    return res.status(400).json({ error: 'type param required (calendar, indicator, treasury)' });
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;

  try {
    let url;
    let maxAge = 3600;

    if (type === 'calendar') {
      url = `https://financialmodelingprep.com/api/v3/economic_calendar?apikey=${FMP_KEY}`;
      if (from && dateRe.test(from)) url += `&from=${from}`;
      if (to && dateRe.test(to)) url += `&to=${to}`;
    } else if (type === 'indicator') {
      if (!name || !/^[A-Za-z_ ]{1,80}$/.test(name)) {
        return res.status(400).json({ error: 'Invalid indicator name' });
      }
      // FMP deprecated /api/v3/economic (returns []). Use the "stable" API.
      url = `https://financialmodelingprep.com/stable/economic-indicators?name=${encodeURIComponent(name)}&apikey=${FMP_KEY}`;
      if (from && dateRe.test(from)) url += `&from=${from}`;
      if (to && dateRe.test(to)) url += `&to=${to}`;
    } else if (type === 'treasury') {
      url = `https://financialmodelingprep.com/stable/treasury-rates?apikey=${FMP_KEY}`;
      if (from && dateRe.test(from)) url += `&from=${from}`;
      if (to && dateRe.test(to)) url += `&to=${to}`;
      maxAge = 900; // Treasury posts once a day; 15 min picks it up promptly
    } else {
      return res.status(400).json({ error: 'Invalid type. Use: calendar, indicator, treasury' });
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
    res.setHeader('Cache-Control', `s-maxage=${maxAge}, max-age=300`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
