/**
 * WALLET · Backtest de stratégies (§30)
 *
 * Contrainte absolue du cahier des charges : « ne jamais utiliser de données
 * futures dans une simulation historique ». Elle est appliquée
 * structurellement, pas par discipline :
 *
 *   · `sliceUpTo()` est le SEUL accès aux prix, et il coupe strictement à la
 *     date du jour simulé ;
 *   · la décision d'un jour est prise avec `history[0..i]`, jamais `history[i+1]` ;
 *   · l'exécution se fait au cours du jour de décision, pas au cours du
 *     lendemain choisi après coup.
 *
 * Le test `backtest.test.js` vérifie qu'injecter une valeur aberrante dans le
 * FUTUR d'une série ne change strictement rien au résultat.
 */

import { computeIndicators } from './indicators.js';
import { computeInvestmentScore, zoneFor, DEFAULT_ZONES } from './score.js';
import { drawdown } from './stats.js';

const DAY = 86400000;

/**
 * @param {Array<{day, close}>} history
 * @param {object} options
 *   strategy: 'dca' | 'lump_sum' | 'score_based'
 *   amount: montant investi par période (dca) ou en une fois (lump_sum)
 *   cadence: 'weekly' | 'monthly'
 *   from, to: bornes ISO
 *   scoreThreshold: pour 'score_based', score minimal pour investir
 *   scoreMultiplier: investir plus quand le score est haut
 */
export function backtest(history, options = {}) {
  const {
    strategy = 'dca',
    amount = 100,
    cadence = 'monthly',
    from = null,
    to = null,
    scoreThreshold = 55,
    maxMultiplier = 3,
    model = {},
  } = options;

  const series = normalizeSeries(history, from, to);
  if (series.length < 60) {
    return { available: false, reason: 'historique trop court pour une simulation crédible' };
  }

  const cadenceDays = cadence === 'weekly' ? 7 : 30;
  const trades = [];
  const equity = [];

  let units = 0;
  let invested = 0;
  let lastBuy = -Infinity;

  for (let i = 0; i < series.length; i += 1) {
    const today = series[i];

    /* --- Aucune donnée au-delà de i n'est accessible ici. ------------- */
    const visible = sliceUpTo(series, i);

    const isCadenceDay = (today.t - lastBuy) / DAY >= cadenceDays;
    let buyAmount = 0;

    if (strategy === 'lump_sum') {
      if (i === 0) buyAmount = amount;
    } else if (strategy === 'dca') {
      if (isCadenceDay) buyAmount = amount;
    } else if (strategy === 'score_based') {
      if (isCadenceDay) {
        const decision = scoreOn(visible, model);
        if (decision.score !== null && decision.score >= scoreThreshold) {
          // Plus le score dépasse le seuil, plus on investit — borné.
          const excess = (decision.score - scoreThreshold) / (100 - scoreThreshold);
          buyAmount = amount * Math.min(maxMultiplier, 1 + excess * (maxMultiplier - 1));
        }
        trades.push({
          day: today.day, price: today.close, amount: round2(buyAmount),
          score: decision.score, zone: decision.zone, skipped: buyAmount === 0,
        });
      }
    }

    if (buyAmount > 0) {
      units += buyAmount / today.close;
      invested += buyAmount;
      lastBuy = today.t;
      if (strategy !== 'score_based') {
        trades.push({ day: today.day, price: today.close, amount: round2(buyAmount) });
      }
    }

    equity.push({ day: today.day, value: round2(units * today.close), invested: round2(invested) });
  }

  const finalPrice = series[series.length - 1].close;
  const finalValue = units * finalPrice;
  const dd = drawdown(equity.map((e) => e.value).filter((v) => v > 0));

  const years = (series[series.length - 1].t - series[0].t) / (365.25 * DAY);
  const executed = trades.filter((t) => !t.skipped);

  return {
    available: true,
    strategy,
    period_start: series[0].day,
    period_end: series[series.length - 1].day,
    invested: round2(invested),
    final_value: round2(finalValue),
    profit: round2(finalValue - invested),
    roi_pct: invested > 0 ? round2((finalValue / invested - 1) * 100) : null,
    // Le TRI approché suppose un investissement étalé : on prend la durée
    // moyenne de détention plutôt que la durée totale, sinon le DCA est
    // artificiellement flatté.
    annualized_pct: annualized(invested, finalValue, averageHoldingYears(executed, series)),
    units: round8(units),
    average_cost: units > 0 ? round2(invested / units) : null,
    final_price: finalPrice,
    max_drawdown_pct: dd.max === null ? null : round2(dd.max * 100),
    trades: executed.length,
    skipped: trades.length - executed.length,
    duration_years: round2(years),
    equity,
    trade_log: trades,
  };
}

