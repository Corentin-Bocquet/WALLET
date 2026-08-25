/**
 * Moteur de catégorisation : ordre de priorité, apprentissage, exceptions.
 * Reproduit les scénarios décrits au cahier des charges (§10 à §17).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categorize, memoryConfidence, LEXICON, selectSimilarTransactions,
} from '../app/js/engine/categorizer.js';
import { normalizeLabel, amountBucket } from '../app/js/engine/normalize.js';

/* — Fixtures ————————————————————————————————————————— */

const CATS = [
  ['alimentation', '🛒'], ['restaurant', '🍔'], ['bar', '🍻'], ['alcool', '🍷'],
  ['transport', '🚗'], ['abonnements', '🔄'], ['shopping', '🛍️'], ['autres', '📦'],
  ['salaire', '💼'], ['revenus', '💶'], ['loisirs', '🎮'], ['sport', '🏋️'],
  ['logement', '🏠'], ['sante', '🩺'], ['voyage', '✈️'], ['etudes', '🎓'],
  ['frais-bancaires', '🏦'], ['impots', '🧾'], ['cadeaux', '🎁'],
  ['remboursement', '↩️'], ['dividendes', '📈'], ['investissement', '📊'],
  ['transfert', '🔁'],
].map(([slug, emoji], i) => ({ id: `cat-${slug}`, slug, emoji, label: slug, color: '#fff' }));

const categoriesBySlug = new Map(CATS.map((c) => [c.slug, c]));
const categoriesById = new Map(CATS.map((c) => [c.id, c]));

function tx(raw_label, amount, extra = {}) {
  const clean = normalizeLabel(raw_label);
  return {
    account_id: 'acc-1', raw_label, clean_label: clean, merchant: clean,
    amount, ...extra,
  };
}

const base = { categoriesBySlug, categoriesById, askBelow: 0.6 };

/* — 1. Priorité des règles ————————————————————————— */

test('une règle utilisateur bat tout le reste', () => {
  const rules = [{
    id: 'r1', category_id: 'cat-sport', match_type: 'contains',
    pattern: 'amazon', priority: 200, is_active: true,
  }];
  // La mémoire dit "shopping", le lexique dit "shopping" : la règle gagne.
  const memory = [{ key_value: 'amazon', amount_bucket: 'medium',
    category_id: 'cat-shopping', hits: 20, corrections: 5 }];

  const out = categorize(tx('CB AMAZON.FR 12/03', -45), { ...base, rules, memory });
  assert.equal(out.slug, 'sport');
  assert.equal(out.source, 'rule');
  assert.equal(out.confidence, 1);
  assert.match(out.reason.label, /Votre règle/);
});

test("une règle bornée en montant ne s'applique pas hors de sa plage", () => {
  const rules = [{
    id: 'r1', category_id: 'cat-transport', match_type: 'contains',
    pattern: 'uber', priority: 200, is_active: true, amount_max: 30,
  }];
  const petit = categorize(tx('CB UBER 12/03', -12), { ...base, rules });
  const gros = categorize(tx('CB UBER 12/03', -95), { ...base, rules });

  assert.equal(petit.source, 'rule');
  assert.equal(gros.source, 'heuristic', 'au-delà de 30 € la règle ne joue plus');
});

test("une règle 'credit' ignore les débits", () => {
  const rules = [{
    id: 'r1', category_id: 'cat-salaire', match_type: 'contains',
    pattern: 'dupont', priority: 200, is_active: true, sign: 'credit',
  }];
  assert.equal(categorize(tx('VIR DUPONT', 2500), { ...base, rules }).source, 'rule');
  assert.equal(categorize(tx('VIR DUPONT', -80), { ...base, rules }).source, 'none');
});

/* — 2. Le scénario du cahier des charges (§10) ————————— */

test('BIÈRE BAR X : corrigé en Restaurants, retrouvé en Restaurants', () => {
  const t = tx('CB BIERE BAR X 12/01', -18.4);

  // Mois 1, sans mémoire : le lexique propose "bar" ou "alcool".
  const avant = categorize(t, base);
  assert.ok(['bar', 'alcool'].includes(avant.slug), `attendu bar/alcool, reçu ${avant.slug}`);
  assert.equal(avant.source, 'heuristic');

  // L'utilisateur corrige → la base écrit une mémoire (cf. SQL 0007).
  const memory = [
    { key_value: 'biere bar x', amount_bucket: 'small', category_id: 'cat-restaurant', hits: 3, corrections: 1 },
    { key_value: 'biere bar x', amount_bucket: 'any',   category_id: 'cat-restaurant', hits: 1, corrections: 1 },
  ];

  // Mois 2, même marchand, montant voisin.
  const apres = categorize(tx('CB BIERE BAR X 12/02', -19.9), { ...base, memory });
  assert.equal(apres.slug, 'restaurant');
  assert.equal(apres.source, 'memory');
  assert.ok(apres.confidence > 0.75, `confiance trop basse : ${apres.confidence}`);
  assert.ok(!apres.needsConfirmation);
});

