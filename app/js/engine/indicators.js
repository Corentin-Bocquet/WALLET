/**
 * WALLET · Indicateurs de valorisation et de cycle (§24, §25)
 *
 * Tout ce qui suit est calculé LOCALEMENT à partir de l'historique de prix.
 * C'est un choix imposé par la contrainte de gratuité : les données on-chain
 * réelles (MVRV, SOPR, réserves d'exchange) n'ont pas d'API gratuite fiable.
 *
 * Conséquence assumée et signalée partout dans l'interface : les indicateurs
 * dérivés portent `is_derived: true` et l'écran affiche « estimé ». On ne
 * fait jamais passer une approximation pour une mesure (§47, §48).
 */

import { sma, drawdown, annualizedVolatility, performance, piecewise, clamp } from './stats.js';

/** Halvings Bitcoin passés et à venir (dates publiques, vérifiables). */
export const HALVINGS = [
  '2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20', '2028-04-01',
].map((d) => new Date(`${d}T00:00:00Z`).getTime());

const DAY = 86400000;
const CYCLE_DAYS = 1458;      // ~4 ans, durée moyenne observée entre halvings

/**
 * @param {Array<{day: string, close: number}>} history  série quotidienne, croissante
 * @param {object} options { asOf } — date d'évaluation, pour rejouer sans fuite
 * @returns {object} indicateurs, chacun avec sa valeur, sa source et sa nature
 */
export function computeIndicators(history, { asOf = Date.now() } = {}) {
  const series = (history || [])
    .filter((p) => p && Number.isFinite(Number(p.close)))
    .map((p) => ({ t: new Date(p.day).getTime(), close: Number(p.close) }))
    // Aucune donnée postérieure à la date évaluée : c'est ce qui rend les
    // backtests honnêtes (§30).
    .filter((p) => p.t <= asOf)
    .sort((a, b) => a.t - b.t);

  if (series.length < 30) {
    return { available: false, reason: 'historique insuffisant', points: series.length };
  }

  const closes = series.map((p) => p.close);
  const price = closes[closes.length - 1];
  const last = series[series.length - 1].t;

  const sma200 = sma(closes, Math.min(200, closes.length));
  const ma200 = sma200[sma200.length - 1];
  const weeks200 = Math.min(1400, closes.length);           // ~200 semaines
  const sma200w = sma(closes, weeks200);
  const ma200w = sma200w[sma200w.length - 1];

  const dd = drawdown(closes);

  const out = {
    available: true,
    as_of: new Date(last).toISOString(),
    price,
    points: closes.length,
  };

  /* — Multiple de Mayer ————————————————————————————— */
  if (ma200) {
    out.mayer = {
      code: 'mayer',
      value: round4(price / ma200),
      is_derived: false,           // formule exacte, pas une approximation
      source: 'price_history',
      note: 'Prix ÷ moyenne 200 jours',
    };
  }

  /* — Écart à la moyenne 200 semaines ————————————— */
  if (ma200w && closes.length >= 400) {
    out.ma200w = {
      code: 'ma200w_multiple',
      value: round4(price / ma200w),
      reference: round2(ma200w),
      is_derived: false,
      source: 'price_history',
      note: 'Prix ÷ moyenne 200 semaines (plancher historique de cycle)',
    };
  }

  /* — Drawdown ————————————————————————————————————— */
  out.drawdown = {
    code: 'drawdown',
    value: round4(dd.current * 100),
    ath: round2(dd.peak),
    is_derived: false,
    source: 'price_history',
    note: 'Écart au plus haut historique connu de la série',
  };

  /* — Proxy de MVRV ————————————————————————————————— */
  //   Faute de Realized Cap gratuite, on approxime le « coût de base moyen »
  //   par une moyenne mobile longue pondérée par le volume quand il existe.
  //   C'est une SILHOUETTE du MVRV, pas le MVRV. D'où is_derived: true.
  if (ma200w) {
    const proxy = price / ma200w;
    out.mvrv_proxy = {
      code: 'mvrv_proxy',
      value: round4(proxy),
      is_derived: true,
      confidence: 0.45,
      source: 'proxy interne (200W MA)',
      note: 'Approximation : aucune source on-chain gratuite ne fournit la Realized Cap',
    };
  }

  /* — Momentum ————————————————————————————————————— */
  out.momentum = {
    code: 'momentum',
    value_30d: round2(performance(closes.slice(-30))),
    value_90d: round2(performance(closes.slice(-90))),
    value_365d: round2(performance(closes.slice(-365))),
    is_derived: false,
    source: 'price_history',
  };

  /* — Volatilité ————————————————————————————————————— */
  out.volatility = {
    code: 'volatility',
    value: round2(annualizedVolatility(closes.slice(-90))),
    is_derived: false,
    source: 'price_history',
    note: 'Écart-type annualisé des rendements sur 90 jours',
  };

  /* — Position dans le cycle ————————————————————————— */
  out.cycle = cyclePosition({ asOf: last, drawdownPct: dd.current * 100,
    mayer: ma200 ? price / ma200 : null });

  return out;
}

