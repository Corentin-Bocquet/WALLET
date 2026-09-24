/**
 * WALLET · Simulateur « Et si… » (§30)
 *
 * Une seule question, posée avec trois boutons : « si j'investis X € à
 * partir de telle date, pendant tant de temps, avec telle stratégie, où
 * j'en suis à la fin ? »
 *
 *   · la partie PASSÉE de la période est rejouée sur les vrais prix, chaque
 *     décision ne voyant que l'historique disponible à sa date ;
 *   · la partie FUTURE suit trois trajectoires de prix calées sur le cycle
 *     de quatre ans du Bitcoin (halvings, sommets, creux), une par scénario.
 *     Ce ne sont pas des prévisions : ce sont les conséquences chiffrées
 *     d'une hypothèse affichée, avec sa fourchette.
 */

import { computeIndicators } from './indicators.js';
import { computeInvestmentScore } from './score.js';
import { piecewise } from './stats.js';

const DAY = 86400000;

/** Unités d'horizon : bornes et cadence d'achat du DCA associée. */
export const HORIZON_UNITS = {
  days:   { label: 'jours',    singular: 'jour',    max: 30, days: 1,      cadence: 'daily',   cadenceLabel: 'chaque jour' },
  weeks:  { label: 'semaines', singular: 'semaine', max: 52, days: 7,      cadence: 'daily',   cadenceLabel: 'chaque jour' },
  months: { label: 'mois',     singular: 'mois',    max: 12, days: 30.44,  cadence: 'weekly',  cadenceLabel: 'chaque semaine' },
  years:  { label: 'ans',      singular: 'an',      max: 10, days: 365.25, cadence: 'monthly', cadenceLabel: 'chaque mois' },
};

export const STRATEGIES = [
  { key: 'dca', label: 'DCA régulier', hint: 'Le même montant à intervalle fixe' },
  { key: 'score_based', label: 'Piloté par le score', hint: 'Plus quand le marché est bas, rien quand il est cher' },
  { key: 'lump_sum', label: 'Tout en une fois', hint: 'Le même capital, investi dès le premier jour' },
];

/** Halvings passés et estimés : ils rythment le cycle de quatre ans. */
export const HALVINGS = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20', '2028-04-15', '2032-04-10', '2036-04-05']
  .map((d) => Date.parse(`${d}T00:00:00Z`));
const CYCLE_DAYS = 1458;

const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const SCORE_THRESHOLD = 55;
const MAX_MULTIPLIER = 3;

export function horizonEnd(startIso, value, unit) {
  const start = new Date(`${startIso}T00:00:00Z`);
  const n = Math.max(1, Math.min(HORIZON_UNITS[unit]?.max ?? 12, Math.round(Number(value) || 1)));
  const end = new Date(start);
  if (unit === 'days') end.setUTCDate(end.getUTCDate() + n);
  else if (unit === 'weeks') end.setUTCDate(end.getUTCDate() + n * 7);
  else if (unit === 'months') end.setUTCMonth(end.getUTCMonth() + n);
  else end.setUTCFullYear(end.getUTCFullYear() + n);
  return end.toISOString().slice(0, 10);
}

/**
 * Forme du cycle : prix divisé par la moyenne 200 semaines, selon le nombre
 * de jours écoulés depuis le dernier halving. Les sommets passés sont venus
 * 12 à 18 mois après le halving, les creux environ un an plus tard.
 * `peak` est le multiple de sommet du scénario (réglable dans ses paramètres).
 */
function cycleMultiple(daysSinceHalving, peak) {
  const scale = Math.sqrt(Math.min(1.6, Math.max(0.5, peak / 2.4)));
  return piecewise(daysSinceHalving, [
    { x: 0, y: 1.6 * scale },
    { x: 180, y: 1.85 * scale },
    { x: 540, y: peak },
    { x: 760, y: 1.6 * scale },
    { x: 940, y: 0.95 * scale },
    { x: 1150, y: 1.15 * scale },
    { x: CYCLE_DAYS, y: 1.6 * scale },
  ]);
}

function daysSinceHalving(t) {
  let last = HALVINGS[0];
  for (const h of HALVINGS) if (h <= t) last = h;
  return (t - last) / DAY;
}

/** Moyenne 200 semaines actuelle et son rythme de progression annuel. */
function maTrend(closes) {
  const window = Math.min(1400, closes.length);
  if (window < 200) return null;
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const now = mean(closes.slice(-window));
  let growth = 0.15;            // repli prudent si l'historique est trop court
  if (closes.length >= window + 365) {
    const before = mean(closes.slice(-window - 365, -365));
    if (before > 0) growth = now / before - 1;
  }
  return { ma: now, growth: Math.min(0.5, Math.max(0, growth)) };
}

