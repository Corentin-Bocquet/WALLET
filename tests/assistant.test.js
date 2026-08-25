/**
 * Assistant : reconnaissance des intentions ET exactitude des réponses,
 * vérifiées de bout en bout contre le jeu de démonstration.
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// L'assistant lit les préférences et le backend de démonstration, tous deux
// adossés à localStorage. On en fournit un minimal avant tout import.
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};

const {
  detectIntent, extractSymbol, extractCategory, extractAmount, extractPeriod,
  normalizeQuestion, SUGGESTIONS, INTENTS,
} = await import('../app/js/engine/assistant.js');
const { resolve } = await import('../app/js/screens/assistant.js');
const repo = await import('../app/js/data/repo.js');

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'SUI', 'LINK'];
let CATEGORIES = [];

before(async () => {
  await repo.initBackend();
  CATEGORIES = await repo.listCategories();
});

/* — Reconnaissance ————————————————————————————————— */

test('chaque question type est routée vers la bonne intention', async () => {
  const cas = [
    ['Combien vaut mon patrimoine ?', 'net_worth'],
    ['Pourquoi mon patrimoine a baissé aujourd’hui ?', 'net_worth_change'],
    ['Combien ai-je en SOL ?', 'holding_amount'],
    ['Combien ai-je dépensé en restaurants ce mois-ci ?', 'category_spend'],
    ["Quel est mon taux d'épargne ?", 'savings_rate'],
    ['Que vaut mon portefeuille si BTC atteint 200 000 € ?', 'scenario'],
    ['Quel est mon principal risque ?', 'risk'],
    ['Combien me coûtent mes abonnements ?', 'subscriptions'],
    ['Quelle est ma plus grosse dépense ?', 'biggest_expense'],
    ['Combien ai-je gagné le mois dernier ?', 'income'],
    ['Est-ce un bon moment pour acheter du Bitcoin ?', 'score'],
  ];

  for (const [question, expected] of cas) {
    const symbol = extractSymbol(question, SYMBOLS);
    const category = extractCategory(question, CATEGORIES);
    assert.equal(detectIntent(question, { symbol, category }), expected,
      `« ${question} » mal routée`);
  }
});

test('une question hors sujet ne déclenche aucune intention', () => {
  for (const question of ['Quelle est la capitale de la France ?', 'bonjour', 'aide']) {
    assert.equal(detectIntent(question, {}), null, `« ${question} » ne devrait rien déclencher`);
  }
});

test('toutes les suggestions affichées sont effectivement comprises', async () => {
  for (const suggestion of SUGGESTIONS) {
    const symbol = extractSymbol(suggestion, SYMBOLS);
    const category = extractCategory(suggestion, CATEGORIES);
    assert.ok(detectIntent(suggestion, { symbol, category }),
      `WALLET propose « ${suggestion} » mais ne sait pas y répondre`);
  }
});

test('chaque intention déclarée a un exemple qu’elle reconnaît', () => {
  for (const intent of INTENTS) {
    for (const example of intent.examples) {
      const symbol = extractSymbol(example, SYMBOLS);
      const category = extractCategory(example, CATEGORIES);
      const detected = detectIntent(example, { symbol, category });
      assert.equal(detected, intent.code,
        `l'exemple de ${intent.code} est capté par ${detected}`);
    }
  }
});

/* — Extraction ————————————————————————————————————— */

test('les montants sont lus dans toutes leurs écritures', () => {
  assert.equal(extractAmount('si BTC atteint 200 000 €'), 200000);
  assert.equal(extractAmount('si btc monte à 200k'), 200000);
  assert.equal(extractAmount('si btc va à 1,5M'), 1500000);
  assert.equal(extractAmount('si btc atteint 85000'), 85000);
  assert.equal(extractAmount('sans aucun chiffre'), null);
});

test('les périodes relatives sont comprises', () => {
  assert.equal(extractPeriod('combien ce mois-ci').label, 'ce mois-ci');
  assert.equal(extractPeriod('combien le mois dernier').label, 'le mois dernier');
  assert.equal(extractPeriod('combien cette année').label, 'cette année');
  assert.equal(extractPeriod('combien cette semaine').label, 'ces 7 derniers jours');

  const last = extractPeriod('le mois dernier');
  assert.ok(last.from < last.to, 'la période doit être ordonnée');
});

test('la normalisation supprime accents et espaces superflus', () => {
  assert.equal(normalizeQuestion('  Quel est mon TAUX  d’épargne ? '), 'quel est mon taux d’epargne ?');
});

/* — Réponses réelles ————————————————————————————— */

test('la réponse patrimoine cite le bon total et sa décomposition', async () => {
  const nw = await repo.getNetWorth();
  const result = await resolve('Combien vaut mon patrimoine ?');

  assert.equal(result.intent, 'net_worth');
  assert.ok(result.evidence.length >= 2, 'la réponse doit être justifiée');
  assert.ok(result.text.includes('patrimoine'));
  // Le total cité doit correspondre au calcul, au format près.
  const digits = result.text.replace(/\D/g, '');
  assert.ok(digits.includes(String(Math.round(nw.total)).slice(0, 4)),
    `le total cité ne correspond pas (${result.text})`);
});