/**
 * Position dans le cycle (§25).
 *
 * Trois signaux combinés : temps écoulé depuis le halving, drawdown, et écart
 * à la moyenne longue. Le résultat est un repère narratif, jamais un calendrier :
 * quatre cycles constituent un échantillon minuscule et la structure du marché
 * a changé. L'interface l'énonce noir sur blanc.
 */
export function cyclePosition({ asOf = Date.now(), drawdownPct = null, mayer = null } = {}) {
  const past = HALVINGS.filter((h) => h <= asOf);
  const lastHalving = past.length ? past[past.length - 1] : HALVINGS[0];
  const daysSince = Math.max(0, (asOf - lastHalving) / DAY);
  const timePhase = clamp((daysSince / CYCLE_DAYS) * 100, 0, 100);

  // Un drawdown profond situe plutôt en fin de cycle baissier.
  const ddSignal = drawdownPct === null ? null
    : piecewise(drawdownPct, [
        { x: -85, y: 5 }, { x: -70, y: 15 }, { x: -50, y: 30 },
        { x: -30, y: 55 }, { x: -15, y: 75 }, { x: 0, y: 92 },
      ]);

  const mayerSignal = mayer === null ? null
    : piecewise(mayer, [
        { x: 0.7, y: 8 }, { x: 1.0, y: 30 }, { x: 1.4, y: 55 },
        { x: 2.0, y: 78 }, { x: 2.4, y: 90 }, { x: 3.5, y: 98 },
      ]);

  const parts = [
    { value: timePhase, weight: 0.34 },
    { value: ddSignal, weight: 0.33 },
    { value: mayerSignal, weight: 0.33 },
  ].filter((p) => p.value !== null && Number.isFinite(p.value));

  const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
  const position = totalWeight > 0
    ? parts.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight
    : null;

  return {
    code: 'cycle_position',
    value: position === null ? null : round2(position),
    days_since_halving: Math.round(daysSince),
    last_halving: new Date(lastHalving).toISOString().slice(0, 10),
    next_halving: HALVINGS.find((h) => h > asOf)
      ? new Date(HALVINGS.find((h) => h > asOf)).toISOString().slice(0, 10) : null,
    phase: phaseLabel(position),
    is_derived: true,
    confidence: totalWeight,       // 1.0 seulement si les 3 signaux sont là
    source: 'halvings publics + historique de prix',
    note: 'Repère narratif : 4 cycles observés ne font pas une loi',
  };
}

function phaseLabel(position) {
  if (position === null) return 'inconnue';
  if (position < 20) return 'sortie de creux';
  if (position < 40) return 'début de reprise';
  if (position < 60) return 'expansion';
  if (position < 80) return 'phase avancée';
  return 'zone d’euphorie historique';
}

/* — Fear & Greed ——————————————————————————————————— */
export function fearGreedLabel(value) {
  if (!Number.isFinite(value)) return { label: 'inconnu', color: 'var(--neutral)' };
  if (value <= 24) return { label: 'peur extrême', color: 'var(--zone-exceptional)' };
  if (value <= 44) return { label: 'peur', color: 'var(--zone-interesting)' };
  if (value <= 55) return { label: 'neutre', color: 'var(--zone-neutral)' };
  if (value <= 75) return { label: 'avidité', color: 'var(--zone-expensive)' };
  return { label: 'avidité extrême', color: 'var(--zone-distribution)' };
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const round4 = (n) => (Number.isFinite(n) ? Math.round(n * 10000) / 10000 : null);
