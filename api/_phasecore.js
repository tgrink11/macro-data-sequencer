// api/_phasecore.js — Shared server-side macro-phase computation.
//
// The underscore prefix keeps Vercel from treating this as its own route.
// Both api/phase.js (public JSON) and api/snapshot.js (daily cron → Supabase)
// import computePhase() from here so the API and the stored history can never
// drift from each other — or from the dashboard's logic in index.html.
//
// Mirrors index.html: US-only monthly diffusion table + quarterly hard-data
// blend + fractal (Hurst / trend-R²) conviction overlay.

// ─── MONTHLY SERIES (US-only, mirrors index.html SERIES_CONFIG) ──────────────
const SERIES_CONFIG = [
  { id: 'PERMIT',             name: 'Building Permits YoY %',            units: 'pc1', inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'HOUST',              name: 'Housing Starts YoY %',              units: 'pc1', inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'GACDFSA066MSFRBPHI', name: 'Philly Fed Manufacturing DI',       units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'ICSA',               name: 'Initial Jobless Claims (000s)',     units: null,  inverse: true,  macro: 'growth',    weight: 1.5, frequency: 'm', aggregation_method: 'eop' },
  { id: 'UMCSENT',            name: 'Michigan Consumer Sentiment',       units: null,  inverse: false, macro: 'growth',    weight: 1.5 },
  { id: 'UNRATE',             name: 'Unemployment Rate',                 units: null,  inverse: true,  macro: 'growth',    weight: 2.0 },
  { id: 'CPIAUCSL',           name: 'CPI All Items YoY %',               units: 'pc1', inverse: false, macro: 'inflation', weight: 2.0 },
  { id: 'CPILFESL',           name: 'Core CPI (Ex Food & Energy) YoY %', units: 'pc1', inverse: false, macro: 'inflation', weight: 2.0 },
  { id: 'PAYEMS',             name: 'Nonfarm Payrolls YoY %',            units: 'pc1', inverse: false, macro: 'growth',    weight: 2.0 },
  { id: 'RSAFS',              name: 'Retail Sales YoY %',                units: 'pc1', inverse: false, macro: 'growth',    weight: 2.0 },
  { id: 'INDPRO',             name: 'Industrial Production YoY %',       units: 'pc1', inverse: false, macro: 'growth',    weight: 2.0 },
  { id: 'DGORDER',            name: 'Durable Goods Orders YoY %',        units: 'pc1', inverse: false, macro: 'growth',    weight: 1.5 },
];

// ─── QUARTERLY HARD DATA (mirrors index.html QUARTERLY_CONFIG) ───────────────
const QUARTERLY_CONFIG = [
  { id: 'GDPC1',           name: 'Real GDP',              macro: 'growth',    inverse: false, weight: 2.0, limit: 44 },
  { id: 'PCECC96',         name: 'Real PCE',              macro: 'growth',    inverse: false, weight: 1.5, limit: 44 },
  { id: 'A261RX1Q020SBEA', name: 'Real GDI',              macro: 'growth',    inverse: false, weight: 1.5, limit: 44 },
  { id: 'ECIALLCIV',       name: 'Employment Cost Index', macro: 'inflation', inverse: false, weight: 1.5, limit: 44 },
  { id: 'PCEPILFE',        name: 'Core PCE Price Index',  macro: 'inflation', inverse: false, weight: 2.0, limit: 44, frequency: 'q', aggregation_method: 'eop' },
];

const PHASE_PLAYBOOK = {
  1: { code: 'P1', name: 'Goldilocks',   desc: 'Growth accelerating · Inflation decelerating', sectors: ['Technology', 'Consumer Discretionary', 'Industrials', 'Communication Services'], assets: ['Equities (Growth)', 'Treasuries (long duration)', 'USD'] },
  2: { code: 'P2', name: 'Reflation',    desc: 'Growth accelerating · Inflation accelerating', sectors: ['Energy', 'Materials', 'Industrials', 'Financials', 'Real Estate'], assets: ['Equities (Cyclicals)', 'Commodities', 'TIPS'] },
  3: { code: 'P3', name: 'Stagflation',  desc: 'Growth decelerating · Inflation accelerating', sectors: ['Energy', 'Healthcare', 'Consumer Staples', 'Utilities'], assets: ['Cash', 'Gold', 'Commodities'] },
  4: { code: 'P4', name: 'Deflation',    desc: 'Growth decelerating · Inflation decelerating', sectors: ['Consumer Staples', 'Utilities', 'Healthcare', 'Real Estate (REITs)'], assets: ['Treasuries', 'Gold', 'Cash'] },
  0: { code: 'transitional', name: 'Transitional', desc: 'Mixed signals · Regime transition in progress', sectors: ['Defensive blend'], assets: ['Cash', 'Balanced'] },
};

