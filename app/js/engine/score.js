/**
 * WALLET · Investment Score (§27) et zones (§28)
 *
 * Chaque facteur est normalisé sur [0,100] par une fonction monotone bornée,
 * puis agrégé en moyenne pondérée. Deux principes non négociables :
 *
 *   1. Un facteur sans donnée n'est PAS remplacé par une valeur neutre : il
 *      sort du dénominateur, et la confiance retournée chute d'autant. Un
 *      score à 87 calculé sur 40 % des facteurs ne doit pas ressembler à un
 *      score à 87 calculé sur tout.
 *
 *   2. Aucun facteur n'utilise de donnée postérieure à la date évaluée. C'est
 *      ce qui rend le score rejouable en backtest sans fuite d'information.
 */

import { piecewise, clamp } from './stats.js';

export const DEFAULT_WEIGHTS = {
  cycle: 20, valuation: 20, momentum: 15, onchain: 10,
  sentiment: 10, macro: 5, drawdown: 15, volatility: 5,
};

export const DEFAULT_ZONES = {
  exceptional: 80, interesting: 65, neutral: 45, expensive: 30,
};

export const FACTOR_LABELS = {
  cycle:      'Cycle',
  valuation:  'Valorisation',
  momentum:   'Momentum',
  onchain:    'On-chain',
  sentiment:  'Sentiment',
  macro:      'Macro',
  drawdown:   'Drawdown',
  volatility: 'Volatilité',
};

export const FACTOR_HELP = {
  cycle:      'Où l’on se situe dans le rythme historique du marché.',
  valuation:  'Le prix est-il loin de ses moyennes longues ?',
  momentum:   'La tendance récente est-elle porteuse ?',
  onchain:    'Ce que dit l’activité de la blockchain.',
  sentiment:  'L’humeur du marché, de la peur à l’euphorie.',
  macro:      'Le contexte économique général.',
  drawdown:   'De combien le prix a baissé depuis son sommet.',
  volatility: 'À quel point le prix bouge fortement.',
};

/* ------------------------------------------------------------------ */
/* Normalisation de chaque facteur                                     */
/*   Convention : 100 = conditions historiquement favorables à l'achat, */
/*   0 = conditions historiquement défavorables.                        */
/* ------------------------------------------------------------------ */

const NORMALIZERS = {
  /** Tôt dans le cycle = favorable. */
  cycle: (v) => (v === null ? null : clamp(100 - v)),

  /** Multiple de Mayer : bas = bon marché. */
  valuation: (mayer) => (mayer === null ? null : piecewise(mayer, [
    { x: 0.6, y: 100 }, { x: 0.8, y: 92 }, { x: 1.0, y: 78 },
    { x: 1.4, y: 52 }, { x: 1.8, y: 32 }, { x: 2.4, y: 12 }, { x: 3.5, y: 0 },
  ])),

  /**
   * Momentum : ni trop froid ni surchauffé. Une performance très négative
   * signale une chute en cours ; une performance extrême signale l'euphorie.
   */
  momentum: (perf90) => (perf90 === null ? null : piecewise(perf90, [
    { x: -60, y: 30 }, { x: -30, y: 62 }, { x: -10, y: 74 }, { x: 0, y: 70 },
    { x: 25, y: 55 }, { x: 60, y: 34 }, { x: 120, y: 14 }, { x: 250, y: 4 },
  ])),

  /** Proxy MVRV : bas = les détenteurs moyens sont proches de leur coût. */
  onchain: (mvrv) => (mvrv === null ? null : piecewise(mvrv, [
    { x: 0.6, y: 100 }, { x: 1.0, y: 84 }, { x: 1.6, y: 60 },
    { x: 2.4, y: 34 }, { x: 3.2, y: 14 }, { x: 4.5, y: 0 },
  ])),

  /** Fear & Greed : la peur est historiquement plus favorable que l'euphorie. */
  sentiment: (fg) => (fg === null ? null : clamp(100 - fg)),

  /** Score macro fourni tel quel sur [0,100], ou absent. */
  macro: (v) => (v === null ? null : clamp(v)),

  /** Drawdown en % (négatif) : plus il est profond, plus c'est favorable. */
  drawdown: (dd) => (dd === null ? null : piecewise(dd, [
    { x: -85, y: 100 }, { x: -70, y: 92 }, { x: -55, y: 78 },
    { x: -40, y: 62 }, { x: -25, y: 44 }, { x: -10, y: 24 }, { x: 0, y: 10 },
  ])),

  /** Volatilité annualisée en % : une volatilité extrême pénalise. */
  volatility: (vol) => (vol === null ? null : piecewise(vol, [
    { x: 20, y: 88 }, { x: 40, y: 76 }, { x: 60, y: 58 },
    { x: 90, y: 36 }, { x: 130, y: 16 }, { x: 200, y: 4 },
  ])),
};

