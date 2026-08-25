/**
 * WALLET · Façade d'accès aux données
 *
 * Un seul point d'entrée pour toute l'interface. Il choisit le backend
 * (Supabase si configuré, démonstration sinon) et ajoute par-dessus :
 *
 *   · un cache mémoire court, pour ne pas rappeler l'API à chaque rendu
 *     d'écran — ce qui compte pour rester dans les quotas gratuits (§50) ;
 *   · le calcul de la fraîcheur, pour que chaque écran puisse dire l'âge
 *     réel de la donnée au lieu de laisser croire au temps réel (§45) ;
 *   · la distinction entre « erreur », « inconnu » et « zéro » (§46).
 */

import { config, isConfigured } from '../config.js';
import { demoBackend, resetDemo } from './demoStore.js';

let backend = demoBackend;
let ready = false;

export async function initBackend() {
  if (ready) return backend;
  if (isConfigured()) {
    const { supabaseBackend } = await import('./supabaseBackend.js');
    backend = supabaseBackend;
  } else {
    backend = demoBackend;
  }
  ready = true;
  return backend;
}

export const backendMode = () => backend.mode;
export const isDemoMode = () => backend.mode === 'demo';
export { resetDemo };

/* ================================================================== */
/* Cache mémoire à durée de vie courte                                 */
/* ================================================================== */

const cache = new Map();

function cached(key, ttlMs, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.promise;

  const promise = Promise.resolve(producer()).catch((error) => {
    cache.delete(key);          // une erreur ne doit pas être mise en cache
    throw error;
  });
  cache.set(key, { at: Date.now(), promise });
  return promise;
}