/** Compare plusieurs stratégies sur exactement la même période. */
export function compareStrategies(history, { amount = 100, cadence = 'monthly', from, to, model } = {}) {
  const common = { amount, cadence, from, to, model };
  const runs = [
    { key: 'dca', label: 'DCA régulier', result: backtest(history, { ...common, strategy: 'dca' }) },
    { key: 'score_based', label: 'Piloté par le score', result: backtest(history, { ...common, strategy: 'score_based' }) },
  ];

  // L'investissement en une fois doit porter le MÊME capital total que le DCA,
  // sinon la comparaison n'a aucun sens.
  const dca = runs[0].result;
  if (dca.available) {
    runs.push({
      key: 'lump_sum',
      label: 'Tout en une fois au départ',
      result: backtest(history, { ...common, strategy: 'lump_sum', amount: dca.invested }),
    });
  }

  const valid = runs.filter((r) => r.result.available);
  const best = valid.slice().sort((a, b) => (b.result.roi_pct ?? -Infinity) - (a.result.roi_pct ?? -Infinity))[0];

  return {
    runs: valid,
    best: best?.key ?? null,
    note: 'Résultats passés sur une seule série de prix. Ils ne disent rien du futur, et une autre période aurait pu classer les stratégies différemment.',
  };
}

/* — Internes ————————————————————————————————————————— */

function normalizeSeries(history, from, to) {
  const fromT = from ? new Date(from).getTime() : -Infinity;
  const toT = to ? new Date(to).getTime() : Infinity;

  return (history || [])
    .filter((p) => p && Number.isFinite(Number(p.close)) && Number(p.close) > 0)
    .map((p) => ({ day: String(p.day).slice(0, 10), t: new Date(p.day).getTime(), close: Number(p.close) }))
    .filter((p) => p.t >= fromT && p.t <= toT)
    .sort((a, b) => a.t - b.t);
}

/**
 * LA garantie anti-fuite. Renvoie une copie strictement bornée à l'indice du
 * jour simulé. Toute stratégie doit passer par ici.
 */
function sliceUpTo(series, index) {
  return series.slice(0, index + 1).map((p) => ({ day: p.day, close: p.close }));
}

function scoreOn(visible, model) {
  const asOf = new Date(visible[visible.length - 1].day).getTime();
  const ind = computeIndicators(visible, { asOf });
  if (!ind.available) return { score: null, zone: null };

  const result = computeInvestmentScore({
    cyclePosition: ind.cycle?.value ?? null,
    mayer: ind.mayer?.value ?? null,
    momentum90: ind.momentum?.value_90d ?? null,
    mvrvProxy: ind.mvrv_proxy?.value ?? null,
    drawdownPct: ind.drawdown?.value ?? null,
    volatility: ind.volatility?.value ?? null,
    // Sentiment et macro ne sont pas rejouables historiquement sans archive :
    // on les laisse absents plutôt que d'inventer une valeur (§48).
    fearGreed: null,
    macro: null,
  }, model);

  return { score: result.score, zone: result.zone ?? zoneFor(result.score, DEFAULT_ZONES) };
}

function averageHoldingYears(trades, series) {
  if (!trades.length) return 0;
  const end = series[series.length - 1].t;
  const weighted = trades.reduce((acc, t) => {
    const held = (end - new Date(t.day).getTime()) / (365.25 * DAY);
    return acc + held * t.amount;
  }, 0);
  const total = trades.reduce((a, t) => a + t.amount, 0);
  return total > 0 ? weighted / total : 0;
}

function annualized(invested, finalValue, years) {
  if (!(invested > 0) || !(finalValue > 0) || !(years > 0.08)) return null;
  return round2(((finalValue / invested) ** (1 / years) - 1) * 100);
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const round8 = (n) => (Number.isFinite(n) ? Math.round(n * 1e8) / 1e8 : null);
