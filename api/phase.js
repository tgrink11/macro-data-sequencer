// api/phase.js — Server-side macro phase API.
//
// Replicates the indicator/score/breadth/phase logic from the dashboard
// frontend (index.html) so that other applications can consume the
// computed regime classification cross-origin. The frontend continues to
// compute its own phase in the browser; this route is purely additive.
//
// CORS is wide-open (Access-Control-Allow-Origin: *) so the 8900 Quant
// portal and any other authorized consumer can call it directly.
//
// CDN-cached for 1 hour (s-maxage=3600) and browser-cached for 5 minutes,
// matching the existing /api/fred and /api/fmp routes.

// ─── SERIES CONFIG (mirrors index.html SERIES_CONFIG, post-cleanup) ──────────
const SERIES_CONFIG = [
  // US (12)
  { id: 'PERMIT',                name: 'Building Permits YoY %',           units: 'pc1', inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'HOUST',                 name: 'Housing Starts YoY %',             units: 'pc1', inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'GACDFSA066MSFRBPHI',    name: 'Philly Fed Manufacturing DI',      units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'ICSA',                  name: 'Initial Jobless Claims (000s)',    units: null,  inverse: true,  macro: 'growth',    weight: 1.5, frequency: 'm', aggregation_method: 'eop' },
  { id: 'UMCSENT',               name: 'Michigan Consumer Sentiment',      units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'UNRATE',                name: 'Unemployment Rate',                units: null,  inverse: true,  macro: 'growth',    weight: 2.0 },
  { id: 'CPIAUCSL',              name: 'CPI All Items YoY %',              units: 'pc1', inverse: false, macro: 'inflation', weight: 2.0 },
  { id: 'CPILFESL',              name: 'Core CPI (Ex Food & Energy) YoY %', units: 'pc1', inverse: false, macro: 'inflation', weight: 2.0 },
  { id: 'PAYEMS',                name: 'Nonfarm Payrolls YoY %',           units: 'pc1', inverse: false, macro: 'growth',    weight: 2.0 },
  { id: 'RSAFS',                 name: 'Retail Sales YoY %',               units: 'pc1', inverse: false, macro: 'growth',    weight: 2.0 },
  { id: 'INDPRO',                name: 'Industrial Production YoY %',      units: 'pc1', inverse: false, macro: 'growth',    weight: 2.0 },
  { id: 'DGORDER',               name: 'Durable Goods Orders YoY %',       units: 'pc1', inverse: false, macro: 'growth',    weight: 1.5 },
  // UK (3)
  { id: 'CSCICP02GBM460S',       name: 'UK Consumer Confidence (OECD)',    units: null,  inverse: false, macro: 'growth',    weight: 1.0 },
  { id: 'LRHUTTTTGBM156S',       name: 'UK Unemployment Rate',             units: null,  inverse: true,  macro: 'growth',    weight: 1.0 },
  { id: 'GBRLOLITOAASTSAM',      name: 'UK Composite Leading Indicator',   units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  // EU (5)
  { id: 'CSCICP02EZM460S',       name: 'Eurozone Consumer Confidence',     units: null,  inverse: false, macro: 'growth',    weight: 1.0 },
  { id: 'LRHUTTTTDEM156S',       name: 'Germany Unemployment Rate',        units: null,  inverse: true,  macro: 'growth',    weight: 1.0 },
  { id: 'DEULOLITOAASTSAM',      name: 'Germany CLI',                      units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'FRALOLITOAASTSAM',      name: 'France CLI',                       units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'CP0000EZ19M086NEST',    name: 'Eurozone HICP YoY',                units: null,  inverse: false, macro: 'inflation', weight: 1.0 },
  // Japan (3)
  { id: 'JPNLOLITOAASTSAM',      name: 'Japan CLI',                        units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'CSCICP02JPM460S',       name: 'Japan Consumer Confidence',        units: null,  inverse: false, macro: 'growth',    weight: 1.0 },
  { id: 'LRHUTTTTJPM156S',       name: 'Japan Unemployment Rate',          units: null,  inverse: true,  macro: 'growth',    weight: 1.0 },
  // APAC (2)
  { id: 'AUSLOLITOAASTSAM',      name: 'Australia CLI',                    units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'LRHUTTTTAUM156S',       name: 'Australia Unemployment Rate',      units: null,  inverse: true,  macro: 'growth',    weight: 1.0 },
  // LATAM (2)
  { id: 'LRHUTTTTMXM156S',       name: 'Mexico Unemployment Rate',         units: null,  inverse: true,  macro: 'growth',    weight: 1.0 },
  { id: 'BRALOLITOAASTSAM',      name: 'Brazil CLI',                       units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
];

// ─── PHASE PLAYBOOK ──────────────────────────────────────────────────────────
// Standard 4-phase regime → sector / asset mapping. The frontend's
// quadAssets string is intentionally compressed for the small UI cell;
// these are the fuller versions surfaced through the API.
const PHASE_PLAYBOOK = {
  1: {
    code: 'P1',
    name: 'Goldilocks',
    desc: 'Growth accelerating · Inflation decelerating',
    sectors: ['Technology', 'Consumer Discretionary', 'Industrials', 'Communication Services'],
    assets:  ['Equities (Growth)', 'Treasuries (long duration)', 'USD'],
  },
  2: {
    code: 'P2',
    name: 'Reflation',
    desc: 'Growth accelerating · Inflation accelerating',
    sectors: ['Energy', 'Materials', 'Industrials', 'Financials', 'Real Estate'],
    assets:  ['Equities (Cyclicals)', 'Commodities', 'TIPS'],
  },
  3: {
    code: 'P3',
    name: 'Stagflation',
    desc: 'Growth decelerating · Inflation accelerating',
    sectors: ['Energy', 'Healthcare', 'Consumer Staples', 'Utilities'],
    assets:  ['Cash', 'Gold', 'Commodities'],
  },
  4: {
    code: 'P4',
    name: 'Deflation',
    desc: 'Growth decelerating · Inflation decelerating',
    sectors: ['Consumer Staples', 'Utilities', 'Healthcare', 'Real Estate (REITs)'],
    assets:  ['Treasuries', 'Gold', 'Cash'],
  },
  0: {
    code: 'transitional',
    name: 'Transitional',
    desc: 'Mixed signals · Regime transition in progress',
    sectors: ['Defensive blend'],
    assets:  ['Cash', 'Balanced'],
  },
};

// ─── FRED FETCH ──────────────────────────────────────────────────────────────
async function fetchFredSeries(seriesId, units, frequency, aggregation, limit) {
  const FRED_KEY = process.env.FRED_KEY;
  let url = 'https://api.stlouisfed.org/fred/series/observations'
    + `?series_id=${encodeURIComponent(seriesId)}`
    + `&limit=${Math.min(limit || 36, 100)}`
    + '&sort_order=desc'
    + `&api_key=${FRED_KEY}`
    + '&file_type=json';
  if (units) url += `&units=${units}`;
  if (frequency) url += `&frequency=${frequency}`;
  if (aggregation) url += `&aggregation_method=${aggregation}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${r.status} for ${seriesId}`);
  const d = await r.json();
  return (d.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }));
}

