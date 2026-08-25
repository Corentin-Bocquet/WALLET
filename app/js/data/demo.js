/**
 * WALLET · Jeu de démonstration
 *
 * Sert à deux choses :
 *   1. rendre l'application utilisable et vérifiable AVANT que vos comptes
 *      Kraken / OKX / Boursorama soient connectés ;
 *   2. faire tourner les moteurs sur des données réalistes pendant le
 *      développement.
 *
 * Deux garanties :
 *   · le générateur est DÉTERMINISTE (même graine → mêmes données), sinon
 *     l'interface changerait à chaque rechargement ;
 *   · les prix sont SYNTHÉTIQUES et l'interface l'affiche en clair. Aucune
 *     donnée de démonstration n'est jamais présentée comme réelle (§51).
 */

import { normalizeLabel, fingerprint } from '../engine/normalize.js';

/* — Générateur pseudo-aléatoire déterministe (mulberry32) ————— */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/* ================================================================== */
/* Catégories                                                          */
/* ================================================================== */

export const DEMO_CATEGORIES = [
  ['alimentation', 'Alimentation', '🛒', '#4CD964', 'expense'],
  ['restaurant', 'Restaurants', '🍔', '#FF9F0A', 'expense'],
  ['bar', 'Bars & cafés', '🍻', '#FFD60A', 'expense'],
  ['alcool', 'Alcool', '🍷', '#BF5AF2', 'expense'],
  ['transport', 'Transport', '🚗', '#0A84FF', 'expense'],
  ['logement', 'Logement', '🏠', '#5E5CE6', 'expense'],
  ['abonnements', 'Abonnements', '🔄', '#64D2FF', 'expense'],
  ['loisirs', 'Loisirs', '🎮', '#FF375F', 'expense'],
  ['shopping', 'Shopping', '🛍️', '#FF2D55', 'expense'],
  ['voyage', 'Voyage', '✈️', '#30D158', 'expense'],
  ['sante', 'Santé', '🩺', '#FF453A', 'expense'],
  ['etudes', 'Études', '🎓', '#AC8E68', 'expense'],
  ['sport', 'Sport', '🏋️', '#32D74B', 'expense'],
  ['frais-bancaires', 'Frais bancaires', '🏦', '#8E8E93', 'expense'],
  ['impots', 'Impôts & taxes', '🧾', '#98989D', 'expense'],
  ['cadeaux', 'Cadeaux & dons', '🎁', '#FF6482', 'expense'],
  ['autres', 'Autres', '📦', '#8E8E93', 'expense'],
  ['salaire', 'Salaire', '💼', '#30D158', 'income'],
  ['revenus', 'Autres revenus', '💶', '#4CD964', 'income'],
  ['remboursement', 'Remboursements', '↩️', '#64D2FF', 'income'],
  ['dividendes', 'Dividendes & intérêts', '📈', '#BFF23A', 'income'],
  ['investissement', 'Investissement', '📊', '#BFF23A', 'investment'],
  ['transfert', 'Transfert interne', '🔁', '#636366', 'transfer'],
].map(([slug, label, emoji, color, kind], i) => ({
  id: `cat-${slug}`, slug, label, emoji, color, kind,
  is_system: true, sort_order: i * 10, budget_month: null,
}));

/* ================================================================== */
/* Marchands récurrents et ponctuels                                   */
/* ================================================================== */

const RECURRING_MERCHANTS = [
  { label: 'PRLV SEPA LOYER APPARTEMENT', amount: -680, day: 3, slug: 'logement' },
  { label: 'VIR SEPA SALAIRE ENTREPRISE', amount: 2480, day: 27, slug: 'salaire', jitter: 40 },
  { label: 'PRLV SPOTIFY AB1234', amount: -11.12, day: 5, slug: 'abonnements' },
  { label: 'PRLV NETFLIX.COM', amount: -13.49, day: 12, slug: 'abonnements' },
  { label: 'PRLV FREE MOBILE 0612', amount: -19.99, day: 8, slug: 'abonnements' },
  { label: 'PRLV EDF ELECTRICITE', amount: -74, day: 15, slug: 'logement', jitter: 12 },
  { label: 'PRLV BASIC FIT FRANCE', amount: -29.99, day: 2, slug: 'sport' },
  { label: 'PRLV MAAF ASSURANCE HABITATION', amount: -18.4, day: 10, slug: 'logement' },
  { label: 'PRLV NAVIGO ANNUEL', amount: -86.4, day: 6, slug: 'transport' },
  { label: 'FRAIS TENUE DE COMPTE', amount: -2, day: 28, slug: 'frais-bancaires' },
  { label: 'VIR SEPA EPARGNE LIVRET A', amount: -400, day: 28, slug: 'transfert' },
];

