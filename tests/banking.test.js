/**
 * Détection des récurrences (§19), des anomalies (§20) et dérive budgétaire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurring, monthlyRecurringCost, CADENCE_LABEL } from '../app/js/engine/recurring.js';
import { detectAnomalies, detectBudgetDrift } from '../app/js/engine/anomalies.js';
import { median, mad, robustScore, normalize, piecewise, drawdown } from '../app/js/engine/stats.js';

const DAY = 86400000;
const NOW = Date.UTC(2026, 5, 15);

let counter = 0;
function tx(merchant, amount, dayOffset, extra = {}) {
  counter += 1;
  return {
    id: `tx-${counter}`,
    account_id: 'acc-1',
    merchant,
    clean_label: merchant,
    raw_label: merchant.toUpperCase(),
    amount,
    booked_at: new Date(NOW - dayOffset * DAY).toISOString().slice(0, 10),
    status: 'active',
    category_id: extra.category_id ?? null,
    ...extra,
  };
}

/** Série mensuelle régulière, la plus récente en premier. */
const JITTER_PATTERN = [0, 1, -1, 2, 0, -2, 1, 0, -1, 1];

function monthly(merchant, amount, months, { jitterDays = 0, category_id = null } = {}) {
  return Array.from({ length: months }, (_, i) =>
    tx(merchant, amount,
       Math.round(i * 30.44) + JITTER_PATTERN[i % JITTER_PATTERN.length] * jitterDays,
       { category_id }));
}

/* — Récurrences ————————————————————————————————————— */

test('un abonnement mensuel stable est détecté avec une forte confiance', () => {
  const found = detectRecurring(monthly('spotify', -11.12, 9), { now: NOW });
  const spotify = found.find((r) => r.merchant === 'spotify');

  assert.ok(spotify, 'Spotify non détecté');
  assert.equal(spotify.cadence, 'monthly');
  assert.equal(spotify.occurrences, 9);
  assert.equal(spotify.average_amount, 11.12);
  assert.equal(spotify.kind, 'subscription');
  assert.equal(spotify.direction, 'debit');
  assert.ok(spotify.confidence > 0.8, `confiance faible : ${spotify.confidence}`);
  assert.ok(spotify.is_active);
  assert.ok(spotify.next_expected, 'la prochaine échéance doit être estimée');
});

test('un loyer est classé comme loyer, pas comme abonnement', () => {
  const found = detectRecurring(monthly('loyer appartement', -650, 8), { now: NOW });
  assert.equal(found[0].kind, 'rent');
  assert.equal(found[0].average_amount, 650);
});

test('un salaire mensuel est détecté au crédit', () => {
  const found = detectRecurring(monthly('salaire entreprise', 2500, 7), { now: NOW });
  const salaire = found[0];
  assert.equal(salaire.direction, 'credit');
  assert.equal(salaire.kind, 'salary');
});

test('deux occurrences ne suffisent pas à faire une récurrence', () => {
  const found = detectRecurring(monthly('mystere', -40, 2), { now: NOW });
  assert.equal(found.length, 0, 'deux points font toujours une droite');
});

test('des dates franchement irrégulières ne produisent pas de récurrence', () => {
  const items = [3, 47, 51, 190, 205].map((d) => tx('aleatoire', -30, d));
  const found = detectRecurring(items, { now: NOW });
  assert.equal(found.length, 0);
});

test('un abonnement résilié est marqué inactif', () => {
  // 6 prélèvements, mais le dernier remonte à 8 mois.
  const items = Array.from({ length: 6 }, (_, i) =>
    tx('canal plus', -24.9, 240 + Math.round(i * 30.44)));
  const found = detectRecurring(items, { now: NOW });
  const canal = found.find((r) => r.merchant === 'canal plus');
  assert.ok(canal, 'la série doit rester détectée');
  assert.equal(canal.is_active, false, 'mais plus considérée comme active');
  assert.equal(canal.next_expected, null);
});

test('un même marchand sépare abonnement et achats ponctuels', () => {
  const items = [
    ...monthly('amazon', -6.99, 8),                    // Prime
    tx('amazon', -240, 12), tx('amazon', -180, 55), tx('amazon', -310, 92),
  ];
  const found = detectRecurring(items, { now: NOW });
  const prime = found.find((r) => r.merchant === 'amazon' && r.average_amount < 20);
  assert.ok(prime, 'l’abonnement Prime doit être isolé des commandes');
  assert.equal(prime.cadence, 'monthly');
  assert.ok(prime.average_amount < 10);
});

test('un jitter de quelques jours reste une cadence mensuelle', () => {
  const found = detectRecurring(monthly('edf', -78, 8, { jitterDays: 3 }), { now: NOW });
  assert.equal(found[0].cadence, 'monthly');
  assert.ok(found[0].confidence > 0.6);
});

test('le coût mensuel des abonnements ramène chaque cadence à une base commune', () => {
  const recurrings = [
    { is_active: true, direction: 'debit', cadence: 'monthly', average_amount: 12 },
    { is_active: true, direction: 'debit', cadence: 'yearly', average_amount: 120 },
    { is_active: true, direction: 'debit', cadence: 'weekly', average_amount: 7 },
    { is_active: false, direction: 'debit', cadence: 'monthly', average_amount: 50 },
    { is_active: true, direction: 'credit', cadence: 'monthly', average_amount: 2500 },
  ];
  const cost = monthlyRecurringCost(recurrings);
  assert.ok(Math.abs(cost - (12 + 10 + 7 * (30.44 / 7))) < 0.01,
    `coût mensuel inattendu : ${cost}`);
});

