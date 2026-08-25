/**
 * Backtest : la garantie « aucune donnée future » (§30).
 *
 * Le test central injecte une valeur aberrante APRÈS la fenêtre simulée.
 * Si la moindre décision regardait vers l'avant, le résultat changerait.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backtest, compareStrategies } from '../app/js/engine/backtest.js';
import { computeIndicators, cyclePosition } from '../app/js/engine/indicators.js';
import { computeInvestmentScore, zoneFor, computeSellScore } from '../app/js/engine/score.js';
import { projectFromMa200w, projectAltFromBtc, projectPortfolio } from '../app/js/engine/scenarios.js';

/* — Série synthétique déterministe ————————————————— */

function makeSeries(days, { start = 10000, seed = 42 } = {}) {
  let state = seed;
  const rand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  const out = [];
  let price = start;
  const t0 = Date.UTC(2020, 0, 1);
  for (let i = 0; i < days; i += 1) {
    // Dérive haussière + cycle lent + bruit : assez réaliste pour tester.
    const drift = 0.0006;
    const cycle = Math.sin((i / 1400) * Math.PI * 2) * 0.0022;
    price *= 1 + drift + cycle + (rand() - 0.5) * 0.03;
    out.push({ day: new Date(t0 + i * 86400000).toISOString().slice(0, 10), close: Math.max(price, 1) });
  }
  return out;
}

const SERIES = makeSeries(1600);

/* — 1. Le test qui compte ————————————————————————— */

test('injecter une valeur aberrante dans le futur ne change aucun résultat', () => {
  const cutoff = SERIES[1199].day;
  const options = { strategy: 'score_based', amount: 100, cadence: 'monthly', to: cutoff };

  const normal = backtest(SERIES, options);

  // Même série, mais le futur (après le cutoff) part à la verticale.
  const tampered = SERIES.map((p, i) => (i >= 1200 ? { ...p, close: p.close * 1000 } : p));
  const withFuture = backtest(tampered, options);

  assert.ok(normal.available && withFuture.available);
  assert.equal(withFuture.invested, normal.invested,
    'le capital investi ne doit pas dépendre du futur');
  assert.equal(withFuture.trades, normal.trades,
    'le nombre de décisions ne doit pas dépendre du futur');
  assert.equal(withFuture.final_value, normal.final_value,
    'la valeur finale ne doit pas dépendre du futur');
  assert.deepEqual(
    withFuture.trade_log.map((t) => [t.day, t.amount, t.score]),
    normal.trade_log.map((t) => [t.day, t.amount, t.score]),
    'chaque décision, jour par jour, doit être identique');
});

test('les indicateurs ignorent tout point postérieur à asOf', () => {
  const asOf = new Date(SERIES[999].day).getTime();
  const a = computeIndicators(SERIES, { asOf });
  const tampered = SERIES.map((p, i) => (i >= 1000 ? { ...p, close: p.close * 500 } : p));
  const b = computeIndicators(tampered, { asOf });

  assert.deepEqual(b.mayer, a.mayer);
  assert.deepEqual(b.drawdown, a.drawdown);
  assert.deepEqual(b.cycle, a.cycle);
  assert.equal(b.price, a.price);
});

/* — 2. Cohérence des stratégies ————————————————————— */

test('le DCA achète à cadence régulière et lisse le prix de revient', () => {
  const r = backtest(SERIES, { strategy: 'dca', amount: 100, cadence: 'monthly' });
  assert.ok(r.available);
  assert.ok(r.trades >= 50, `attendu ~52 achats mensuels sur 1600 jours, reçu ${r.trades}`);
  assert.equal(r.invested, r.trades * 100);
  assert.ok(r.average_cost > 0);
  // Le prix de revient moyen doit tomber entre le min et le max de la série.
  const closes = SERIES.map((p) => p.close);
  assert.ok(r.average_cost >= Math.min(...closes) && r.average_cost <= Math.max(...closes));
});