/**
 * Trajectoire projetée du Bitcoin, jour par jour, pour un scénario.
 * Elle part du prix réel du dernier jour connu (l'écart au modèle se résorbe
 * progressivement) : pas de saut artificiel entre le passé et le futur.
 */
function projectBtc({ lastT, lastPrice, trend, peak }) {
  const m0Model = cycleMultiple(daysSinceHalving(lastT), peak);
  const m0Real = lastPrice / trend.ma;
  return (t) => {
    const days = (t - lastT) / DAY;
    const ma = trend.ma * (1 + trend.growth) ** (days / 365.25);
    const model = cycleMultiple(daysSinceHalving(t), peak);
    const m = model + (m0Real - m0Model) * Math.exp(-days / 240);
    return { price: ma * Math.max(0.2, m), multiple: m };
  };
}

/** Score de zone déduit du multiple, pour les jours futurs (sans historique réel). */
const scoreFromMultiple = (m) => piecewise(m, [
  { x: 0.8, y: 88 }, { x: 1.2, y: 72 }, { x: 1.8, y: 55 }, { x: 2.5, y: 38 }, { x: 3.5, y: 20 }, { x: 5, y: 8 },
]);

function normalize(history) {
  return (history || [])
    .filter((p) => p && Number(p.close) > 0)
    .map((p) => ({ day: String(p.day).slice(0, 10), t: Date.parse(`${String(p.day).slice(0, 10)}T00:00:00Z`), close: Number(p.close) }))
    .sort((a, b) => a.t - b.t);
}

/**
 * @param {object} params
 *   history      historique de l'actif simulé [{day, close}]
 *   btcHistory   historique du Bitcoin (pour la projection) ; = history si BTC
 *   start        date de début ISO
 *   value, unit  horizon (unit ∈ HORIZON_UNITS)
 *   amount       montant par achat
 *   scenarios    scénarios Bitcoin (multiples de sommet)
 *   model        modèle de score (poids, seuils)
 *   today        date du jour (injectable pour les tests)
 */