test('Uber Eats corrigé en Alimentation : la confiance monte avec les répétitions', () => {
  const t = tx('CB UBER EATS 03/04', -24);

  const une = categorize(t, { ...base, memory: [
    { key_value: 'uber eats', amount_bucket: 'small', category_id: 'cat-alimentation', hits: 3, corrections: 1 }] });
  const cinq = categorize(t, { ...base, memory: [
    { key_value: 'uber eats', amount_bucket: 'small', category_id: 'cat-alimentation', hits: 15, corrections: 5 }] });

  assert.equal(une.slug, 'alimentation');
  assert.equal(cinq.slug, 'alimentation');
  assert.ok(cinq.confidence > une.confidence, 'la répétition doit renforcer la confiance');
  assert.ok(cinq.confidence <= 0.97, 'la mémoire ne doit jamais prétendre à la certitude');
});

/* — 3. Les exceptions (§12) ————————————————————————— */

test('Amazon : le petit montant et le gros montant ne partagent pas la mémoire', () => {
  const memory = [
    { key_value: 'amazon', amount_bucket: 'small', category_id: 'cat-alimentation', hits: 6, corrections: 2 },
    { key_value: 'amazon', amount_bucket: 'any',   category_id: 'cat-alimentation', hits: 2, corrections: 2 },
  ];

  const petit = categorize(tx('CB AMAZON 21/02', -12), { ...base, memory });
  const gros  = categorize(tx('CB AMAZON 20/02', -480), { ...base, memory });

  assert.equal(petit.slug, 'alimentation', 'le seau exact doit primer');
  assert.equal(petit.reason.bucket, 'small');

  // Le gros montant retombe sur la mémoire généralisée, mais avec MOINS de
  // confiance : c'est une extrapolation, pas une observation.
  assert.equal(gros.slug, 'alimentation');
  assert.equal(gros.reason.bucket, 'any');
  assert.ok(gros.confidence < petit.confidence,
    `la généralisation doit être moins sûre (${gros.confidence} vs ${petit.confidence})`);
});

test('une catégorie concurrente sur la même clé fait baisser la confiance', () => {
  const sans = categorize(tx('CB AMAZON', -45), { ...base, memory: [
    { key_value: 'amazon', amount_bucket: 'medium', category_id: 'cat-shopping', hits: 8, corrections: 2 }] });

  const avec = categorize(tx('CB AMAZON', -45), { ...base, memory: [
    { key_value: 'amazon', amount_bucket: 'medium', category_id: 'cat-shopping', hits: 8, corrections: 2 },
    { key_value: 'amazon', amount_bucket: 'medium', category_id: 'cat-alimentation', hits: 6, corrections: 2 }] });

  assert.equal(avec.slug, 'shopping', 'la plus forte gagne quand même');
  assert.ok(avec.confidence < sans.confidence, 'mais la concurrence doit semer le doute');
});

/* — 4. Confiance et demande à l'utilisateur (§15) ————— */

test('sous le seuil, WALLET demande au lieu de deviner', () => {
  const out = categorize(tx('PAIEMENT SARL MJK 4478', -63), base);
  assert.equal(out.source, 'none');
  assert.equal(out.confidence, 0);
  assert.ok(out.needsConfirmation, 'doit être mis en file « à classer »');
  assert.ok(out.alternatives.length > 0, 'doit proposer des pistes');
});

test('memoryConfidence est monotone et bornée', () => {
  let previous = 0;
  for (const hits of [1, 2, 3, 5, 8, 13, 21, 50, 200]) {
    const c = memoryConfidence({ hits, corrections: 0, exactBucket: true });
    assert.ok(c >= previous, `non monotone à hits=${hits}`);
    assert.ok(c <= 0.97, `dépasse le plafond à hits=${hits}`);
    previous = c;
  }
  assert.ok(memoryConfidence({ hits: 3, corrections: 3, exactBucket: true })
          > memoryConfidence({ hits: 3, corrections: 0, exactBucket: true }),
    'une correction explicite doit peser plus qu’une simple occurrence');
});

/* — 5. Apprentissage des exclusions (§13) ————————————— */

test("l'habitude d'ignorer est suggérée, jamais appliquée d'office", () => {
  const ignoreMemory = [{ key_value: 'biere bar x', amount_bucket: 'small',
    ignored_count: 5, kept_count: 1 }];
  const out = categorize(tx('CB BIERE BAR X', -14), { ...base, ignoreMemory });

  assert.ok(out.suggestIgnore, 'devrait proposer d’exclure');
  assert.match(out.suggestIgnore.detail, /restera dans votre historique/);
  assert.notEqual(out.source, 'ignored', 'aucune exclusion automatique');
});

test('une habitude ambiguë ne déclenche aucune suggestion', () => {
  const ignoreMemory = [{ key_value: 'biere bar x', amount_bucket: 'small',
    ignored_count: 3, kept_count: 3 }];
  const out = categorize(tx('CB BIERE BAR X', -14), { ...base, ignoreMemory });
  assert.equal(out.suggestIgnore, null);
});

/* — 6. Récurrences et lexique ————————————————————————— */

