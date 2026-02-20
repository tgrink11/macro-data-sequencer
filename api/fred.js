// api/fred.js — Vercel Serverless proxy for FRED API
// Solves CORS: browser cannot call api.stlouisfed.org directly.
// CDN-cached for 1 hour. FRED_KEY stays server-side (env var).

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const FRED_KEY = process.env.FRED_KEY;
  if (!FRED_KEY) {
    return res.status(500).json({ error: 'FRED_KEY not configured' });
  }

  const { series, limit = 24, units, observation_start } = req.query;
  if (!series) {
    return res.status(400).json({ error: 'series param required' });
  }

  if (!/^[A-Za-z0-9_]{1,50}$/.test(series)) {
    return res.status(400).json({ error: 'Invalid series ID format' });
  }

  try {
    let url = `https://api.stlouisfed.org/fred/series/observations`
      + `?series_id=${encodeURIComponent(series)}`
      + `&limit=${Math.min(parseInt(limit) || 24, 100)}`
      + `&sort_order=desc`
      + `&api_key=${FRED_KEY}`
      + `&file_type=json`;

    if (units && /^(lin|chg|ch1|pch|pc1|pca|cch|cca|log)$/.test(units)) {
      url += `&units=${units}`;
    }

    if (observation_start && /^\d{4}-\d{2}-\d{2}$/.test(observation_start)) {
      url += `&observation_start=${observation_start}`;
    }

    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `FRED API error: ${response.status}`,
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