/**
 * @param {object} inputs  valeurs brutes, null quand la donnée manque
 *   { cyclePosition, mayer, momentum90, mvrvProxy, fearGreed, macro,
 *     drawdownPct, volatility }
 * @param {object} model   { weights, zone_thresholds }
 * @returns {object} { score, zone, confidence, factors[], missing[] }
 */
export function computeInvestmentScore(inputs = {}, model = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(model.weights || {}) };
  const zones = { ...DEFAULT_ZONES, ...(model.zone_thresholds || {}) };

  const raw = {
    cycle:      pick(inputs.cyclePosition),
    valuation:  pick(inputs.mayer),
    momentum:   pick(inputs.momentum90),
    onchain:    pick(inputs.mvrvProxy),
    sentiment:  pick(inputs.fearGreed),
    macro:      pick(inputs.macro),
    drawdown:   pick(inputs.drawdownPct),
    volatility: pick(inputs.volatility),
  };

  const factors = [];
  const missing = [];
  let weighted = 0;
  let usedWeight = 0;
  let totalWeight = 0;

  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const weight = Number(weights[key]) || 0;
    if (weight <= 0) continue;
    totalWeight += weight;

    const normalized = NORMALIZERS[key](raw[key]);
    if (normalized === null) {
      missing.push(key);
      factors.push({
        key, label: FACTOR_LABELS[key], weight,
        raw: null, value: null, contribution: 0,
        available: false,
        note: 'Donnée indisponible — ce facteur est retiré du calcul, pas neutralisé.',
      });
      continue;
    }

    weighted += normalized * weight;
    usedWeight += weight;
    factors.push({
      key, label: FACTOR_LABELS[key], weight,
      raw: raw[key], value: round1(normalized),
      contribution: round1(normalized * weight),
      available: true,
      note: FACTOR_HELP[key],
      derived: key === 'onchain' || key === 'cycle',
    });
  }

  if (usedWeight === 0) {
    return {
      score: null, zone: null, confidence: 0,
      factors, missing, coverage: 0,
      explanation: 'Aucune donnée exploitable pour le moment.',
    };
  }

  const score = round1(weighted / usedWeight);
  const coverage = round2(usedWeight / totalWeight);

  factors.sort((a, b) => (b.contribution || 0) - (a.contribution || 0));

  return {
    score,
    zone: zoneFor(score, zones),
    confidence: coverage,
    coverage,
    factors,
    missing,
    explanation: buildExplanation(score, factors, coverage),
  };
}

const pick = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);
const round1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/* — Zones (§28) ————————————————————————————————————— */

export const ZONE_META = {
  exceptional:  { label: 'Zone exceptionnelle', emoji: '🟢', color: 'var(--zone-exceptional)' },
  interesting:  { label: 'Zone intéressante',   emoji: '🟢', color: 'var(--zone-interesting)' },
  neutral:      { label: 'Zone neutre',         emoji: '🟡', color: 'var(--zone-neutral)' },
  expensive:    { label: 'Zone chère',          emoji: '🟠', color: 'var(--zone-expensive)' },
  distribution: { label: 'Zone de distribution', emoji: '🔴', color: 'var(--zone-distribution)' },
};

export function zoneFor(score, thresholds = DEFAULT_ZONES) {
  if (!Number.isFinite(score)) return null;
  if (score >= thresholds.exceptional) return 'exceptional';
  if (score >= thresholds.interesting) return 'interesting';
  if (score >= thresholds.neutral)     return 'neutral';
  if (score >= thresholds.expensive)   return 'expensive';
  return 'distribution';
}

function buildExplanation(score, factors, coverage) {
  const available = factors.filter((f) => f.available);
  if (!available.length) return 'Aucune donnée exploitable.';

  const top = available.slice(0, 2).map((f) => f.label.toLowerCase());
  const weakest = available.slice().sort((a, b) => a.value - b.value)[0];

  let text = `Score porté surtout par ${top.join(' et ')}.`;
  if (weakest && weakest.value < 40) {
    text += ` Le facteur ${weakest.label.toLowerCase()} tire vers le bas.`;
  }
  if (coverage < 0.75) {
    text += ` Attention : seulement ${Math.round(coverage * 100)} % des facteurs sont renseignés.`;
  }
  return text;
}

/**
 * Score de vente : symétrique, mais pas l'exact inverse — on ne vend pas
 * automatiquement quand on n'achète pas. La zone neutre reste neutre des deux
 * côtés.
 */
export function computeSellScore(scoreResult) {
  if (!scoreResult || scoreResult.score === null) return null;
  const s = scoreResult.score;
  const sell = piecewise(s, [
    { x: 0, y: 95 }, { x: 20, y: 82 }, { x: 35, y: 62 },
    { x: 50, y: 40 }, { x: 65, y: 22 }, { x: 80, y: 8 }, { x: 100, y: 2 },
  ]);
  return {
    score: round1(sell),
    confidence: scoreResult.confidence,
    note: 'Un score d’achat bas ne veut pas dire « vendre » : il veut dire « conditions moins favorables ».',
  };
}