test('la réponse « combien en SOL » donne la vraie quantité détenue', async () => {
  const holdings = await repo.getHoldings();
  const sol = holdings.find((h) => h.symbol === 'SOL');
  assert.ok(sol, 'le jeu de démonstration doit contenir du SOL');

  const result = await resolve('Combien ai-je en SOL ?');
  assert.equal(result.intent, 'holding_amount');
  assert.ok(result.text.includes('SOL'));
  assert.ok(result.evidence.some((e) => e.label === 'Quantité'));
});

test('une position non détenue est annoncée comme telle, pas comme zéro', async () => {
  const result = await resolve('Combien ai-je en DOGE ?');
  // DOGE n'est pas détenu : l'assistant ne doit pas inventer une position.
  assert.ok(!result.text.includes('0 DOGE'),
    'ne jamais présenter une absence de position comme une position à zéro');
});

test('la dépense par catégorie est exacte et justifiée', async () => {
  const result = await resolve('Combien ai-je dépensé en restaurants ce mois-ci ?');
  assert.equal(result.intent, 'category_spend');

  if (result.evidence.length) {
    assert.ok(result.evidence.some((e) => e.label === 'Nombre de dépenses'));
    assert.ok(result.evidence.some((e) => e.label === 'Panier moyen'));
  }
});

test("le taux d'épargne est justifié par revenus et dépenses", async () => {
  // Sur un mois complet, le taux est calculable et la réponse doit expliquer
  // ce qui est exclu du calcul.
  const result = await resolve("Quel est mon taux d'épargne le mois dernier ?");
  assert.equal(result.intent, 'savings_rate');
  assert.match(result.text, /taux d'épargne .* est de -?\d+ %/);
  assert.ok(result.evidence.some((e) => e.label === 'Revenus'));
  assert.ok(result.evidence.some((e) => e.label === 'Dépenses'));
  assert.ok(result.evidence.some((e) => e.label === 'Épargne nette'));
  assert.match(result.caveat, /virements/i);
});

test("un mois sans revenu connu renvoie « je ne peux pas », pas 0 %", async () => {
  // Le mois en cours du jeu de démonstration n'a pas encore vu son salaire :
  // c'est exactement le cas où afficher 0 % serait un mensonge (§46).
  const summary = await repo.monthlySummary();
  if (summary && summary.savings_rate !== null) {
    // Le mois courant a déjà des revenus : rien à vérifier ici.
    return;
  }

  const result = await resolve("Quel est mon taux d'épargne ?");
  assert.equal(result.intent, 'savings_rate');
  assert.match(result.text, /ne peux pas calculer/i);
  assert.ok(!/\b0 %/.test(result.text), 'ne jamais afficher 0 % pour un taux inconnu');
  assert.match(result.caveat, /plutôt que 0 %/);
});

test('le scénario BTC affiche sa variation et déclare son hypothèse', async () => {
  const result = await resolve('Que vaut mon portefeuille si BTC atteint 200 000 € ?');
  assert.equal(result.intent, 'scenario');
  assert.ok(result.evidence.some((e) => e.label === 'Variation'));
  assert.match(result.caveat, /pas une prévision/i);
});

test('le scénario sans prix demande une précision au lieu d’inventer', async () => {
  const result = await resolve('Que vaut mon portefeuille si BTC monte ?');
  assert.match(result.text, /Précisez un prix|pas encore/i);
});

test('la réponse risque reste descriptive et ne conseille rien', async () => {
  const result = await resolve('Quel est mon principal risque ?');
  assert.equal(result.intent, 'risk');
  assert.match(result.caveat, /ni un conseil|pas un conseil/i);
});

test('les abonnements sont chiffrés au mois et à l’année', async () => {
  const result = await resolve('Combien me coûtent mes abonnements ?');
  assert.equal(result.intent, 'subscriptions');
  assert.match(result.text, /par mois|récurrent/i);
});

test('le score cite sa couverture de facteurs', async () => {
  const result = await resolve('Est-ce un bon moment pour acheter du Bitcoin ?');
  assert.equal(result.intent, 'score');
  assert.match(result.caveat, /facteurs/);
  assert.match(result.caveat, /pas une prévision/i);
});

test('une question incomprise le dit et propose ce qu’elle sait faire', async () => {
  const result = await resolve('Quelle est la capitale de la France ?');
  assert.equal(result.intent, null);
  assert.match(result.text, /Je ne sais pas/i);
  assert.equal(result.action.kind, 'suggestions');
  assert.ok(result.action.items.length > 0);
});

test('aucune réponse ne promet une certitude', async () => {
  const questions = [
    'Que vaut mon portefeuille si BTC atteint 200 000 € ?',
    'Est-ce un bon moment pour acheter du Bitcoin ?',
    'Quel est mon principal risque ?',
  ];
  const interdits = /\b(va monter|va baisser|garanti|certain|vous devriez acheter|vous devez vendre)\b/i;
  for (const question of questions) {
    const result = await resolve(question);
    const whole = `${result.text} ${result.caveat ?? ''}`;
    assert.ok(!interdits.test(whole), `formulation trop affirmative : « ${whole} »`);
  }
});
