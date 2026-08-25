/**
 * WALLET · Statistiques de base
 * Fonctions pures, sans dépendance : elles tournent aussi bien dans le
 * navigateur que dans les Edge Functions Deno et dans les tests Node.
 */

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function clean(values) {
  return (values || []).filter(isNum);
}

export function sum(values) {
  return clean(values).reduce((a, b) => a + b, 0);
}

export function mean(values) {
  const v = clean(values);
  return v.length ? sum(v) / v.length : null;
}

export function median(values) {
  const v = clean(values).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function quantile(values, q) {
  const v = clean(values).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function stdev(values) {
  const v = clean(values);
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(sum(v.map((x) => (x - m) ** 2)) / (v.length - 1));
}

/**
 * Median Absolute Deviation. Préférée à l'écart-type pour la détection
 * d'anomalies : elle ne se laisse pas gonfler par les valeurs extrêmes
 * qu'on cherche justement à repérer.
 */
export function mad(values) {
  const v = clean(values);
  if (!v.length) return null;
  const m = median(v);
  return median(v.map((x) => Math.abs(x - m)));
}

/** Score robuste type z-score, basé médiane/MAD. */
export function robustScore(value, values) {
  const m = median(values);
  const d = mad(values);
  if (m === null || !isNum(value)) return null;
  // MAD nulle = série quasi constante ; on retombe sur l'écart-type.
  const scale = d && d > 1e-9 ? d / 0.6745 : stdev(values);
  if (!scale || scale < 1e-9) return null;
  return (value - m) / scale;
}

/** Moyenne mobile simple. Renvoie null tant que la fenêtre n'est pas pleine. */
export function sma(series, window) {
  const out = new Array(series.length).fill(null);
  let acc = 0;
  for (let i = 0; i < series.length; i += 1) {
    acc += series[i];
    if (i >= window) acc -= series[i - window];
    if (i >= window - 1) out[i] = acc / window;
  }
  return out;
}

/** Borne une valeur dans [min, max]. */
export const clamp = (v, min = 0, max = 100) => Math.min(max, Math.max(min, v));

/**
 * Normalise une valeur sur [0,100] de façon monotone et bornée.
 * `invert` quand « plus grand = moins bien » (ex : une valorisation élevée).
 */
export function normalize(value, { low, high, invert = false }) {
  if (!isNum(value) || !isNum(low) || !isNum(high) || low === high) return null;
  const raw = ((value - low) / (high - low)) * 100;
  return clamp(invert ? 100 - raw : raw);
}

/** Interpolation linéaire entre des points de contrôle {x, y}. */
export function piecewise(value, points) {
  if (!isNum(value) || !points?.length) return null;
  const pts = points.slice().sort((a, b) => a.x - b.x);
  if (value <= pts[0].x) return pts[0].y;
  if (value >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (value <= b.x) {
      const t = (value - a.x) / (b.x - a.x);
      return a.y + t * (b.y - a.y);
    }
  }
  return pts[pts.length - 1].y;
}

/** Drawdown courant et maximum d'une série de prix. */
export function drawdown(series) {
  const v = clean(series);
  if (!v.length) return { current: null, max: null, peak: null };
  let peak = -Infinity;
  let max = 0;
  for (const price of v) {
    if (price > peak) peak = price;
    const dd = price / peak - 1;
    if (dd < max) max = dd;
  }
  const allTimeHigh = Math.max(...v);
  return {
    current: v[v.length - 1] / allTimeHigh - 1,
    max,
    peak: allTimeHigh,
  };
}

/** Volatilité annualisée à partir de prix quotidiens. */
export function annualizedVolatility(prices, periodsPerYear = 365) {
  const v = clean(prices);
  if (v.length < 3) return null;
  const returns = [];
  for (let i = 1; i < v.length; i += 1) {
    if (v[i - 1] > 0) returns.push(Math.log(v[i] / v[i - 1]));
  }
  const sd = stdev(returns);
  return sd === null ? null : sd * Math.sqrt(periodsPerYear) * 100;
}

/** Performance en % entre le premier et le dernier point. */
export function performance(prices) {
  const v = clean(prices);
  if (v.length < 2 || v[0] === 0) return null;
  return (v[v.length - 1] / v[0] - 1) * 100;
}
