// api/snapshot.js — Daily cron: compute the current regime and upsert one row
// per day into Supabase (phase_history). Invoked by the Vercel Cron defined in
// vercel.json. Idempotent — snapshot_date is the primary key, so re-runs on the
// same day overwrite rather than duplicate.
//
// Required env vars (set in Vercel → Settings → Environment Variables):
//   FRED_KEY                     (already set — used by the phase compute)
//   SUPABASE_URL                 e.g. https://dcwidhndyplqzbdhurii.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service_role key (secret — bypasses RLS to write)
//   CRON_SECRET                  any random string; Vercel Cron sends it as a
//                                Bearer token so only the cron can trigger a write

import { computePhase } from './_phasecore.js';

export default async function handler(req, res) {
  // Only the Vercel Cron (which carries the CRON_SECRET bearer) may write.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' });
  }

  try {
    const p = await computePhase();
    const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const row = {
      snapshot_date: today,
      phase_num: p.phase_num,
      phase: p.phase,
      phase_name: p.phase_name,
      growth_breadth: p.growth_breadth,
      inflation_breadth: p.inflation_breadth,
      growth_direction: p.growth_direction,
      inflation_direction: p.inflation_direction,
      conviction: p.conviction,
      conviction_label: p.conviction_label,
      transition_risk: p.transition_risk,
      hurst: p.hurst,
      trend_r2: p.trend_r2,
      updated_at: new Date().toISOString(),
    };

    const r = await fetch(`${SUPABASE_URL}/rest/v1/phase_history?on_conflict=snapshot_date`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([row]),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: `Supabase write failed: ${r.status}`, detail });
    }

    return res.status(200).json({
      ok: true, snapshot_date: today,
      phase: p.phase, phase_name: p.phase_name,
      growth_breadth: p.growth_breadth, inflation_breadth: p.inflation_breadth,
      conviction: p.conviction,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
