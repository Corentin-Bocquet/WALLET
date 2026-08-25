/**
 * WALLET · Backend de démonstration
 *
 * Implémente exactement le même contrat que le backend Supabase, mais en
 * mémoire, avec persistance dans localStorage. Objectif : que l'apprentissage
 * des catégories soit RÉELLEMENT démontrable sans serveur — vous corrigez une
 * transaction, vous rechargez, la correction est toujours là et s'applique aux
 * suivantes.
 *
 * Ce qui est simulé est signalé comme tel partout dans l'interface (§51).
 */

import {
  DEMO_CATEGORIES, DEMO_ACCOUNTS, DEMO_HOLDINGS, DEMO_ASSETS,
  generateTransactions, generatePriceHistory, quoteFromHistory,
  generateInvestmentTrades,
} from './demo.js';
import { categorize } from '../engine/categorizer.js';
import { detectRecurring } from '../engine/recurring.js';
import { detectAnomalies } from '../engine/anomalies.js';
import { amountBucket } from '../engine/normalize.js';

const STORAGE_KEY = 'wallet.demo.v1';
const DAY = 86400000;

/** État mutable : seules les décisions de l'utilisateur sont persistées. */
const persisted = loadPersisted();

function loadPersisted() {
  const empty = {
    memory: [], ignoreMemory: [], rules: [], corrections: [],
    overrides: {}, statuses: {}, settings: {}, watchlist: ['asset-btc', 'asset-eth', 'asset-sol'],
    scenarios: null, altRatios: null, alerts: [], goals: [], scoreModel: null,
    assistantLog: [], dismissedInsights: [],
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted)); }
  catch { /* quota plein : la démo reste utilisable, juste non persistée */ }
}

export function resetDemo() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignoré */ }
  Object.assign(persisted, loadPersisted());
  cache.built = false;
}

/* ================================================================== */
/* Construction paresseuse du jeu de données                           */
/* ================================================================== */

const cache = { built: false };

function build() {
  if (cache.built) return cache;

  cache.categories = DEMO_CATEGORIES.map((c) => ({ ...c }));
  cache.categoriesBySlug = new Map(cache.categories.map((c) => [c.slug, c]));
  cache.categoriesById = new Map(cache.categories.map((c) => [c.id, c]));

  cache.history = generatePriceHistory({ days: 2200 });
  cache.assets = DEMO_ASSETS.map((a) => ({ ...a }));
  cache.quotes = new Map(cache.assets.map((a) => [a.id, quoteFromHistory(a, cache.history.get(a.id))]));
  cache.assetsBySymbol = new Map(cache.assets.map((a) => [a.symbol, a]));

  cache.accounts = DEMO_ACCOUNTS.map((a) => ({ ...a, is_active: true, balance_at: new Date().toISOString() }));
  cache.holdings = DEMO_HOLDINGS.map((h, i) => {
    const asset = cache.assetsBySymbol.get(h.symbol);
    return {
      id: `demo-hold-${i}`, ...h, asset_id: asset.id, symbol: h.symbol,
      name: asset.name, cost_currency: 'EUR', source: 'sync',
      synced_at: new Date(Date.now() - 4 * 60000).toISOString(),
    };
  });

  cache.trades = generateInvestmentTrades({ history: cache.history });
  cache.rawTransactions = generateTransactions({ months: 18 });

  recomputeTransactions();
  cache.built = true;
  return cache;
}

/**
 * Rejoue la catégorisation sur toutes les transactions.
 * Appelée au démarrage et après chaque correction : c'est ce qui rend
 * l'apprentissage visible immédiatement sur les transactions similaires.
 */