// ─── INDICATOR + SCORING (mirrors index.html) ────────────────────────────────
function computeIndicator(config, observations) {
  const obs = [...observations].reverse(); // newest-first → chronological
  const rawValues = obs.map((o) => o.value);
  const dates = obs.map((o) => o.date);
  const n = rawValues.length;
  if (n < 2) return null;

  let yoy, yoyDates;
  if (config.units === 'pc1') {
    yoy = rawValues;
    yoyDates = dates;
  } else {
    yoy = [];
    yoyDates = [];
    for (let i = 12; i < n; i++) {
      yoy.push(rawValues[i] - rawValues[i - 12]);
      yoyDates.push(dates[i]);
    }
  }
  const yn = yoy.length;
  if (yn < 2) return null;

  const seq_latest = yoy[yn - 1];
  const seq_prior = yoy[yn - 2];
  const roc = seq_latest - seq_prior;
  const roc_3m = yn >= 4 ? (yoy[yn - 1] - yoy[yn - 4]) / 3 : roc;

  const seqChanges = [];
  for (let i = 1; i < yn; i++) seqChanges.push(yoy[i] - yoy[i - 1]);
  const meanChg = seqChanges.reduce((s, v) => s + v, 0) / seqChanges.length;
  const roc_std = Math.sqrt(
    seqChanges.reduce((s, v) => s + (v - meanChg) ** 2, 0) / seqChanges.length
  ) || 1;

  const meanYoy = yoy.reduce((s, v) => s + v, 0) / yn;
  const yoy_std = Math.sqrt(yoy.reduce((s, v) => s + (v - meanYoy) ** 2, 0) / yn) || 1;

  const t12 = yoy.slice(Math.max(0, yn - 12));
  const trend_12 = t12.reduce((s, v) => s + v, 0) / t12.length;

  return {
    id: config.id,
    name: config.name,
    macro: config.macro,
    weight: config.weight || 1,
    inverse: config.inverse,
    roc, roc_3m, roc_std, yoy_std,
    seq_latest, seq_prior, trend_12,
    latest_date: yoyDates[yn - 1] || null,
  };
}