export function invalidate(prefix) {
  if (!prefix) { cache.clear(); return; }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

const MIN = 60000;

/* ================================================================== */
/* Résultat enveloppé : on ne confond jamais vide, inconnu et erreur    */
/* ================================================================== */

/**
 * @returns {{status:'ok'|'empty'|'error', data:any, error:Error|null, at:number}}
 */
export async function safely(producer, fallback = null) {
  try {
    const data = await producer();
    const empty = data === null || data === undefined
      || (Array.isArray(data) && data.length === 0);
    return { status: empty ? 'empty' : 'ok', data: data ?? fallback, error: null, at: Date.now() };
  } catch (error) {
    console.warn('[wallet]', error);
    return { status: 'error', data: fallback, error, at: Date.now() };
  }
}

/* ================================================================== */
/* Session et profil                                                   */
/* ================================================================== */

export const getSession   = () => backend.getSession();
export const onAuthChange = (cb) => backend.onAuthChange?.(cb) ?? (() => {});
export const signIn       = (email, pwd) => backend.signIn?.(email, pwd);
export const signUp       = (email, pwd, name) => backend.signUp?.(email, pwd, name);
export const signInWithMagicLink = (email) => backend.signInWithMagicLink?.(email);
export const resetPassword = (email) => backend.resetPassword?.(email);
export const updatePassword = (pwd) => backend.updatePassword?.(pwd);
export const updateEmail  = (email) => backend.updateEmail?.(email);
export const signOut      = async () => { cache.clear(); return backend.signOut?.(); };

export const getProfile    = () => cached('profile', 5 * MIN, () => backend.getProfile());
export const updateProfile = async (patch) => {
  invalidate('profile');
  return backend.updateProfile(patch);
};
export const uploadAvatar  = async (file) => {
  invalidate('profile');
  return backend.uploadAvatar?.(file);
};
export const getAvatarUrl  = (path) => backend.getAvatarUrl?.(path) ?? null;

export const getSettings    = () => cached('settings', 5 * MIN, () => backend.getSettings());
export const updateSettings = async (patch) => {
  invalidate('settings');
  return backend.updateSettings(patch);
};
export const seedDefaults = () => backend.seedDefaults?.();

/* ================================================================== */
/* Marché                                                              */
/* ================================================================== */

export const listAssets = (opts) => cached('assets', 3 * MIN, () => backend.listAssets(opts));
export const getAsset   = (id) => cached(`asset:${id}`, 3 * MIN, () => backend.getAsset(id));
export const getPriceHistory = (id, days) =>
  cached(`history:${id}:${days}`, 15 * MIN, () => backend.getPriceHistory(id, days));
export const getWatchlist = () => cached('watchlist', MIN, () => backend.getWatchlist());
export const toggleWatchlist = async (id) => {
  invalidate('watchlist');
  return backend.toggleWatchlist(id);
};
export const getMarketIndicators = () =>
  cached('indicators', 10 * MIN, () => backend.getMarketIndicators());

/* ================================================================== */
/* Portefeuille                                                        */
/* ================================================================== */

export const getAccounts = () => cached('accounts', 2 * MIN, () => backend.getAccounts());
export const saveAccount = async (a) => { invalidate('accounts'); return backend.saveAccount?.(a); };
export const deleteAccount = async (id) => { invalidate('accounts'); return backend.deleteAccount?.(id); };

export const getHoldings = () => cached('holdings', MIN, () => backend.getHoldings());
export const saveHolding = async (h) => {
  invalidate('holdings'); invalidate('accounts');
  return backend.saveHolding?.(h);
};
export const deleteHolding = async (id) => { invalidate('holdings'); return backend.deleteHolding?.(id); };

export const getNetWorthSeries = (days) =>
  cached(`networth:${days}`, 5 * MIN, () => backend.getNetWorthSeries(days));
export const getInvestmentTrades = () =>
  cached('trades', 5 * MIN, () => backend.getInvestmentTrades());

/**
 * Patrimoine consolidé.
 *
 * Un compte dont le solde est inconnu n'est pas compté comme 0 : il met le
 * total en « partiel » et l'écran l'annonce (§46).
 */
export async function getNetWorth() {
  const [accounts, holdings] = await Promise.all([getAccounts(), getHoldings()]);

  let cash = 0;
  let crypto = 0;
  let equity = 0;
  const unknownAccounts = [];
  const stalePrices = [];

  for (const account of accounts) {
    if (!account.include_in_net_worth || account.is_active === false) continue;
    if (account.kind === 'exchange') continue;        // valorisé via les holdings
    if (account.balance === null || account.balance === undefined) {
      unknownAccounts.push(account);
      continue;
    }
    cash += Number(account.balance);
  }

  for (const holding of holdings) {
    if (holding.value === null || holding.value === undefined) {
      unknownAccounts.push({ label: holding.symbol, kind: 'holding' });
      continue;
    }
    if (holding.quote_fetched_at) {
      const age = (Date.now() - new Date(holding.quote_fetched_at).getTime()) / 1000;
      if (age > config.freshness.quotesSeconds) stalePrices.push(holding.symbol);
    }
    if (holding.asset?.kind === 'stock' || holding.asset?.kind === 'etf') equity += holding.value;
    else crypto += holding.value;
  }

  const total = cash + crypto + equity;
  const series = await getNetWorthSeries(365).catch(() => []);
  const previous = pickPrevious(series, 30);

  return {
    total,
    cash,
    crypto,
    equity,
    other: 0,
    is_partial: unknownAccounts.length > 0,
    unknown: unknownAccounts,
    stale_prices: stalePrices,
    previous_30d: previous,
    change_30d: previous ? total - previous : null,
    change_30d_pct: previous ? ((total / previous) - 1) * 100 : null,
    series,
  };
}

function pickPrevious(series, daysBack) {
  if (!series?.length) return null;
  const target = Date.now() - daysBack * 86400000;
  let best = null;
  for (const point of series) {
    const t = new Date(point.day).getTime();
    if (t <= target) best = point;
  }
  return best ? Number(best.total_value ?? best.total) : null;
}

/* ================================================================== */
/* Banking                                                             */
/* ================================================================== */

export const listCategories = () => cached('categories', 10 * MIN, () => backend.listCategories());
export const saveCategory = async (c) => { invalidate('categories'); return backend.saveCategory?.(c); };

export const listTransactions = (opts = {}) =>
  cached(`tx:${JSON.stringify(opts)}`, 30000, () => backend.listTransactions(opts));

/** Corriger une catégorie : le geste qui fait apprendre WALLET (§10). */
export async function applyCategoryCorrection(transactionId, categoryId, applySimilar = false) {
  const result = await backend.applyCategoryCorrection(transactionId, categoryId, applySimilar);
  invalidate('tx:');
  invalidate('summary');
  invalidate('breakdown');
  invalidate('memory');
  invalidate('insights');
  return result;
}

export async function setTransactionStatus(transactionId, status) {
  const result = await backend.setTransactionStatus(transactionId, status);
  invalidate('tx:');
  invalidate('summary');
  invalidate('breakdown');
  invalidate('insights');
  return result;
}

export const listRules = () => cached('rules', 2 * MIN, () => backend.listRules());
export const createRule = async (r) => { invalidate('rules'); invalidate('tx:'); return backend.createRule(r); };
export const updateRule = async (id, p) => { invalidate('rules'); invalidate('tx:'); return backend.updateRule(id, p); };
export const deleteRule = async (id) => { invalidate('rules'); invalidate('tx:'); return backend.deleteRule(id); };

export const listMemory = () => cached('memory', 2 * MIN, () => backend.listMemory());
export const forgetMemory = async (key, bucket) => {
  invalidate('memory'); invalidate('tx:');
  return backend.forgetMemory(key, bucket);
};

export const listRecurring = () => cached('recurring', 5 * MIN, () => backend.listRecurring());
export const listAnomalies = () => cached('anomalies', 5 * MIN, () => backend.listAnomalies?.() ?? []);
export const listImportBatches = () => backend.listImportBatches?.() ?? [];
export const importTransactions = async (rows, batch) => {
  invalidate('tx:'); invalidate('summary'); invalidate('recurring');
  return backend.importTransactions?.(rows, batch);
};

/**
 * Synthèse mensuelle. En mode démonstration, elle est calculée localement à
 * partir des mêmes règles que la fonction SQL monthly_summary().
 */
export async function monthlySummary(month) {
  if (backend.monthlySummary) return backend.monthlySummary(month);

  const start = monthStart(month);
  const end = monthEnd(month);
  const [rows, categories] = await Promise.all([
    listTransactions({ from: start, to: end, limit: 2000 }),
    listCategories(),
  ]);
  const kindById = new Map(categories.map((c) => [c.id, c.kind]));

  let income = 0;
  let expense = 0;
  let count = 0;
  for (const tx of rows) {
    if (tx.status !== 'active') continue;
    if (kindById.get(tx.category_id) === 'transfer') continue;
    if (tx.amount > 0) income += tx.amount; else expense += -tx.amount;
    count += 1;
  }

  return {
    month: start,
    income: round2(income),
    expense: round2(expense),
    net_savings: round2(income - expense),
    // null, pas 0 : sans revenu connu, le taux n'est pas mesurable (§46)
    savings_rate: income > 0 ? round2(((income - expense) / income) * 100) : null,
    tx_count: count,
  };
}

export async function categoryBreakdown(month, kind = 'expense') {
  if (backend.categoryBreakdown) return backend.categoryBreakdown(month, kind);

  const [rows, categories] = await Promise.all([
    listTransactions({ from: monthStart(month), to: monthEnd(month), limit: 2000 }),
    listCategories(),
  ]);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map();

  for (const tx of rows) {
    if (tx.status !== 'active') continue;
    const category = byId.get(tx.category_id);
    if (category?.kind === 'transfer') continue;
    if (kind === 'expense' ? tx.amount >= 0 : tx.amount <= 0) continue;

    const key = tx.category_id || 'uncategorized';
    const entry = totals.get(key) || {
      category_id: tx.category_id ?? null,
      slug: category?.slug ?? 'uncategorized',
      label: category?.label ?? 'Non classé',
      emoji: category?.emoji ?? '❓',
      color: category?.color ?? '#8E8E93',
      total: 0, tx_count: 0,
    };
    entry.total += Math.abs(tx.amount);
    entry.tx_count += 1;
    totals.set(key, entry);
  }

  const list = [...totals.values()];
  const grand = list.reduce((a, e) => a + e.total, 0);
  return list
    .map((e) => ({ ...e, total: round2(e.total), share: grand ? round2((e.total / grand) * 100) : null }))
    .sort((a, b) => b.total - a.total);
}

const monthStart = (month) => {
  const d = month ? new Date(month) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};
const monthEnd = (month) => {
  const d = month ? new Date(month) : new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};
const round2 = (n) => Math.round(n * 100) / 100;

/* ================================================================== */
/* Moteur, alertes, objectifs                                          */
/* ================================================================== */

export const getScoreModel = () => cached('scoreModel', 5 * MIN, () => backend.getScoreModel());
export const saveScoreModel = async (m) => { invalidate('scoreModel'); invalidate('score'); return backend.saveScoreModel(m); };
export const listScenarios = (assetId) => cached(`scenarios:${assetId}`, 5 * MIN, () => backend.listScenarios(assetId));
export const saveScenarios = async (assetId, s) => { invalidate(`scenarios:${assetId}`); return backend.saveScenarios(assetId, s); };
export const listAltRatios = (assetId) => cached(`ratios:${assetId}`, 5 * MIN, () => backend.listAltRatios(assetId));
export const saveAltRatios = async (assetId, r) => { invalidate(`ratios:${assetId}`); return backend.saveAltRatios(assetId, r); };

export const listAlerts = () => cached('alerts', MIN, () => backend.listAlerts());
export const saveAlert = async (a) => { invalidate('alerts'); return backend.saveAlert(a); };
export const deleteAlert = async (id) => { invalidate('alerts'); return backend.deleteAlert(id); };
export const listAlertEvents = () => cached('alertEvents', MIN, () => backend.listAlertEvents());
export const markAlertsRead = async () => { invalidate('alertEvents'); return backend.markAlertsRead(); };

export const listGoals = () => cached('goals', 2 * MIN, () => backend.listGoals());
export const saveGoal = async (g) => { invalidate('goals'); return backend.saveGoal(g); };
export const deleteGoal = async (id) => { invalidate('goals'); return backend.deleteGoal(id); };

export const listInsights = () => cached('insights', 2 * MIN, () => backend.listInsights());
export const dismissInsight = async (id) => { invalidate('insights'); return backend.dismissInsight(id); };

export const listCredentials = () => cached('credentials', MIN, () => backend.listCredentials());
export const saveCredential = async (c) => { invalidate('credentials'); return backend.saveCredential?.(c); };
export const deleteCredential = async (id) => { invalidate('credentials'); return backend.deleteCredential?.(id); };

export const triggerSync = async (scope) => {
  const result = await backend.triggerSync?.(scope);
  invalidate('');
  return result;
};
export const getSyncState = () => cached('sync', 20000, () => backend.getSyncState());

export const logAssistant = (entry) => backend.logAssistant?.(entry);
export const listAssistantHistory = () => backend.listAssistantHistory?.() ?? [];

/* ================================================================== */
/* Glossaire                                                           */
/* ================================================================== */

import { GLOSSARY_FALLBACK } from './glossary.js';

/**
 * Les explications sont d'abord cherchées en base (elles peuvent y être
 * enrichies), avec repli sur la copie embarquée : une explication doit
 * s'ouvrir même hors connexion et même en mode démonstration.
 */
export async function getGlossary(code) {
  const local = GLOSSARY_FALLBACK[code] ?? null;
  if (!backend.getGlossary) return local;
  try {
    const remote = await cached(`glossary:${code}`, 60 * MIN, () => backend.getGlossary(code));
    return remote ?? local;
  } catch {
    return local;
  }
}
