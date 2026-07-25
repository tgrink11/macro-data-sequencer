// api/phase.js — Public server-side macro phase API.
//
// Thin handler over api/_phasecore.js so this route, the daily snapshot cron,
// and the dashboard all compute the identical regime. Now US-only with the
// quarterly hard-data blend + fractal conviction (matches index.html).
//
// CORS wide-open so the 8900 Quant portal and other authorized consumers can
// call it cross-origin. CDN-cached 1h, browser-cached 5m.

import { computePhase } from './_phasecore.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const result = await computePhase();
    res.setHeader('Cache-Control', 's-maxage=3600, max-age=300');
    return res.status(200).json({
      ...result,
      // phase_since needs the history table; the daily snapshot (api/snapshot.js)
      // populates it. Consumers wanting "regime start date" can read
      // phase_history in Supabase, or the dashboard's history strip.
      phase_since: null,
      last_updated: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