const ONE_OFF = [
  { label: 'CB CARREFOUR MARKET', slug: 'alimentation', min: 16, max: 74, weekly: 1.2 },
  { label: 'CB LIDL', slug: 'alimentation', min: 11, max: 44, weekly: 0.5 },
  { label: 'CB BOULANGERIE MARTIN', slug: 'alimentation', min: 2.4, max: 9.8, weekly: 1.8 },
  { label: 'CB UBER EATS', slug: 'restaurant', min: 14, max: 34, weekly: 0.5 },
  { label: 'CB LE COMPTOIR RESTAURANT', slug: 'restaurant', min: 20, max: 52, weekly: 0.35 },
  { label: 'CB BIERE BAR X', slug: 'bar', min: 8, max: 24, weekly: 0.7 },
  { label: 'CB STARBUCKS', slug: 'bar', min: 3.5, max: 8.9, weekly: 0.6 },
  { label: 'CB SNCF CONNECT', slug: 'transport', min: 22, max: 92, weekly: 0.12 },
  { label: 'CB TOTALENERGIES STATION', slug: 'transport', min: 40, max: 68, weekly: 0.22 },
  { label: 'CB AMAZON.FR', slug: 'shopping', min: 9, max: 96, weekly: 0.45 },
  { label: 'CB FNAC', slug: 'shopping', min: 14, max: 88, weekly: 0.08 },
  { label: 'CB DECATHLON', slug: 'sport', min: 16, max: 78, weekly: 0.1 },
  { label: 'CB PHARMACIE DU CENTRE', slug: 'sante', min: 6, max: 42, weekly: 0.22 },
  { label: 'CB UGC CINE CITE', slug: 'loisirs', min: 11, max: 24, weekly: 0.3 },
  { label: 'CB STEAM GAMES', slug: 'loisirs', min: 6, max: 44, weekly: 0.15 },
  { label: 'CB BOOKING.COM', slug: 'voyage', min: 110, max: 320, weekly: 0.03 },
  { label: 'CB ZARA', slug: 'shopping', min: 22, max: 88, weekly: 0.12 },
  { label: 'VIR RECU REMBOURSEMENT AMELI', slug: 'remboursement', min: 12, max: 68, weekly: 0.12, credit: true },
];

/* ================================================================== */
/* Génération des transactions bancaires                               */
/* ================================================================== */

export function generateTransactions({ months = 18, seed = 20260101, accountId = 'acc-bank' } = {}) {
  const rand = rng(seed);
  const now = new Date();
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - months * 30.44 * DAY;

  const rows = [];
  const push = (label, amount, ms, slug, extra = {}) => {
    const booked_at = iso(ms);
    const clean = normalizeLabel(label);
    rows.push({
      id: `demo-tx-${rows.length + 1}`,
      account_id: accountId,
      booked_at,
      value_at: booked_at,
      amount: Math.round(amount * 100) / 100,
      currency: 'EUR',
      raw_label: label,
      clean_label: clean,
      merchant: clean,
      operation_type: label.startsWith('PRLV') ? 'PRLV' : label.startsWith('VIR') ? 'VIR' : 'CARTE',
      status: 'active',
      demo_slug: slug,
      fingerprint: fingerprint({ account_id: accountId, booked_at, amount, raw_label: label }),
      ...extra,
    });
  };

  /* Récurrences : chaque mois, au jour prévu, avec un léger flottement. */
  for (let m = 0; m <= months; m += 1) {
    const monthStart = new Date(start + m * 30.44 * DAY);
    const y = monthStart.getUTCFullYear();
    const mo = monthStart.getUTCMonth();

    for (const item of RECURRING_MERCHANTS) {
      const drift = Math.round((rand() - 0.5) * 2);          // ±1 jour
      const ms = Date.UTC(y, mo, item.day + drift);
      if (ms < start || ms > end) continue;
      const jitter = item.jitter ? (rand() - 0.5) * item.jitter : 0;
      push(item.label, item.amount + jitter, ms, item.slug);
    }
  }

  /* Dépenses ponctuelles, tirées semaine par semaine. */
  const weeks = Math.ceil((end - start) / (7 * DAY));
  for (let w = 0; w < weeks; w += 1) {
    for (const item of ONE_OFF) {
      let draws = Math.floor(item.weekly);
      if (rand() < item.weekly - draws) draws += 1;
      for (let k = 0; k < draws; k += 1) {
        const ms = start + w * 7 * DAY + Math.floor(rand() * 7) * DAY;
        if (ms > end) continue;
        const amount = item.min + rand() * (item.max - item.min);
        push(item.label, item.credit ? amount : -amount, ms, item.slug);
      }
    }
  }

  /* Quelques faits marquants, pour que les écrans aient de la matière. */
  const anomalyDay = end - 9 * DAY;
  push('CB LE GRAND RESTAURANT', -184.5, anomalyDay, 'restaurant');
  push('CB APPLE STORE', -1249, end - 214 * DAY, 'shopping');
  push('VIR RECU PRIME ANNUELLE', 1200, end - 74 * DAY, 'salaire');
  push('CB KRAKEN ACHAT BTC', -500, end - 21 * DAY, 'investissement');
  push('CB KRAKEN ACHAT BTC', -500, end - 52 * DAY, 'investissement');
  push('CB KRAKEN ACHAT BTC', -500, end - 83 * DAY, 'investissement');

  return rows.sort((a, b) => (a.booked_at < b.booked_at ? 1 : -1));
}