function recomputeTransactions() {
  const context = {
    rules: persisted.rules,
    memory: persisted.memory,
    ignoreMemory: persisted.ignoreMemory,
    recurring: cache.recurring || [],
    categoriesBySlug: cache.categoriesBySlug,
    categoriesById: cache.categoriesById,
    askBelow: 0.6,
  };

  cache.transactions = cache.rawTransactions.map((raw) => {
    const override = persisted.overrides[raw.id];
    const status = persisted.statuses[raw.id] || 'active';

    if (override) {
      const category = cache.categoriesById.get(override.category_id);
      return {
        ...raw, status,
        category_id: override.category_id,
        category_source: 'user',
        category_confidence: 1,
        category_reason: {
          kind: 'user',
          label: 'Vous avez choisi cette catégorie',
          detail: 'Votre choix prime sur toute déduction automatique.',
        },
        slug: category?.slug, emoji: category?.emoji, color: category?.color,
        category_label: category?.label,
        needsConfirmation: false,
      };
    }

    const decision = categorize(raw, context);
    return {
      ...raw, status,
      category_id: decision.categoryId,
      category_source: decision.source,
      category_confidence: decision.confidence,
      category_reason: decision.reason,
      slug: decision.slug, emoji: decision.emoji, color: decision.color,
      category_label: decision.label,
      needsConfirmation: decision.needsConfirmation,
      suggestIgnore: decision.suggestIgnore,
      alternatives: decision.alternatives,
    };
  });

  // Récurrences puis re-liaison : une transaction rattachée à une récurrence
  // ne doit plus être vue comme une anomalie.
  cache.recurring = detectRecurring(cache.transactions);
  const recByTxId = new Map();
  for (const rec of cache.recurring) {
    for (const id of rec.transaction_ids) recByTxId.set(id, rec);
  }
  for (const tx of cache.transactions) {
    const rec = recByTxId.get(tx.id);
    tx.recurring_id = rec ? rec.signature : null;
  }

  cache.anomalies = detectAnomalies(cache.transactions);
  const anomalyIds = new Set(cache.anomalies.map((a) => a.transaction_id));
  for (const tx of cache.transactions) {
    tx.is_anomaly = anomalyIds.has(tx.id);
    if (tx.is_anomaly) {
      tx.anomaly = cache.anomalies.find((a) => a.transaction_id === tx.id);
    }
  }

  cache.snapshots = buildSnapshots();
}