test('chaque cadence a un libellé lisible', () => {
  for (const code of ['weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'yearly']) {
    assert.ok(CADENCE_LABEL[code], `libellé manquant pour ${code}`);
  }
});

/* — Anomalies ————————————————————————————————————— */

test('un restaurant à 180 € ressort quand la moyenne tourne à 35 €', () => {
  const items = [
    ...[32, 38, 29, 41, 35, 30, 44, 36, 33, 39].map((v, i) => tx('resto', -v, i * 8, { category_id: 'cat-resto' })),
    tx('resto exceptionnel', -180, 4, { category_id: 'cat-resto' }),
  ];
  const found = detectAnomalies(items, { now: NOW });

  assert.equal(found.length, 1);
  assert.equal(found[0].amount, 180);
  assert.ok(found[0].score > 3.5);
  assert.ok(found[0].ratio > 4);
  assert.match(found[0].explanation, /180/);
  assert.equal(found[0].sample_size, 11);
});

test('moins de 8 observations : aucune détection tentée', () => {
  const items = [
    ...[32, 38, 29].map((v, i) => tx('resto', -v, i * 8, { category_id: 'cat-resto' })),
    tx('resto', -180, 4, { category_id: 'cat-resto' }),
  ];
  assert.equal(detectAnomalies(items, { now: NOW }).length, 0,
    'signaler une anomalie sur 4 points serait du bruit');
});

test('un écart statistiquement fort mais dérisoire en euros est ignoré', () => {
  const items = [
    ...Array.from({ length: 12 }, (_, i) => tx('cafe', -(2 + (i % 3) * 0.1), i * 5, { category_id: 'cat-bar' })),
    tx('cafe', -6, 2, { category_id: 'cat-bar' }),   // 3× la médiane, mais +4 €
  ];
  assert.equal(detectAnomalies(items, { now: NOW }).length, 0,
    '4 € de plus sur un café n’est pas une information');
});

test('un loyer rattaché à une récurrence n’est jamais une anomalie', () => {
  const items = [
    ...Array.from({ length: 10 }, (_, i) => tx('divers', -40, i * 9, { category_id: 'cat-log' })),
    tx('loyer', -650, 3, { category_id: 'cat-log', recurring_id: 'rec-1' }),
  ];
  assert.equal(detectAnomalies(items, { now: NOW }).length, 0);
});

test('les revenus et les transactions ignorées sont hors du champ', () => {
  const items = [
    ...Array.from({ length: 10 }, (_, i) => tx('divers', -40, i * 9, { category_id: 'c' })),
    tx('prime', 3000, 2, { category_id: 'c' }),
    tx('gros achat', -900, 1, { category_id: 'c', status: 'ignored' }),
  ];
  assert.equal(detectAnomalies(items, { now: NOW }).length, 0);
});

/* — Dérive budgétaire ————————————————————————————— */

test('la dérive budgétaire est calculée au prorata du mois écoulé', () => {
  // 250 € dépensés au 10 du mois → projection 750 €, contre 500 € d'habitude.
  const drifts = detectBudgetDrift(
    { 'cat-courses': 250 },
    { 'cat-courses': [480, 510, 495, 520] },
    { dayOfMonth: 10, daysInMonth: 30 });

  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].projected, 750);
  assert.ok(drifts[0].overshoot_pct > 45);
});

test('le 2 du mois, une dépense normale ne déclenche pas d’alerte', () => {
  const drifts = detectBudgetDrift(
    { 'cat-courses': 30 },
    { 'cat-courses': [480, 510, 495, 520] },
    { dayOfMonth: 2, daysInMonth: 30 });
  assert.equal(drifts.length, 0);
});

test('sans historique suffisant, pas de dérive annoncée', () => {
  assert.equal(detectBudgetDrift({ c: 900 }, { c: [500] }, { dayOfMonth: 15 }).length, 0);
});

/* — Statistiques ————————————————————————————————————— */

test('la MAD résiste aux valeurs extrêmes là où l’écart-type cède', () => {
  const normal = [30, 32, 31, 33, 29, 30, 31];
  const avecExtreme = [...normal, 5000];

  assert.equal(median(normal), 31);
  assert.equal(median(avecExtreme), 31);
  // La MAD bouge à peine, alors que l'écart-type explose.
  assert.ok(Math.abs(mad(avecExtreme) - mad(normal)) < 1.5);

  // Conséquence concrète : l'extrême reste détectable.
  assert.ok(robustScore(5000, avecExtreme) > 100);
});

test('normalize et piecewise restent bornés', () => {
  assert.equal(normalize(150, { low: 0, high: 100 }), 100);
  assert.equal(normalize(-50, { low: 0, high: 100 }), 0);
  assert.equal(normalize(25, { low: 0, high: 100, invert: true }), 75);
  assert.equal(normalize(50, { low: 10, high: 10 }), null);

  const points = [{ x: 0, y: 100 }, { x: 10, y: 0 }];
  assert.equal(piecewise(-5, points), 100);
  assert.equal(piecewise(5, points), 50);
  assert.equal(piecewise(15, points), 0);
});

test('le drawdown mesure bien la chute depuis le sommet', () => {
  const dd = drawdown([100, 120, 60, 80]);
  assert.equal(Math.round(dd.max * 100), -50);
  assert.equal(Math.round(dd.current * 100), -33);
  assert.equal(dd.peak, 120);
});