test('un abonnement déjà identifié est reconnu', () => {
  const recurring = [{ merchant: 'spotify', label: 'Spotify', category_id: 'cat-abonnements',
    occurrences: 9, is_active: true }];
  const out = categorize(tx('PRLV SPOTIFY 05/03', -11.12), { ...base, recurring });
  assert.equal(out.slug, 'abonnements');
  assert.equal(out.source, 'recurring');
});

test('le lexique ne se déclenche pas sur un fragment de mot', () => {
  // « bar » est dans le lexique ; « barbara » ne doit pas matcher en mot entier.
  const out = categorize(tx('VIR BARBARA MARTIN', 150), base);
  assert.notEqual(out.slug, 'bar', 'faux positif sur un fragment');
});

test('le lexique couvre les enseignes françaises courantes', () => {
  const cas = [
    ['CB CARREFOUR MARKET 12/03', -54, 'alimentation'],
    ['PRLV NETFLIX.COM', -13.49, 'abonnements'],
    ['CB SNCF CONNECT', -87, 'transport'],
    ['CB PHARMACIE DU CENTRE', -12.4, 'sante'],
    ['CB DECATHLON 04/02', -65, 'sport'],
    ['CB BOOKING.COM', -230, 'voyage'],
    ['PRLV DGFIP IMPOT REVENU', -180, 'impots'],
  ];
  for (const [label, amount, expected] of cas) {
    const out = categorize(tx(label, amount), base);
    assert.equal(out.slug, expected, `${label} → ${out.slug} (attendu ${expected})`);
  }
});

test('le lexique ne référence que des catégories qui existent', () => {
  for (const slug of Object.keys(LEXICON)) {
    assert.ok(categoriesBySlug.has(slug), `catégorie manquante pour le lexique : ${slug}`);
  }
});

/* — 7. Toute décision est explicable (§47) ————————————— */

test('chaque résultat porte une raison lisible', () => {
  const cas = [
    categorize(tx('CB CARREFOUR', -54), base),
    categorize(tx('CB INCONNU XYZ', -20), base),
    categorize(tx('CB AMAZON', -45), { ...base, memory: [
      { key_value: 'amazon', amount_bucket: 'medium', category_id: 'cat-shopping', hits: 4, corrections: 1 }] }),
  ];
  for (const out of cas) {
    assert.ok(out.reason?.label, 'raison absente');
    assert.ok(out.reason?.detail, 'détail absent');
    assert.ok(typeof out.confidence === 'number');
    assert.ok(out.bucket && amountBucket(-45));
  }
});

/* — 8. Étendre une correction aux transactions similaires ————— */

test("l'extension d'une correction respecte l'ordre de grandeur", () => {
  const rows = [
    { id: 'a', merchant: 'amazon', amount: -12, category_id: 'cat-shopping', category_source: 'heuristic' },
    { id: 'b', merchant: 'amazon', amount: -24, category_id: 'cat-shopping', category_source: 'heuristic' },
    { id: 'c', merchant: 'amazon', amount: -480, category_id: 'cat-shopping', category_source: 'heuristic' },
    { id: 'd', merchant: 'carrefour', amount: -22, category_id: 'cat-shopping', category_source: 'heuristic' },
  ];

  const similar = selectSimilarTransactions(rows, {
    excludeId: 'a', key: 'amazon', bucket: 'small', categoryId: 'cat-alimentation',
  });

  assert.deepEqual(similar.map((t) => t.id), ['b'],
    'seul l’autre petit Amazon doit être proposé');
});

test("un choix explicite de l'utilisateur n'est jamais écrasé", () => {
  const rows = [
    { id: 'b', merchant: 'amazon', amount: -24, category_id: 'cat-shopping', category_source: 'user' },
    { id: 'c', merchant: 'amazon', amount: -18, category_id: 'cat-shopping', category_source: 'memory' },
  ];
  const similar = selectSimilarTransactions(rows, {
    excludeId: 'a', key: 'amazon', bucket: 'small', categoryId: 'cat-alimentation',
  });
  assert.deepEqual(similar.map((t) => t.id), ['c']);
});

test('les transactions déjà dans la bonne catégorie ne sont pas proposées', () => {
  const rows = [
    { id: 'b', merchant: 'amazon', amount: -24, category_id: 'cat-alimentation', category_source: 'memory' },
  ];
  assert.equal(selectSimilarTransactions(rows, {
    excludeId: 'a', key: 'amazon', bucket: 'small', categoryId: 'cat-alimentation',
  }).length, 0);
});

test('sans seau précisé, tous les montants du marchand sont concernés', () => {
  const rows = [
    { id: 'b', merchant: 'amazon', amount: -24, category_id: 'cat-shopping', category_source: 'heuristic' },
    { id: 'c', merchant: 'amazon', amount: -480, category_id: 'cat-shopping', category_source: 'heuristic' },
  ];
  assert.equal(selectSimilarTransactions(rows, {
    excludeId: 'a', key: 'amazon', categoryId: 'cat-alimentation',
  }).length, 2);
});