export function simulate({
  history, btcHistory = history, start, value = 1, unit = 'years', amount = 100,
  scenarios = [], model = {}, today = new Date().toISOString().slice(0, 10),
}) {
  const own = normalize(history);
  const btc = normalize(btcHistory);
  if (own.length < 2 || btc.length < 2) {
    return { available: false, reason: 'Historique de prix insuffisant pour cette crypto.' };
  }

  const unitDef = HORIZON_UNITS[unit] ?? HORIZON_UNITS.years;
  const end = horizonEnd(start, value, unit);
  const startT = Date.parse(`${start}T00:00:00Z`);
  const endT = Date.parse(`${end}T00:00:00Z`);
  const lastT = own[own.length - 1].t;
  const todayT = Date.parse(`${today}T00:00:00Z`);

  if (startT < own[0].t) {
    return { available: false, reason: `Les prix connus commencent le ${own[0].day}. Choisissez une date plus récente.` };
  }

  const kind = endT <= lastT ? 'past' : startT >= Math.min(lastT, todayT) ? 'future' : 'mixed';

  // Trajectoires futures : une par scénario, sinon une seule (le passé réel).
  const trend = maTrend(btc.map((p) => p.close));
  const btcLast = btc[btc.length - 1];
  const ratioNow = own[own.length - 1].close / btcLast.close;
  const isBtc = own === btc || history === btcHistory;

  const peaks = (scenarios.length ? scenarios : DEFAULT_PEAKS)
    .map((s) => ({ kind: s.kind, name: s.name, peak: Number(s.assumptions?.multiple_of_200w_ma ?? s.peak) }))
    .filter((s) => Number.isFinite(s.peak) && s.peak > 0);

  if (kind !== 'past' && !trend) {
    return { available: false, reason: 'Il faut au moins 200 jours de prix du Bitcoin pour projeter le cycle.' };
  }

  const paths = kind === 'past'
    ? [{ kind: 'actual', name: 'Réel', price: null }]
    : ['bear', 'base', 'bull'].map((k, i) => {
        const s = peaks.find((p) => p.kind === k) ?? peaks[Math.min(i, peaks.length - 1)];
        return { kind: k, name: s?.name ?? k, price: projectBtc({ lastT: btcLast.t, lastPrice: btcLast.close, trend, peak: s.peak }) };
      });

  const cadenceDays = CADENCE_DAYS[unitDef.cadence];
  const days = [];
  for (let t = startT; t <= endT; t += DAY) days.push(t);

  // Pré-calcul des scores réels des jours passés où l'on décide.
  const pastScores = new Map();
  const decisionDays = [];
  let lastDecision = -Infinity;
  for (const t of days) {
    if ((t - lastDecision) / DAY >= cadenceDays - 0.5) { decisionDays.push(t); lastDecision = t; }
  }
  for (const t of decisionDays) {
    if (t > lastT) continue;
    const idx = lastIndexAtOrBefore(own, t);
    if (idx < 0) continue;
    const visible = own.slice(0, idx + 1).map((p) => ({ day: p.day, close: p.close }));
    const ind = computeIndicators(visible, { asOf: own[idx].t });
    const result = ind.available ? computeInvestmentScore({
      cyclePosition: ind.cycle?.value ?? null, mayer: ind.mayer?.value ?? null,
      momentum90: ind.momentum?.value_90d ?? null, mvrvProxy: ind.mvrv_proxy?.value ?? null,
      drawdownPct: ind.drawdown?.value ?? null, volatility: ind.volatility?.value ?? null,
      fearGreed: null, macro: null,
    }, model) : { score: null };
    pastScores.set(t, result.score);
  }

  const priceOn = (t, path) => {
    if (t <= lastT) {
      const idx = lastIndexAtOrBefore(own, t);
      return idx < 0 ? null : { price: own[idx].close, score: pastScores.get(t) ?? null };
    }
    const projected = path.price(t);
    return {
      price: isBtc ? projected.price : projected.price * ratioNow,
      score: scoreFromMultiple(projected.multiple),
    };
  };

  const decisionSet = new Set(decisionDays);
  const results = {};
  for (const strategy of STRATEGIES) {
    results[strategy.key] = paths.map((path) => runStrategy({
      strategy: strategy.key, days, decisionSet, amount, priceOn: (t) => priceOn(t, path),
      lumpCapital: amount * decisionDays.length,
    }));
  }

  const summarize = (runs) => {
    const byKind = Object.fromEntries(runs.map((r, i) => [paths[i].kind, r]));
    const base = byKind.base ?? byKind.actual;
    return {
      ...base,
      low: Math.min(...runs.map((r) => r.final_value)),
      high: Math.max(...runs.map((r) => r.final_value)),
      scenarios: paths.map((p, i) => ({ kind: p.kind, name: p.name, ...runs[i] })),
    };
  };

  return {
    available: true,
    kind,
    start,
    end,
    buys: decisionDays.length,
    cadence: unitDef.cadenceLabel,
    strategies: Object.fromEntries(Object.entries(results).map(([k, runs]) => [k, summarize(runs)])),
    note: kind === 'past'
      ? 'Rejoué sur les prix réels. Un autre point de départ aurait pu donner un autre classement.'
      : 'Partie future calée sur le cycle de quatre ans du Bitcoin (sommet 12 à 18 mois après le halving, creux un an plus tard), avec vos multiples de scénario. Ce n’est pas une prévision.',
  };
}

const DEFAULT_PEAKS = [
  { kind: 'bear', name: 'Bear', peak: 1.0 },
  { kind: 'base', name: 'Base', peak: 2.4 },
  { kind: 'bull', name: 'Bull', peak: 4.0 },
];

function runStrategy({ strategy, days, decisionSet, amount, priceOn, lumpCapital }) {
  let units = 0;
  let invested = 0;
  let buys = 0;
  const equity = [];
  let lastPrice = null;

  days.forEach((t, i) => {
    const point = priceOn(t);
    if (!point?.price) return;
    lastPrice = point.price;
    let spend = 0;
    if (strategy === 'lump_sum') {
      if (i === 0) spend = lumpCapital;
    } else if (decisionSet.has(t)) {
      if (strategy === 'dca') spend = amount;
      else if (point.score !== null && point.score >= SCORE_THRESHOLD) {
        const excess = (point.score - SCORE_THRESHOLD) / (100 - SCORE_THRESHOLD);
        spend = amount * Math.min(MAX_MULTIPLIER, 1 + excess * (MAX_MULTIPLIER - 1));
      }
    }
    if (spend > 0) { units += spend / point.price; invested += spend; buys += 1; }
    equity.push({ day: new Date(t).toISOString().slice(0, 10), value: units * point.price, invested });
  });

  const finalValue = lastPrice ? units * lastPrice : 0;
  return {
    invested: round2(invested),
    final_value: round2(finalValue),
    profit: round2(finalValue - invested),
    roi_pct: invested > 0 ? round2((finalValue / invested - 1) * 100) : null,
    buys,
    final_price: round2(lastPrice),
    equity: thin(equity, 120),
  };
}

function lastIndexAtOrBefore(series, t) {
  let lo = 0;
  let hi = series.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function thin(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
