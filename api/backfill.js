// api/backfill.js — One-off historical backfill of phase_history.
//
// Reconstructs the regime for each date in [start, end] stepping by `interval`
// days, using FRED point-in-time VINTAGE data (see _phasecore fetchFredSeries
// asOf), and upserts one row per date. Idempotent — snapshot_date is the PK, so
// re-running overwrites rather than duplicates, and it never disturbs the daily
// live snapshot.
//
// Chunked to stay within the function time limit: processes at most `max` dates
// per call and returns `next_start` so the caller can continue.
//
// Query params (all optional):
//   start     YYYY-MM-DD  (default 2026-01-06)
//   end       YYYY-MM-DD  (default today, UTC)
//   interval  days between snapshots (default 7)
//   max       max dates to process this call (default 12)
//
// Auth: same CRON_SECRET bearer as the daily snapshot.

import { fetchAllVintage, computePhaseAsOf } from './_phasecore.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  const RAW_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!RAW_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' });
  }
  let SUPABASE_URL = RAW_URL.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(SUPABASE_URL)) SUPABASE_URL = 'https://' + SUPABASE_URL;

  const start = (req.query.start || '2026-01-06').slice(0, 10);
  const end = (req.query.end || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const stepDays = Math.max(1, parseInt(req.query.interval) || 7);
  const cap = Math.max(1, Math.min(parseInt(req.query.max) || 60, 400));

  const endT = new Date(end + 'T00:00:00Z').getTime();
  const dates = [];
  let t = new Date(start + 'T00:00:00Z').getTime();
  while (t <= endT && dates.length < cap) {
    dates.push(new Date(t).toISOString().slice(0, 10));
    t += stepDays * 86400000;
  }
  const next_start = t <= endT ? new Date(t).toISOString().slice(0, 10) : null;

  // Fetch every series' full vintage history ONCE, then reconstruct each date in
  // memory — ~17 FRED calls total regardless of how many dates we backfill.
  let vintage;
  try {
    vintage = await fetchAllVintage(dates[0], dates[dates.length - 1]);
  } catch (e) {
    return res.status(502).json({ error: `Vintage fetch failed: ${e.message}` });
  }

  const results = [];
  for (const asOf of dates) {
    try {
      const p = computePhaseAsOf(vintage, asOf);
      const row = {
        snapshot_date: asOf,
        phase_num: p.phase_num, phase: p.phase, phase_name: p.phase_name,
        growth_breadth: p.growth_breadth, inflation_breadth: p.inflation_breadth,
        growth_direction: p.growth_direction, inflation_direction: p.inflation_direction,
        conviction: p.conviction, conviction_label: p.conviction_label,
        transition_risk: p.transition_risk, hurst: p.hurst, trend_r2: p.trend_r2,
        updated_at: new Date().toISOString(),
      };
      const w = await fetch(`${SUPABASE_URL}/rest/v1/phase_history?on_conflict=snapshot_date`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify([row]),
      });
      results.push({
        date: asOf, phase: p.phase, g: p.growth_breadth, i: p.inflation_breadth,
        conv: p.conviction, written: w.ok, status: w.status,
        used: p.meta.indicators_used + '+' + p.meta.quarterly_used,
      });
    } catch (e) {
      results.push({ date: asOf, error: e.message });
    }
  }

  return res.status(200).json({ processed: results.length, next_start, results });
}