/* ================================================================== */
/* Marché : actifs et séries de prix synthétiques                      */
/* ================================================================== */

export const DEMO_ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', start: 4200, vol: 0.032, drift: 0.00088, beta: 1, rank: 1, supply: 19.8e6 },
  { symbol: 'ETH', name: 'Ethereum', start: 140, vol: 0.038, drift: 0.00082, beta: 1.15, rank: 2, supply: 120.4e6 },
  { symbol: 'SOL', name: 'Solana', start: 2.2, vol: 0.055, drift: 0.00128, beta: 1.6, rank: 5, supply: 470e6 },
  { symbol: 'SUI', name: 'Sui', start: 0.9, vol: 0.06, drift: 0.00042, beta: 1.7, rank: 18, supply: 3.1e9 },
  { symbol: 'AVAX', name: 'Avalanche', start: 12, vol: 0.05, drift: 0.00030, beta: 1.45, rank: 22, supply: 410e6 },
  { symbol: 'LINK', name: 'Chainlink', start: 6.5, vol: 0.045, drift: 0.00050, beta: 1.3, rank: 14, supply: 640e6 },
  { symbol: 'XRP', name: 'XRP', start: 0.3, vol: 0.048, drift: 0.00058, beta: 1.2, rank: 4, supply: 57e9 },
  { symbol: 'ADA', name: 'Cardano', start: 0.28, vol: 0.047, drift: 0.00022, beta: 1.35, rank: 11, supply: 35e9 },
  { symbol: 'DOT', name: 'Polkadot', start: 5.4, vol: 0.049, drift: 0.00005, beta: 1.4, rank: 26, supply: 1.5e9 },
  { symbol: 'MATIC', name: 'Polygon', start: 0.42, vol: 0.052, drift: 0.00010, beta: 1.5, rank: 34, supply: 10e9 },
].map((a, i) => ({
  ...a,
  id: `asset-${a.symbol.toLowerCase()}`,
  kind: 'crypto',
  external_id: a.name.toLowerCase(),
  source: 'demo',
  is_stablecoin: false,
}));

/**
 * Série quotidienne sur `days` jours. Les altcoins suivent le BTC par leur
 * bêta plus un bruit propre : c'est ce qui rend les corrélations affichées
 * cohérentes entre elles.
 */
export function generatePriceHistory({ days = 2200, seed = 7 } = {}) {
  const rand = rng(seed);
  const end = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const start = end - days * DAY;

  // Facteur de marché commun, avec un cycle lent de ~4 ans.
  const market = [];
  let shock = 0;
  for (let i = 0; i < days; i += 1) {
    const cycle = Math.sin((i / 1460) * Math.PI * 2 - 1.1) * 0.0011;
    shock = shock * 0.92 + (rand() - 0.5) * 0.014;
    market.push(cycle + shock * 0.22);
  }

  const histories = new Map();

  for (const asset of DEMO_ASSETS) {
    const own = rng(seed + asset.symbol.charCodeAt(0) * 977);
    let price = asset.start;
    const series = [];
    for (let i = 0; i < days; i += 1) {
      const idio = (own() - 0.5) * asset.vol;
      price *= 1 + asset.drift + market[i] * asset.beta + idio;
      price = Math.max(price, asset.start * 0.02);
      series.push({ day: iso(start + i * DAY), close: Math.round(price * 1e6) / 1e6 });
    }
    histories.set(asset.id, series);
  }

  return histories;
}

