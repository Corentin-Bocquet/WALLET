/**
 * Simulateur « Et si… » : passé rejoué, futur calé sur le cycle, et les
 * garde-fous qui rendent la comparaison honnête.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, horizonEnd, HORIZON_UNITS } from '../app/js/engine/simulator.js';

const DAY = 86400000;
const TODAY = '2026-09-24';

// 1 600 jours de prix réguliers se terminant aujourd'hui.
const HISTORY = Array.from({ length: 1600 }, (_, i) => {
  const t = Date.parse(`${TODAY}T00:00:00Z`) - (1599 - i) * DAY;
  return { day: new Date(t).toISOString().slice(0, 10), close: 20000 + i * 25 + Math.sin(i / 30) * 1500 };
});

test('les horizons sont bornés par unité', () => {
  assert.equal(horizonEnd('2026-01-01', 99, 'days'), '2026-01-31');       // 30 jours max
  assert.equal(horizonEnd('2026-01-01', 40, 'months'), '2027-01-01');     // 12 mois max
  assert.equal(HORIZON_UNITS.days.max, 30);
  assert.equal(HORIZON_UNITS.months.max, 12);
});

test('une période entièrement passée est rejouée sur les prix réels, un seul scénario', () => {
  const r = simulate({ history: HISTORY, start: '2025-09-24', value: 6, unit: 'months', amount: 100, today: TODAY });
  assert.equal(r.available, true);
  assert.equal(r.kind, 'past');
  assert.equal(r.strategies.dca.scenarios.length, 1);
  assert.ok(r.strategies.dca.invested > 0);
  assert.equal(r.strategies.dca.low, r.strategies.dca.high, 'le passé n’a pas de fourchette');
});

test('le futur produit trois trajectoires ordonnées pessimiste ≤ central ≤ optimiste', () => {
  const r = simulate({ history: HISTORY, start: TODAY, value: 2, unit: 'years', amount: 100, today: TODAY });
  assert.equal(r.kind, 'future');
  const byKind = Object.fromEntries(r.strategies.lump_sum.scenarios.map((s) => [s.kind, s.final_value]));
  assert.ok(byKind.bear <= byKind.base && byKind.base <= byKind.bull, JSON.stringify(byKind));
});

test('tout en une fois engage exactement le capital du DCA', () => {
  const r = simulate({ history: HISTORY, start: '2026-03-01', value: 12, unit: 'months', amount: 50, today: TODAY });
  assert.equal(r.kind, 'mixed');
  assert.equal(r.strategies.lump_sum.invested, r.strategies.dca.invested);
});

test('une date antérieure à l’historique est refusée avec une explication', () => {
  const r = simulate({ history: HISTORY, start: '2015-01-01', value: 1, unit: 'years', today: TODAY });
  assert.equal(r.available, false);
  assert.match(r.reason, /commencent/);
});

test('prix potentiel du Bitcoin à une date : trois scénarios ordonnés, futur seulement', async () => {
  const { btcPriceAt } = await import('../app/js/engine/simulator.js');
  const r = btcPriceAt({ btcHistory: HISTORY, date: '2027-06-30' });
  assert.equal(r.available, true);
  assert.equal(r.projections.length, 3);
  const [bear, base, bull] = r.projections.map((p) => p.target);
  assert.ok(bear <= base && base <= bull, 'bear ≤ base ≤ bull');
  assert.ok(r.low === bear && r.high === bull);
  assert.equal(btcPriceAt({ btcHistory: HISTORY, date: '2020-01-01' }).available, false);
});