function computeScore(d) {
  const inv = d.inverse ? -1 : 1;
  const std = d.roc_std && d.roc_std > 0 ? d.roc_std : 1;
  const yoyStd = d.yoy_std && d.yoy_std > 0 ? d.yoy_std : 1;
  let score = 0;
  let components = 0;
  if (d.roc_3m !== null && d.roc_3m !== undefined) {
    const z = (d.roc_3m * inv * Math.sqrt(3)) / std;
    score += Math.max(-2.5, Math.min(2.5, z * 1.5));
    components++;
  }
  if (d.roc !== null && d.roc !== undefined) {
    const z = (d.roc * inv) / std;
    score += Math.max(-1.5, Math.min(1.5, z * 1.0));
    components++;
  }
  if (d.seq_latest !== null && d.trend_12 !== null) {
    const z = ((d.seq_latest - d.trend_12) * inv) / yoyStd;
    score += Math.max(-1.0, Math.min(1.0, z * 0.5));
    components++;
  }
  return components > 0 ? score : 0;
}

// For inflation indicators, accelerating = bearish for markets — so we
// flip the sign of the raw acceleration score when reporting market
// direction (bullish/bearish). Growth indicators pass through unchanged.
function marketSign(d) {
  return d.macro === 'inflation' ? -1 : 1;
}

function isAccelerating(d) {
  const inv = d.inverse ? -1 : 1;
  const std = d.roc_std && d.roc_std > 0 ? d.roc_std : 1;
  let z;
  if (d.roc_3m !== null && d.roc_3m !== undefined) {
    z = (d.roc_3m * inv * Math.sqrt(3)) / std;
  } else if (d.roc !== null && d.roc !== undefined) {
    z = (d.roc * inv) / std;
  } else {
    z = 0;
  }
  return z > 0.1;
}

function determinePhase(growthBreadth, inflBreadth) {
  const gUp = growthBreadth > 0.55;
  const gDn = growthBreadth < 0.45;
  const iUp = inflBreadth > 0.55;
  // Note: iDn is only relevant for distinguishing P1/P4 from transitional;
  // the if-chain below handles both cases through the !iUp branch.
  if (gUp && !iUp) return 1;
  if (gUp && iUp) return 2;
  if (gDn && iUp) return 3;
  if (gDn && !iUp) return 4;
  return 0;
}