/** Historique du patrimoine : cash constant + crypto valorisée jour par jour. */
function buildSnapshots() {
  const cashTotal = cache.accounts
    .filter((a) => a.balance !== null)
    .reduce((sum, a) => sum + a.balance, 0);

  const days = 365;
  const btc = cache.history.get('asset-btc');
  const out = [];

  for (let i = days; i >= 0; i -= 1) {
    const idx = btc.length - 1 - i;
    if (idx < 0) continue;
    const day = btc[idx].day;

    let crypto = 0;
    for (const h of cache.holdings) {
      const series = cache.history.get(h.asset_id);
      const point = series[series.length - 1 - i];
      if (point) crypto += h.quantity * point.close;
    }

    out.push({
      day,
      captured_at: `${day}T23:00:00Z`,
      total_value: round2(crypto + cashTotal),
      crypto_value: round2(crypto),
      equity_value: 0,
      cash_value: round2(cashTotal),
      other_value: 0,
      is_partial: false,
    });
  }
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

/* ================================================================== */
/* API — miroir exact du backend Supabase                              */
/* ================================================================== */

export const demoBackend = {
  mode: 'demo',

  async getSession() {
    return {
      user: {
        id: 'demo-user',
        email: 'demo@wallet.app',
        user_metadata: { full_name: 'Mode démonstration' },
      },
      isDemo: true,
    };
  },

  async getProfile() {
    return { id: 'demo-user', username: 'demo', full_name: 'Mode démonstration', avatar_path: null };
  },

  async updateProfile(patch) {
    persisted.settings.profile = { ...(persisted.settings.profile || {}), ...patch };
    save();
    return { ...(await this.getProfile()), ...persisted.settings.profile };
  },

  async getSettings() {
    return {
      base_currency: 'EUR', locale: 'fr-FR', theme: 'dark', ui_mode: 'simple',
      sound_enabled: true, haptics_enabled: true, privacy_blur: false,
      notifications: { price: true, score: true, budget: true, sync: true },
      engine_params: {},
      ...persisted.settings,
    };
  },

  async updateSettings(patch) {
    Object.assign(persisted.settings, patch);
    save();
    return this.getSettings();
  },

  /* — Marché ————————————————————————————————————————— */

  async listAssets() {
    const c = build();
    return c.assets
      .map((a) => ({ ...a, quote: c.quotes.get(a.id) }))
      .sort((x, y) => x.rank - y.rank);
  },

  async getAsset(assetId) {
    const c = build();
    const asset = c.assets.find((a) => a.id === assetId);
    return asset ? { ...asset, quote: c.quotes.get(assetId) } : null;
  },

  async getPriceHistory(assetId, days = 365) {
    const c = build();
    const series = c.history.get(assetId) || [];
    return days ? series.slice(-days) : series;
  },

  async getWatchlist() {
    const c = build();
    return persisted.watchlist
      .map((id) => c.assets.find((a) => a.id === id))
      .filter(Boolean)
      .map((a) => ({ ...a, quote: c.quotes.get(a.id) }));
  },

  async toggleWatchlist(assetId) {
    const index = persisted.watchlist.indexOf(assetId);
    if (index === -1) persisted.watchlist.push(assetId);
    else persisted.watchlist.splice(index, 1);
    save();
    return index === -1;
  },

  async getMarketIndicators() {
    const c = build();
    // Fear & Greed simulé, dérivé du momentum récent : cohérent avec les prix
    // affichés plutôt qu'un nombre arbitraire.
    const btc = c.history.get('asset-btc');
    const recent = btc.slice(-30);
    const move = (recent[recent.length - 1].close / recent[0].close - 1) * 100;
    const fg = Math.max(5, Math.min(95, Math.round(50 + move * 1.6)));
    return {
      fear_greed: { code: 'fear_greed', value: fg, source: 'simulé (mode démonstration)',
        is_derived: true, fetched_at: new Date().toISOString() },
      btc_dominance: { code: 'btc_dominance', value: 54.2, source: 'simulé (mode démonstration)',
        is_derived: true, fetched_at: new Date().toISOString() },
    };
  },

  /* — Portefeuille ————————————————————————————————— */

  async getAccounts() {
    return build().accounts.map((a) => ({ ...a }));
  },

  async getHoldings() {
    const c = build();
    return c.holdings.map((h) => {
      const quote = c.quotes.get(h.asset_id);
      const value = h.quantity * quote.price;
      const cost = h.avg_cost ? h.quantity * h.avg_cost : null;
      return {
        ...h,
        price: quote.price,
        value: round2(value),
        cost: cost === null ? null : round2(cost),
        pnl: cost === null ? null : round2(value - cost),
        pnl_pct: cost ? round2((value / cost - 1) * 100) : null,
        change_24h: quote.change_24h,
      };
    }).sort((a, b) => b.value - a.value);
  },

  async getNetWorthSeries(days = 365) {
    return build().snapshots.slice(-days);
  },

  async getInvestmentTrades() {
    return build().trades.map((t) => ({ ...t }));
  },

  /* — Banking ————————————————————————————————————————— */

  async listCategories() {
    return build().categories.map((c) => ({ ...c }));
  },

  async listTransactions({ from, to, categoryId, status = 'active', search, limit = 300 } = {}) {
    const c = build();
    let rows = c.transactions;

    if (status !== 'all') rows = rows.filter((t) => t.status === status);
    if (from) rows = rows.filter((t) => t.booked_at >= from);
    if (to) rows = rows.filter((t) => t.booked_at <= to);
    if (categoryId) rows = rows.filter((t) => t.category_id === categoryId);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((t) => t.raw_label.toLowerCase().includes(q)
        || (t.category_label || '').toLowerCase().includes(q));
    }
    return rows.slice(0, limit).map((t) => ({ ...t }));
  },

  /**
   * LE geste central : corriger une catégorie.
   * Reproduit fidèlement public.apply_category_correction() (migration 0007),
   * y compris l'affaiblissement des mémoires concurrentes.
   */
  async applyCategoryCorrection(transactionId, categoryId, applySimilar = false) {
    const c = build();
    const tx = c.transactions.find((t) => t.id === transactionId);
    if (!tx) throw new Error('transaction introuvable');

    const key = tx.merchant || tx.clean_label;
    const bucket = amountBucket(tx.amount);

    persisted.overrides[transactionId] = { category_id: categoryId, at: new Date().toISOString() };
    persisted.corrections.push({
      transaction_id: transactionId, clean_label: tx.clean_label, merchant: tx.merchant,
      amount: tx.amount, from_category_id: tx.category_id, to_category_id: categoryId,
      created_at: new Date().toISOString(),
    });

    bumpMemory(key, bucket, categoryId, 3, 1);
    weakenRivals(key, bucket, categoryId, 2);
    bumpMemory(key, 'any', categoryId, 1, 1);

    let similar = 0;
    if (applySimilar) {
      for (const other of c.transactions) {
        if (other.id === transactionId) continue;
        if (persisted.overrides[other.id]) continue;
        if ((other.merchant || other.clean_label) !== key) continue;
        if (amountBucket(other.amount) !== bucket) continue;
        similar += 1;
      }
    }

    save();
    recomputeTransactions();
    return { ok: true, key, bucket, similar_updated: similar };
  },

  async setTransactionStatus(transactionId, status) {
    const c = build();
    const tx = c.transactions.find((t) => t.id === transactionId);
    if (!tx) throw new Error('transaction introuvable');

    persisted.statuses[transactionId] = status;

    const key = tx.merchant || tx.clean_label;
    const bucket = amountBucket(tx.amount);
    let entry = persisted.ignoreMemory.find((m) => m.key_value === key && m.amount_bucket === bucket);
    if (!entry) {
      entry = { key_value: key, amount_bucket: bucket, ignored_count: 0, kept_count: 0 };
      persisted.ignoreMemory.push(entry);
    }
    if (status === 'ignored' || status === 'hidden') entry.ignored_count += 1;
    if (status === 'active') entry.kept_count += 1;
    entry.last_seen_at = new Date().toISOString();

    save();
    recomputeTransactions();
    return { ok: true, status, key };
  },

  async listRules() {
    return persisted.rules.map((r) => ({ ...r }));
  },

  async createRule(rule) {
    const row = {
      id: `rule-${Date.now()}`, priority: 200, is_active: true,
      match_type: 'contains', hit_count: 0, created_at: new Date().toISOString(), ...rule,
    };
    persisted.rules.push(row);
    save();
    recomputeTransactions();
    return row;
  },

  async updateRule(id, patch) {
    const rule = persisted.rules.find((r) => r.id === id);
    if (rule) Object.assign(rule, patch);
    save();
    recomputeTransactions();
    return rule;
  },

  async deleteRule(id) {
    const index = persisted.rules.findIndex((r) => r.id === id);
    if (index !== -1) persisted.rules.splice(index, 1);
    save();
    recomputeTransactions();
    return { ok: true };
  },

  async listMemory() {
    const c = build();
    return persisted.memory.map((m) => ({
      ...m, category: c.categoriesById.get(m.category_id),
    })).sort((a, b) => b.hits - a.hits);
  },

  async forgetMemory(keyValue, bucket) {
    persisted.memory = persisted.memory.filter(
      (m) => !(m.key_value === keyValue && (!bucket || m.amount_bucket === bucket)));
    save();
    recomputeTransactions();
    return { ok: true };
  },

  async listRecurring() {
    build();
    return cache.recurring.map((r) => ({ ...r }));
  },

  async listAnomalies() {
    build();
    return cache.anomalies.map((a) => ({ ...a }));
  },

  async listImportBatches() { return []; },

  /* — Moteur ————————————————————————————————————————— */

  async getScoreModel() {
    return persisted.scoreModel || {
      id: 'demo-model', name: 'Modèle équilibré', is_default: true,
      weights: { cycle: 20, valuation: 20, momentum: 15, onchain: 10,
        sentiment: 10, macro: 5, drawdown: 15, volatility: 5 },
      zone_thresholds: { exceptional: 80, interesting: 65, neutral: 45, expensive: 30 },
    };
  },

  async saveScoreModel(model) {
    persisted.scoreModel = { ...(await this.getScoreModel()), ...model };
    save();
    return persisted.scoreModel;
  },

  async listScenarios(assetId = 'asset-btc') {
    if (persisted.scenarios) return persisted.scenarios.filter((s) => s.asset_id === assetId);
    return [
      { id: 'sc-bear', asset_id: assetId, name: 'Bear', kind: 'bear', probability: 0.25,
        horizon_month: 12, assumptions: { multiple_of_200w_ma: 1.0, note: 'Récession, liquidité en repli' } },
      { id: 'sc-base', asset_id: assetId, name: 'Base', kind: 'base', probability: 0.5,
        horizon_month: 12, assumptions: { multiple_of_200w_ma: 2.4, note: 'Cycle historique moyen' } },
      { id: 'sc-bull', asset_id: assetId, name: 'Bull', kind: 'bull', probability: 0.25,
        horizon_month: 12, assumptions: { multiple_of_200w_ma: 4.0, note: 'Adoption et liquidité fortes' } },
    ];
  },

  async saveScenarios(assetId, scenarios) {
    const others = (persisted.scenarios || []).filter((s) => s.asset_id !== assetId);
    persisted.scenarios = [...others, ...scenarios.map((s) => ({ ...s, asset_id: assetId }))];
    save();
    return this.listScenarios(assetId);
  },

  async listAltRatios(assetId) {
    if (persisted.altRatios) return persisted.altRatios.filter((r) => r.asset_id === assetId);
    const c = build();
    const asset = c.assets.find((a) => a.id === assetId);
    if (!asset || asset.symbol === 'BTC') return [];

    const altSeries = c.history.get(assetId);
    const btcSeries = c.history.get('asset-btc');
    const ratios = altSeries.map((p, i) => p.close / btcSeries[i].close);
    const sorted = ratios.slice().sort((a, b) => a - b);

    return [
      { id: `${assetId}-high`, asset_id: assetId, label: 'Plus haut historique',
        ratio: Math.max(...ratios), source: 'historical_high' },
      { id: `${assetId}-med`, asset_id: assetId, label: 'Médiane historique',
        ratio: sorted[Math.floor(sorted.length / 2)], source: 'historical_median' },
      { id: `${assetId}-now`, asset_id: assetId, label: 'Ratio actuel',
        ratio: ratios[ratios.length - 1], source: 'current' },
    ];
  },

  async saveAltRatios(assetId, ratios) {
    const others = (persisted.altRatios || []).filter((r) => r.asset_id !== assetId);
    persisted.altRatios = [...others, ...ratios.map((r) => ({ ...r, asset_id: assetId }))];
    save();
    return this.listAltRatios(assetId);
  },

  /* — Alertes et objectifs ————————————————————————— */

  async listAlerts() { return persisted.alerts.map((a) => ({ ...a })); },

  async saveAlert(alert) {
    if (alert.id) {
      const existing = persisted.alerts.find((a) => a.id === alert.id);
      if (existing) Object.assign(existing, alert);
    } else {
      persisted.alerts.push({ ...alert, id: `alert-${Date.now()}`, is_active: true,
        created_at: new Date().toISOString() });
    }
    save();
    return this.listAlerts();
  },

  async deleteAlert(id) {
    const i = persisted.alerts.findIndex((a) => a.id === id);
    if (i !== -1) persisted.alerts.splice(i, 1);
    save();
    return { ok: true };
  },

  async listAlertEvents() { return []; },
  async markAlertsRead() { return { ok: true }; },

  async listGoals() { return persisted.goals.map((g) => ({ ...g })); },

  async saveGoal(goal) {
    if (goal.id) {
      const existing = persisted.goals.find((g) => g.id === goal.id);
      if (existing) Object.assign(existing, goal);
    } else {
      persisted.goals.push({ ...goal, id: `goal-${Date.now()}`, is_active: true });
    }
    save();
    return this.listGoals();
  },

  async deleteGoal(id) {
    const i = persisted.goals.findIndex((g) => g.id === id);
    if (i !== -1) persisted.goals.splice(i, 1);
    save();
    return { ok: true };
  },

  /* — Divers ————————————————————————————————————————— */

  async listCredentials() { return []; },

  async getSyncState() {
    return {
      market: { status: 'ok', last_success: new Date(Date.now() - 3 * 60000).toISOString(),
        message: 'Données simulées (mode démonstration)' },
      kraken: { status: 'idle', last_success: null, message: 'Aucune clé connectée' },
      okx: { status: 'idle', last_success: null, message: 'Aucune clé connectée' },
      bank: { status: 'ok', last_success: new Date(Date.now() - 40 * 60000).toISOString(),
        message: 'Jeu de démonstration' },
    };
  },

  async listInsights() {
    build();
    const out = [];
    const anomaly = cache.anomalies[0];
    if (anomaly && !persisted.dismissedInsights.includes('anomaly')) {
      out.push({
        id: 'anomaly', code: 'anomaly', severity: 'warning',
        title: 'Dépense inhabituelle repérée',
        body: anomaly.explanation,
        evidence: anomaly,
      });
    }
    const unclassified = cache.transactions.filter((t) => t.needsConfirmation && t.status === 'active');
    if (unclassified.length && !persisted.dismissedInsights.includes('to_classify')) {
      out.push({
        id: 'to_classify', code: 'to_classify', severity: 'info',
        title: `${unclassified.length} transactions à classer`,
        body: 'WALLET hésite sur ces dépenses. Une réponse de votre part, et il retiendra.',
        evidence: { count: unclassified.length },
      });
    }
    return out;
  },

  async dismissInsight(id) {
    if (!persisted.dismissedInsights.includes(id)) persisted.dismissedInsights.push(id);
    save();
    return { ok: true };
  },

  async logAssistant(entry) {
    persisted.assistantLog.push({ ...entry, created_at: new Date().toISOString() });
    if (persisted.assistantLog.length > 60) persisted.assistantLog.shift();
    save();
    return { ok: true };
  },

  async listAssistantHistory() { return persisted.assistantLog.slice(-20); },
};

/* — Mémoire : mêmes règles que la fonction SQL ————————— */

function bumpMemory(key, bucket, categoryId, hits, corrections) {
  let entry = persisted.memory.find(
    (m) => m.key_value === key && m.amount_bucket === bucket && m.category_id === categoryId);
  if (!entry) {
    entry = { key_type: 'merchant', key_value: key, amount_bucket: bucket,
      category_id: categoryId, hits: 0, corrections: 0,
      first_seen_at: new Date().toISOString() };
    persisted.memory.push(entry);
  }
  entry.hits += hits;
  entry.corrections += corrections;
  entry.last_seen_at = new Date().toISOString();
}

function weakenRivals(key, bucket, categoryId, amount) {
  for (const m of persisted.memory) {
    if (m.key_value === key && m.amount_bucket === bucket && m.category_id !== categoryId) {
      m.hits = Math.max(0, m.hits - amount);
    }
  }
}

export { DAY };