test("l'investissement en une fois engage le même capital que le DCA comparé", () => {
  const comparison = compareStrategies(SERIES, { amount: 100, cadence: 'monthly' });
  const dca = comparison.runs.find((r) => r.key === 'dca').result;
  const lump = comparison.runs.find((r) => r.key === 'lump_sum').result;
  assert.equal(lump.invested, dca.invested,
    'comparer 5 200 € étalés à 100 € en une fois n’aurait aucun sens');
  assert.equal(lump.trades, 1);
});

test('la stratégie pilotée par le score saute des périodes et le déclare', () => {
  const r = backtest(SERIES, { strategy: 'score_based', amount: 100, cadence: 'monthly', scoreThreshold: 60 });
  assert.ok(r.available);
  assert.ok(r.skipped > 0, 'un seuil à 60 doit écarter certaines périodes');
  assert.equal(r.trades + r.skipped, r.trade_log.length);
  for (const t of r.trade_log) {
    assert.ok(t.score === null || (t.score >= 0 && t.score <= 100));
  }
});

test('une série trop courte refuse de simuler plutôt que de bricoler', () => {
  const r = backtest(SERIES.slice(0, 40), { strategy: 'dca' });
  assert.equal(r.available, false);
  assert.match(r.reason, /trop court/);
});

/* — 3. Score : la confiance suit la couverture ————— */

test('un facteur absent est retiré du calcul, pas neutralisé', () => {
  const complet = computeInvestmentScore({
    cyclePosition: 30, mayer: 0.9, momentum90: -20, mvrvProxy: 1.1,
    fearGreed: 20, macro: 60, drawdownPct: -60, volatility: 55,
  });
  const partiel = computeInvestmentScore({
    cyclePosition: 30, mayer: 0.9, momentum90: -20, mvrvProxy: null,
    fearGreed: null, macro: null, drawdownPct: -60, volatility: 55,
  });

  assert.equal(complet.confidence, 1);
  assert.ok(partiel.confidence < 1, 'la confiance doit chuter quand des facteurs manquent');
  assert.deepEqual(partiel.missing.sort(), ['macro', 'onchain', 'sentiment']);

  const absent = partiel.factors.find((f) => f.key === 'onchain');
  assert.equal(absent.available, false);
  assert.equal(absent.contribution, 0);
  assert.match(absent.note, /pas neutralisé/);
});

test('le score est monotone : des conditions plus favorables ne baissent jamais la note', () => {
  const cher = computeInvestmentScore({
    cyclePosition: 90, mayer: 2.6, momentum90: 140, mvrvProxy: 3.6,
    fearGreed: 88, macro: 30, drawdownPct: -3, volatility: 120,
  });
  const bonMarche = computeInvestmentScore({
    cyclePosition: 10, mayer: 0.75, momentum90: -35, mvrvProxy: 0.8,
    fearGreed: 12, macro: 70, drawdownPct: -78, volatility: 50,
  });

  assert.ok(bonMarche.score > cher.score,
    `un creux profond devrait scorer plus haut qu’un sommet (${bonMarche.score} vs ${cher.score})`);
  assert.equal(zoneFor(bonMarche.score), 'exceptional');
  assert.ok(['expensive', 'distribution'].includes(zoneFor(cher.score)));
});

test('sans aucune donnée, le score est null et jamais 0', () => {
  const r = computeInvestmentScore({});
  assert.equal(r.score, null, 'un score inconnu ne doit pas ressembler à un score nul');
  assert.equal(r.zone, null);
  assert.equal(r.confidence, 0);
});

test('les poids personnalisés changent réellement le résultat', () => {
  const inputs = { cyclePosition: 20, mayer: 2.2, momentum90: 5, mvrvProxy: 2.8,
    fearGreed: 50, macro: 50, drawdownPct: -20, volatility: 60 };

  const equilibre = computeInvestmentScore(inputs);
  const cycleSeul = computeInvestmentScore(inputs, {
    weights: { cycle: 100, valuation: 0, momentum: 0, onchain: 0,
      sentiment: 0, macro: 0, drawdown: 0, volatility: 0 },
  });

  assert.notEqual(cycleSeul.score, equilibre.score);
  assert.equal(cycleSeul.score, 80, 'cycle à 20 → facteur 80, seul en jeu');
  assert.equal(cycleSeul.confidence, 1);
});