/** Cotation courante déduite de la série, avec ATH/ATL réels de la série. */
export function quoteFromHistory(asset, series) {
  const closes = series.map((p) => p.close);
  const price = closes[closes.length - 1];
  const athIndex = closes.indexOf(Math.max(...closes));
  const atlIndex = closes.indexOf(Math.min(...closes));
  const at = (back) => closes[Math.max(0, closes.length - 1 - back)];

  return {
    asset_id: asset.id,
    currency: 'EUR',
    price,
    market_cap: price * asset.supply,
    volume_24h: price * asset.supply * (0.01 + (asset.vol * 0.6)),
    circulating_supply: asset.supply,
    total_supply: asset.supply,
    max_supply: asset.symbol === 'BTC' ? 21e6 : null,
    ath: closes[athIndex],
    ath_date: series[athIndex].day,
    atl: closes[atlIndex],
    atl_date: series[atlIndex].day,
    change_24h: pctChange(price, at(1)),
    change_7d: pctChange(price, at(7)),
    change_30d: pctChange(price, at(30)),
    change_1y: pctChange(price, at(365)),
    fetched_at: new Date().toISOString(),
    is_demo: true,
  };
}

const pctChange = (now, before) =>
  (Number.isFinite(before) && before > 0 ? Math.round((now / before - 1) * 10000) / 100 : null);

/* ================================================================== */
/* Comptes et avoirs                                                   */
/* ================================================================== */

export const DEMO_ACCOUNTS = [
  { id: 'acc-bank', kind: 'bank', provider: 'boursorama', label: 'Compte courant',
    currency: 'EUR', iban_last4: '4417', balance: 3184.22, include_in_net_worth: true },
  { id: 'acc-livret', kind: 'bank', provider: 'boursorama', label: 'Livret A',
    currency: 'EUR', iban_last4: '8802', balance: 9450, include_in_net_worth: true },
  { id: 'acc-kraken', kind: 'exchange', provider: 'kraken', label: 'Kraken',
    currency: 'EUR', balance: null, include_in_net_worth: true },
  { id: 'acc-okx', kind: 'exchange', provider: 'okx', label: 'OKX',
    currency: 'EUR', balance: null, include_in_net_worth: true },
];

export const DEMO_HOLDINGS = [
  { account_id: 'acc-kraken', symbol: 'BTC', quantity: 0.1482, avg_cost: 32400 },
  { account_id: 'acc-kraken', symbol: 'ETH', quantity: 1.86, avg_cost: 1980 },
  { account_id: 'acc-okx', symbol: 'SOL', quantity: 24.5, avg_cost: 84 },
  { account_id: 'acc-okx', symbol: 'SUI', quantity: 1250, avg_cost: 1.42 },
  { account_id: 'acc-okx', symbol: 'LINK', quantity: 62, avg_cost: 11.8 },
];

/** Achats passés, pour l'analyse de comportement et le backtest. */
export function generateInvestmentTrades({ seed = 991, history } = {}) {
  const rand = rng(seed);
  const btc = history.get('asset-btc');
  const trades = [];
  const step = Math.floor(btc.length / 26);

  for (let i = btc.length - 1; i > btc.length - 26 * step; i -= step) {
    const point = btc[i];
    if (!point) continue;
    // Achats volontairement irréguliers, pour que l'analyse ait quelque chose
    // à dire (§31).
    if (rand() < 0.28) continue;
    const amount = 150 + Math.round(rand() * 350);
    trades.push({
      id: `demo-trade-${trades.length + 1}`,
      asset_id: 'asset-btc',
      symbol: 'BTC',
      side: 'buy',
      quantity: amount / point.close,
      price: point.close,
      currency: 'EUR',
      executed_at: `${point.day}T12:00:00Z`,
      source: 'demo',
    });
  }
  return trades.sort((a, b) => (a.executed_at < b.executed_at ? 1 : -1));
}