// ─── FRED FETCH ──────────────────────────────────────────────────────────────
// asOf (YYYY-MM-DD, optional): request FRED's point-in-time VINTAGE — the series
// exactly as it was published on that date (realtime_start=realtime_end=asOf),
// capped to observations through asOf. This makes historical backfills honest:
// both data revisions and release lags are respected (e.g. a value not yet
// released as of asOf simply won't appear). Omit asOf for the latest data.
async function fetchFredSeries(seriesId, units, frequency, aggregation, limit, asOf) {
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
  if (asOf) url += `&realtime_start=${asOf}&realtime_end=${asOf}&observation_end=${asOf}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${r.status} for ${seriesId}`);
  const d = await r.json();
  return (d.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: parseFloat(o.value) }));
}

// ─── MONTHLY INDICATOR + SCORING (mirrors index.html) ────────────────────────
function computeIndicator(config, observations) {
  const obs = [...observations].reverse();
  const rawValues = obs.map((o) => o.value);
  const dates = obs.map((o) => o.date);
  const n = rawValues.length;
  if (n < 2) return null;

  let yoy, yoyDates;
  if (config.units === 'pc1') {
    yoy = rawValues; yoyDates = dates;
  } else {
    yoy = []; yoyDates = [];
    for (let i = 12; i < n; i++) { yoy.push(rawValues[i] - rawValues[i - 12]); yoyDates.push(dates[i]); }
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
  const roc_std = Math.sqrt(seqChanges.reduce((s, v) => s + (v - meanChg) ** 2, 0) / seqChanges.length) || 1;

  const meanYoy = yoy.reduce((s, v) => s + v, 0) / yn;
  const yoy_std = Math.sqrt(yoy.reduce((s, v) => s + (v - meanYoy) ** 2, 0) / yn) || 1;

  const t12 = yoy.slice(Math.max(0, yn - 12));
  const trend_12 = t12.reduce((s, v) => s + v, 0) / t12.length;

  return {
    id: config.id, name: config.name, macro: config.macro, weight: config.weight || 1,
    inverse: config.inverse, roc, roc_3m, roc_std, yoy_std,
    seq_latest, seq_prior, trend_12, yoy_full: yoy.slice(),
    latest_date: yoyDates[yn - 1] || null,
  };
}

function computeScore(d) {
  const inv = d.inverse ? -1 : 1;
  const std = d.roc_std && d.roc_std > 0 ? d.roc_std : 1;
  const yoyStd = d.yoy_std && d.yoy_std > 0 ? d.yoy_std : 1;
  let score = 0, components = 0;
  if (d.roc_3m !== null && d.roc_3m !== undefined) { const z = (d.roc_3m * inv * Math.sqrt(3)) / std; score += Math.max(-2.5, Math.min(2.5, z * 1.5)); components++; }
  if (d.roc !== null && d.roc !== undefined)       { const z = (d.roc * inv) / std;                  score += Math.max(-1.5, Math.min(1.5, z * 1.0)); components++; }
  if (d.seq_latest !== null && d.trend_12 !== null){ const z = ((d.seq_latest - d.trend_12) * inv) / yoyStd; score += Math.max(-1.0, Math.min(1.0, z * 0.5)); components++; }
  return components > 0 ? score : 0;
}

function marketSign(d) { return d.macro === 'inflation' ? -1 : 1; }

function isAccelerating(d) {
  const inv = d.inverse ? -1 : 1;
  const std = d.roc_std && d.roc_std > 0 ? d.roc_std : 1;
  let z;
  if (d.roc_3m !== null && d.roc_3m !== undefined) z = (d.roc_3m * inv * Math.sqrt(3)) / std;
  else if (d.roc !== null && d.roc !== undefined) z = (d.roc * inv) / std;
  else z = 0;
  return z > 0.1;
}

// ─── QUARTERLY (QoQ SAAR) ────────────────────────────────────────────────────
function computeQuarterly(config, observations) {
  const obs = [...observations].reverse();
  const vals = obs.map((o) => o.value);
  const n = vals.length;
  if (n < 6) return null;
  const saar = (a, b) => (b !== null && b > 0) ? (Math.pow(a / b, 4) - 1) * 100 : null;
  const qoq_saar = saar(vals[n - 1], vals[n - 2]);
  const qoq_saar_prior = saar(vals[n - 2], vals[n - 3]);
  const accel = (qoq_saar !== null && qoq_saar_prior !== null) ? qoq_saar - qoq_saar_prior : null;
  return {
    id: config.id, name: config.name, macro: config.macro,
    inverse: !!config.inverse, weight: config.weight || 1,
    qoq_saar, accel,
  };
}
function qAccelerating(d) {
  if (d.accel === null || d.accel === undefined) return false;
  const dir = d.inverse ? -1 : 1;
  return d.accel * dir > 0.1;
}

// ─── FRACTAL CONVICTION (Hurst + trend R²; mirrors index.html) ───────────────
function _linReg(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, r2: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0, ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den > 0 ? num / den : 0, intercept = my - slope * mx;
  for (let i = 0; i < n; i++) { const p = slope * xs[i] + intercept; ssRes += (ys[i] - p) ** 2; ssTot += (ys[i] - my) ** 2; }
  return { slope, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}
function _rescaledRange(series) {
  const n = series.length;
  if (n < 2) return 0;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  const dev = series.map((x) => x - mean);
  let s = 0; const cum = [];
  for (const d of dev) { s += d; cum.push(s); }
  const R = Math.max(...cum) - Math.min(...cum);
  const S = Math.sqrt(dev.reduce((a, d) => a + d * d, 0) / n);
  return S > 0 ? R / S : 0;
}
function computeHurstSeries(series, minWindow = 6) {
  if (!series || series.length < minWindow * 2 + 1) return 0.5;
  const d = [];
  for (let i = 1; i < series.length; i++) d.push(series[i] - series[i - 1]);
  if (d.length < minWindow * 2) return 0.5;
  const sizes = [];
  let sz = minWindow;
  while (sz <= Math.floor(d.length / 2)) { sizes.push(sz); sz = Math.floor(sz * 1.5); }
  if (sizes.length < 3) return 0.5;
  const logN = [], logRS = [];
  for (const size of sizes) {
    const blocks = Math.floor(d.length / size);
    let rsSum = 0, c = 0;
    for (let b = 0; b < blocks; b++) { const rs = _rescaledRange(d.slice(b * size, (b + 1) * size)); if (rs > 0) { rsSum += rs; c++; } }
    if (c > 0) { logN.push(Math.log(size)); logRS.push(Math.log(rsSum / c)); }
  }
  if (logN.length < 3) return 0.5;
  const { slope: H } = _linReg(logN, logRS);
  return Math.max(0, Math.min(1, H));
}
function regimeGeometry(rows) {
  let wSum = 0, hSum = 0, rSum = 0, k = 0;
  for (const d of rows) {
    const s = d.yoy_full;
    if (!s || s.length < 14) continue;
    const w = d.weight || 1;
    hSum += computeHurstSeries(s) * w;
    rSum += _linReg(s.map((_, i) => i), s).r2 * w;
    wSum += w; k++;
  }
  if (!k) return null;
  return { H: hSum / wSum, r2: rSum / wSum, count: k };
}
function convictionFromGeo(geo) {
  if (!geo) return { score: null, label: '—', risk: '—' };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const persistence = clamp01((geo.H - 0.40) / 0.20);
  const cleanTrend = clamp01(geo.r2);
  const score = Math.round(100 * (0.55 * persistence + 0.45 * cleanTrend));
  const label = score >= 66 ? 'HIGH' : score >= 40 ? 'MODERATE' : 'LOW';
  let risk;
  if (geo.H < 0.45 || geo.r2 < 0.25) risk = 'ELEVATED';
  else if (geo.H > 0.55 && geo.r2 > 0.50) risk = 'LOW';
  else risk = 'MODERATE';
  return { score, label, risk };
}

function determinePhase(growthBreadth, inflBreadth) {
  const gUp = growthBreadth > 0.55, gDn = growthBreadth < 0.45, iUp = inflBreadth > 0.55;
  if (gUp && !iUp) return 1;
  if (gUp && iUp) return 2;
  if (gDn && iUp) return 3;
  if (gDn && !iUp) return 4;
  return 0;
}
function directionLabel(b) { return b > 0.55 ? 'Accelerating' : b < 0.45 ? 'Decelerating' : 'Mixed'; }

// ─── TOP-LEVEL: fetch everything, return the full regime object ──────────────
export async function computePhase(asOf) {
  if (!process.env.FRED_KEY) throw new Error('FRED_KEY not configured');
  const monthlySettled = await Promise.all(
    SERIES_CONFIG.map((c) =>
      fetchFredSeries(c.id, c.units, c.frequency, c.aggregation_method, 36, asOf)
        .then((obs) => ({ cfg: c, obs })).catch((err) => ({ cfg: c, obs: [], error: err.message }))
    )
  );
  const quarterlySettled = await Promise.all(
    QUARTERLY_CONFIG.map((c) =>
      fetchFredSeries(c.id, null, c.frequency, c.aggregation_method, c.limit, asOf)
        .then((obs) => ({ cfg: c, obs })).catch((err) => ({ cfg: c, obs: [], error: err.message }))
    )
  );
  return assemblePhase(monthlySettled, quarterlySettled);
}

// Assemble the regime object from already-fetched observations (live or vintage).
function assemblePhase(monthlySettled, quarterlySettled) {
  const indicators = [], failed = [];
  for (const r of monthlySettled) {
    if (r.error) { failed.push({ id: r.cfg.id, error: r.error }); continue; }
    const d = computeIndicator(r.cfg, r.obs);
    if (d) indicators.push(d); else failed.push({ id: r.cfg.id, error: 'insufficient observations' });
  }
  if (indicators.length === 0) throw new Error('No indicators computed');

  const quarterly = [];
  for (const r of quarterlySettled) {
    if (r.error) { failed.push({ id: r.cfg.id, error: r.error }); continue; }
    const d = computeQuarterly(r.cfg, r.obs);
    if (d) quarterly.push(d); else failed.push({ id: r.cfg.id, error: 'insufficient quarterly observations' });
  }

  const scored = indicators.map((d) => ({ ...d, score: computeScore(d) }));
  const growth = scored.filter((d) => d.macro === 'growth');
  const inflation = scored.filter((d) => d.macro === 'inflation');
  const qGrowth = quarterly.filter((d) => d.macro === 'growth' && d.accel !== null);
  const qInfl = quarterly.filter((d) => d.macro === 'inflation' && d.accel !== null);
  const sumW = (arr) => arr.reduce((s, d) => s + (d.weight || 1), 0);

  // Weighted breadth = monthly diffusion + quarterly hard-data blend.
  const gWeightTotal = sumW(growth) + sumW(qGrowth);
  const gAccelWeight = sumW(growth.filter(isAccelerating)) + sumW(qGrowth.filter(qAccelerating));
  const iWeightTotal = sumW(inflation) + sumW(qInfl);
  const iAccelWeight = sumW(inflation.filter(isAccelerating)) + sumW(qInfl.filter(qAccelerating));
  const growthBreadth = gWeightTotal > 0 ? gAccelWeight / gWeightTotal : 0.5;
  const inflBreadth = iWeightTotal > 0 ? iAccelWeight / iWeightTotal : 0.5;

  const phaseNum = determinePhase(growthBreadth, inflBreadth);
  const phase = PHASE_PLAYBOOK[phaseNum];

  const conv = convictionFromGeo(regimeGeometry(scored));

  function signal(d) {
    const marketScore = d.score * marketSign(d);
    return { name: d.name, score: parseFloat(d.score.toFixed(2)), direction: marketScore > 0 ? 'bullish' : marketScore < 0 ? 'bearish' : 'neutral' };
  }
  const topGrowth = growth.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5).map(signal);
  const topInflation = inflation.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5).map(signal);
  const geo = regimeGeometry(scored);

  return {
    phase: phase.code,
    phase_name: phase.name,
    phase_num: phaseNum,
    growth_breadth: Math.round(growthBreadth * 100),
    inflation_breadth: Math.round(inflBreadth * 100),
    growth_direction: directionLabel(growthBreadth),
    inflation_direction: directionLabel(inflBreadth),
    transitional: phaseNum === 0,
    conviction: conv.score,
    conviction_label: conv.label,
    transition_risk: conv.risk,
    hurst: geo ? parseFloat(geo.H.toFixed(2)) : null,
    trend_r2: geo ? parseFloat(geo.r2.toFixed(2)) : null,
    top_growth_signals: topGrowth,
    top_inflation_signals: topInflation,
    best_sectors: phase.sectors,
    best_assets: phase.assets,
    meta: {
      indicators_used: indicators.length,
      indicators_total: SERIES_CONFIG.length,
      quarterly_used: quarterly.length,
      quarterly_total: QUARTERLY_CONFIG.length,
      failed_series: failed,
      growth_count: growth.length,
      inflation_count: inflation.length,
    },
  };
}