test('le score de vente n’est pas le simple inverse du score d’achat', () => {
  const achat = computeInvestmentScore({ cyclePosition: 50, mayer: 1.4, momentum90: 0,
    mvrvProxy: 1.6, fearGreed: 50, macro: 50, drawdownPct: -30, volatility: 60 });
  const vente = computeSellScore(achat);
  assert.ok(vente.score !== null);
  assert.notEqual(vente.score, 100 - achat.score);
  assert.match(vente.note, /ne veut pas dire/);
});

/* — 4. Projections : jamais un chiffre seul ————————— */

test('une projection sort toujours avec sa fourchette et son hypothèse', () => {
  const p = projectFromMa200w(45000, [
    { name: 'Bear', kind: 'bear', probability: 0.25, assumptions: { multiple_of_200w_ma: 1.0, note: 'Récession' } },
    { name: 'Base', kind: 'base', probability: 0.50, assumptions: { multiple_of_200w_ma: 2.4 } },
    { name: 'Bull', kind: 'bull', probability: 0.25, assumptions: { multiple_of_200w_ma: 4.0 } },
  ]);

  assert.ok(p.available);
  assert.equal(p.low, 45000);
  assert.equal(p.central, 108000);
  assert.equal(p.high, 180000);
  assert.ok(p.low < p.central && p.central < p.high);
  assert.equal(p.expected, 110250, "espérance pondérée = 45 000 × (1×0,25 + 2,4×0,5 + 4×0,25)");
  assert.match(p.disclaimer, /Rien ne garantit/);
  for (const proj of p.projections) assert.ok(proj.assumption, 'hypothèse non explicitée');
});

test('la projection ALT expose ses limites, dilution comprise', () => {
  const p = projectAltFromBtc({
    btcPrice: 200000,
    currentAltPrice: 100,
    supplyGrowthPct: 40,
    ratios: [
      { label: 'Plus haut du cycle', source: 'historical_high', ratio: 0.0042 },
      { label: 'Ratio actuel', source: 'current', ratio: 0.0018 },
    ],
  });

  assert.ok(p.available);
  assert.equal(p.low, 360);
  assert.equal(p.high, 840);
  assert.ok(p.caveats.some((c) => /dilution|supply/i.test(c)), 'la dilution doit être signalée');
  assert.ok(p.caveats.some((c) => /ratio choisi/.test(c)));
});

test('le portefeuille projeté signale ce qui n’a pas été projeté', () => {
  const r = projectPortfolio({
    holdings: [
      { symbol: 'BTC', quantity: 0.5, price: 60000 },
      { symbol: 'AAPL', quantity: 10, price: 200 },
    ],
    priceOverrides: { BTC: 200000 },
  });

  assert.equal(r.current, 32000);
  assert.equal(r.projected, 102000);
  assert.equal(r.untouched_value, 2000, "l'action garde sa valeur actuelle");
  assert.ok(r.note && /sans hypothèse/.test(r.note));
  assert.equal(r.lines.find((l) => l.symbol === 'AAPL').basis, 'inchangé');
});

/* — 5. Cycle ————————————————————————————————————————— */

test('la position dans le cycle reste bornée et déclare sa confiance', () => {
  const juste = cyclePosition({ asOf: Date.UTC(2024, 5, 1), drawdownPct: -20, mayer: 1.5 });
  assert.ok(juste.value >= 0 && juste.value <= 100);
  assert.equal(juste.confidence, 1, 'trois signaux disponibles');
  assert.ok(juste.is_derived, 'doit être marqué comme estimé');

  const partiel = cyclePosition({ asOf: Date.UTC(2024, 5, 1) });
  assert.ok(partiel.confidence < 1, 'sans drawdown ni Mayer, la confiance doit baisser');
});