function directionLabel(breadth) {
  if (breadth > 0.55) return 'Accelerating';
  if (breadth < 0.45) return 'Decelerating';
  return 'Mixed';
}

// ─── HANDLER ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — wide open for cross-origin consumers (8900 Quant, etc.)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.FRED_KEY) {
    return res.status(500).json({ error: 'FRED_KEY not configured' });
  }

  try {
    // Fetch all 27 series in parallel; tolerate per-series failures.
    const settled = await Promise.all(
      SERIES_CONFIG.map((c) =>
        fetchFredSeries(c.id, c.units, c.frequency, c.aggregation_method, 36)
          .then((obs) => ({ cfg: c, obs }))
          .catch((err) => ({ cfg: c, obs: [], error: err.message }))
      )
    );

    const indicators = [];
    const failed = [];
    for (const r of settled) {
      if (r.error) {
        failed.push({ id: r.cfg.id, error: r.error });
        continue;
      }
      const d = computeIndicator(r.cfg, r.obs);
      if (d) indicators.push(d);
      else failed.push({ id: r.cfg.id, error: 'insufficient observations' });
    }

    if (indicators.length === 0) {
      return res.status(500).json({ error: 'No indicators computed', failed });
    }

    const scored = indicators.map((d) => ({ ...d, score: computeScore(d) }));
    const growth = scored.filter((d) => d.macro === 'growth');
    const inflation = scored.filter((d) => d.macro === 'inflation');

    const gAccel = growth.filter(isAccelerating);
    const iAccel = inflation.filter(isAccelerating);
    const gWeightTotal = growth.reduce((s, d) => s + (d.weight || 1), 0);
    const gAccelWeight = gAccel.reduce((s, d) => s + (d.weight || 1), 0);
    const iWeightTotal = inflation.reduce((s, d) => s + (d.weight || 1), 0);
    const iAccelWeight = iAccel.reduce((s, d) => s + (d.weight || 1), 0);
    const growthBreadth = gWeightTotal > 0 ? gAccelWeight / gWeightTotal : 0.5;
    const inflBreadth   = iWeightTotal > 0 ? iAccelWeight / iWeightTotal : 0.5;

    const phaseNum = determinePhase(growthBreadth, inflBreadth);
    const phase = PHASE_PLAYBOOK[phaseNum];

    function signal(d) {
      const marketScore = d.score * marketSign(d);
      return {
        name: d.name,
        score: parseFloat(d.score.toFixed(2)),
        direction: marketScore > 0 ? 'bullish' : marketScore < 0 ? 'bearish' : 'neutral',
      };
    }

    // Top signals: rank by absolute z-scored score, take top 5 per axis.
    const topGrowth = growth
      .slice()
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 5)
      .map(signal);
    const topInflation = inflation
      .slice()
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, 5)
      .map(signal);

    res.setHeader('Cache-Control', 's-maxage=3600, max-age=300');
    return res.status(200).json({
      phase: phase.code,
      phase_name: phase.name,
      growth_breadth: Math.round(growthBreadth * 100),
      inflation_breadth: Math.round(inflBreadth * 100),
      growth_direction: directionLabel(growthBreadth),
      inflation_direction: directionLabel(inflBreadth),
      transitional: phaseNum === 0,
      top_growth_signals: topGrowth,
      top_inflation_signals: topInflation,
      best_sectors: phase.sectors,
      best_assets: phase.assets,
      // phase_since requires persistent state to track regime flips. Not
      // available in this stack (no DB). Returning null until persistence
      // is wired up; consumers should treat as "unknown."
      phase_since: null,
      last_updated: new Date().toISOString(),
      // Diagnostics: surface any series that failed so consumers can
      // judge how complete the breadth calculation was.
      meta: {
        indicators_used: indicators.length,
        indicators_total: SERIES_CONFIG.length,
        failed_series: failed,
        growth_count: growth.length,
        inflation_count: inflation.length,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