// ─── VINTAGE BACKFILL ────────────────────────────────────────────────────────
// One FRED call per series pulls its FULL point-in-time history across the whole
// [start,end] window; every backfill date is then reconstructed in memory. This
// keeps a many-date backfill at ~17 total FRED calls instead of 17-per-date, so
// it never trips the 120-requests/minute rate limit.

async function fetchVintageRows(seriesId, units, frequency, aggregation, start, end) {
  const FRED_KEY = process.env.FRED_KEY;
  let url = 'https://api.stlouisfed.org/fred/series/observations'
    + `?series_id=${encodeURIComponent(seriesId)}`
    + `&realtime_start=${start}&realtime_end=${end}&observation_end=${end}`
    + '&sort_order=asc&limit=100000'
    + `&api_key=${FRED_KEY}&file_type=json`;
  if (units) url += `&units=${units}`;
  if (frequency) url += `&frequency=${frequency}`;
  if (aggregation) url += `&aggregation_method=${aggregation}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${r.status} for ${seriesId}`);
  const d = await r.json();
  return (d.observations || [])
    .filter((o) => o.value !== '.')
    .map((o) => ({ date: o.date, value: parseFloat(o.value), rt: o.realtime_start }));
}

// Reconstruct a series as it was known on date D (newest-first, matching
// fetchFredSeries output): for each observation date, take the latest vintage
// whose realtime_start <= D; drop observations not yet published as of D.
function seriesAsOf(rows, D) {
  const byDate = new Map();
  for (const row of rows) {
    if (row.rt > D) continue;
    const cur = byDate.get(row.date);
    if (!cur || row.rt > cur.rt) byDate.set(row.date, row);
  }
  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((r) => ({ date: r.date, value: r.value }));
}

// Fetch every series' vintage history once. Returns { monthly: Map, quarterly: Map }.
export async function fetchAllVintage(start, end) {
  if (!process.env.FRED_KEY) throw new Error('FRED_KEY not configured');
  const monthly = new Map(), quarterly = new Map();
  await Promise.all([
    // Always fetch RAW levels here (units=null). FRED's pc1 (YoY) transform is
    // unreliable over a realtime WINDOW, so YoY is computed in code below.
    ...SERIES_CONFIG.map((c) =>
      fetchVintageRows(c.id, null, c.frequency, c.aggregation_method, start, end)
        .then((rows) => monthly.set(c.id, rows)).catch(() => monthly.set(c.id, []))
    ),
    ...QUARTERLY_CONFIG.map((c) =>
      fetchVintageRows(c.id, null, c.frequency, c.aggregation_method, start, end)
        .then((rows) => quarterly.set(c.id, rows)).catch(() => quarterly.set(c.id, []))
    ),
  ]);
  return { monthly, quarterly };
}

// Convert a raw-level series (newest-first) to a YoY %-change series
// (newest-first), matching FRED's pc1 transform so pc1-configured indicators
// behave identically to the live path.
function rawToYoYpct(obsNewestFirst) {
  const chron = [...obsNewestFirst].reverse(); // oldest → newest
  const out = [];
  for (let i = 12; i < chron.length; i++) {
    const base = chron[i - 12].value;
    if (base) out.push({ date: chron[i].date, value: (chron[i].value / base - 1) * 100 });
  }
  return out.reverse(); // back to newest-first
}

// Compute the regime as of date D from pre-fetched vintage data (no FRED calls).
export function computePhaseAsOf(vintage, D) {
  const monthlySettled = SERIES_CONFIG.map((c) => {
    const raw = seriesAsOf(vintage.monthly.get(c.id) || [], D); // raw levels, newest-first
    // pc1 series: derive YoY% from levels; diffusion/rate series: pass raw
    // (computeIndicator computes its own 12-month difference).
    const obs = c.units === 'pc1' ? rawToYoYpct(raw) : raw;
    return { cfg: c, obs };
  });
  const quarterlySettled = QUARTERLY_CONFIG.map((c) => ({ cfg: c, obs: seriesAsOf(vintage.quarterly.get(c.id) || [], D) }));
  return assemblePhase(monthlySettled, quarterlySettled);
}
