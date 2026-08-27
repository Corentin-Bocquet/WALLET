/**
 * WALLET · Backend Supabase
 *
 * Implémente le même contrat que demoStore.js. Toutes les requêtes passent par
 * la clé "anon" et sont donc bornées par la Row Level Security : impossible de
 * lire les données d'un autre compte, même en trafiquant la requête côté
 * navigateur.
 *
 * Aucune clé Kraken/OKX ne transite ici : elles sont écrites via une Edge
 * Function et ne redescendent jamais dans le navigateur.
 */

import { config } from '../config.js';

let client = null;

export async function getClient() {
  if (client) return client;

  // La bibliothèque est embarquée (app/vendor) plutôt que chargée depuis un
  // CDN : l'application doit fonctionner hors ligne une fois installée.
  if (!window.supabase?.createClient) {
    await loadScript(new URL('../../vendor/supabase.umd.js', import.meta.url).href);
  }

  client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'wallet.auth',
    },
    global: { headers: { 'x-application-name': 'wallet' } },
  });
  return client;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Impossible de charger la bibliothèque Supabase'));
    document.head.append(script);
  });
}

/** Déballe une réponse PostgREST en levant une erreur lisible. */
function unwrap({ data, error }, context) {
  if (error) {
    const err = new Error(error.message || 'Erreur inattendue');
    err.code = error.code;
    err.context = context;
    err.details = error.details;
    throw err;
  }
  return data;
}

export const supabaseBackend = {
  mode: 'supabase',

  /* — Session ————————————————————————————————————————— */

  async getSession() {
    const sb = await getClient();
    const { data } = await sb.auth.getSession();
    return data.session ? { user: data.session.user, isDemo: false } : null;
  },

  async onAuthChange(callback) {
    const sb = await getClient();
    const { data } = sb.auth.onAuthStateChange((event, session) => callback(event, session));
    return () => data.subscription.unsubscribe();
  },

  async signIn(email, password) {
    const sb = await getClient();
    return unwrap(await sb.auth.signInWithPassword({ email, password }), 'signIn');
  },

  async signUp(email, password, fullName) {
    const sb = await getClient();
    return unwrap(await sb.auth.signUp({
      email, password, options: { data: { full_name: fullName || '' } },
    }), 'signUp');
  },

  async signInWithMagicLink(email) {
    const sb = await getClient();
    return unwrap(await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.origin + window.location.pathname },
    }), 'magicLink');
  },

  async resetPassword(email) {
    const sb = await getClient();
    return unwrap(await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname + '#/profil',
    }), 'resetPassword');
  },

  async updatePassword(password) {
    const sb = await getClient();
    return unwrap(await sb.auth.updateUser({ password }), 'updatePassword');
  },

  async updateEmail(email) {
    const sb = await getClient();
    return unwrap(await sb.auth.updateUser({ email }), 'updateEmail');
  },

  async signOut() {
    const sb = await getClient();
    await sb.auth.signOut();
  },

  /* — Profil et préférences ————————————————————————— */

  async getProfile() {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const row = unwrap(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle(), 'profile');
    return row ? { ...row, email: user.email } : { id: user.id, email: user.email };
  },

  async updateProfile(patch) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    return unwrap(await sb.from('profiles').update(patch).eq('id', user.id).select().single(), 'updateProfile');
  },

  async uploadAvatar(file) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    const extension = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${user.id}/avatar-${Date.now()}.${extension}`;

    const { error } = await sb.storage.from('avatars').upload(path, file, { upsert: true });
    if (error) throw new Error(error.message);

    await this.updateProfile({ avatar_path: path });
    return path;
  },

  async getAvatarUrl(path) {
    if (!path) return null;
    const sb = await getClient();
    const { data } = await sb.storage.from('avatars').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  },

  async getSettings() {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    let row = unwrap(await sb.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(), 'settings');
    if (!row) {
      row = unwrap(await sb.from('user_settings').insert({ user_id: user.id }).select().single(), 'settingsInit');
    }
    return row;
  },

  async updateSettings(patch) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    return unwrap(await sb.from('user_settings').update(patch)
      .eq('user_id', user.id).select().single(), 'updateSettings');
  },

  /** Taux de change du jour, base euro : { USD: 1.1669 }. */
  async askAssistant(question) {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke('ai-assistant', { body: { question } });
    if (error) throw new Error(data?.message || error.message || 'Assistant indisponible.');
    return data;
  },

  async categorizeWithAI() {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke('ai-categorize', { body: {} });
    if (error) throw new Error(data?.message || error.message || 'Classement indisponible.');
    return data;
  },

  async getFxRates() {
    const sb = await getClient();
    const rows = unwrap(await sb.from('fx_rates')
      .select('quote, rate, day').eq('base', 'EUR')
      .order('day', { ascending: false }).limit(40), 'getFxRates');
    const out = {};
    for (const row of rows || []) {
      if (out[row.quote] === undefined) out[row.quote] = Number(row.rate);
    }
    return out;
  },

  async seedDefaults() {
    const sb = await getClient();
    return unwrap(await sb.rpc('seed_user_defaults'), 'seedDefaults');
  },

  /* — Marché ————————————————————————————————————————— */

  async listAssets({ limit = 100 } = {}) {
    const sb = await getClient();
    const rows = unwrap(await sb.from('assets')
      .select('*, quote:asset_quotes(*)')
      .eq('kind', 'crypto')
      .order('rank', { ascending: true, nullsFirst: false })
      .limit(limit), 'listAssets');
    return (rows || []).map(flattenQuote);
  },

  async getAsset(assetId) {
    const sb = await getClient();
    const row = unwrap(await sb.from('assets')
      .select('*, quote:asset_quotes(*)').eq('id', assetId).maybeSingle(), 'getAsset');
    return row ? flattenQuote(row) : null;
  },

  async getPriceHistory(assetId, days = 365) {
    const sb = await getClient();
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    return unwrap(await sb.from('price_history')
      .select('day, close, volume')
      .eq('asset_id', assetId).gte('day', since)
      .order('day', { ascending: true }), 'priceHistory') || [];
  },

  async getWatchlist() {
    const sb = await getClient();
    const rows = unwrap(await sb.from('asset_watchlist')
      .select('sort_order, asset:assets(*, quote:asset_quotes(*))')
      .order('sort_order'), 'watchlist');
    return (rows || []).map((r) => flattenQuote(r.asset)).filter(Boolean);
  },

  async toggleWatchlist(assetId) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    const existing = unwrap(await sb.from('asset_watchlist')
      .select('asset_id').eq('asset_id', assetId).maybeSingle(), 'watchCheck');

    if (existing) {
      unwrap(await sb.from('asset_watchlist').delete().eq('asset_id', assetId), 'unwatch');
      return false;
    }
    unwrap(await sb.from('asset_watchlist')
      .insert({ user_id: user.id, asset_id: assetId }), 'watch');
    return true;
  },

  async getMarketIndicators() {
    const sb = await getClient();
    const rows = unwrap(await sb.from('market_indicators')
      .select('*').is('asset_id', null)
      .order('day', { ascending: false }).limit(20), 'indicators') || [];

    const out = {};
    for (const row of rows) if (!out[row.code]) out[row.code] = row;
    return out;
  },

  /* — Portefeuille ————————————————————————————————— */

  async getAccounts() {
    const sb = await getClient();
    return unwrap(await sb.from('accounts').select('*')
      .order('sort_order').order('created_at'), 'accounts') || [];
  },

  async saveAccount(account) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    if (account.id) {
      return unwrap(await sb.from('accounts').update(account)
        .eq('id', account.id).select().single(), 'updateAccount');
    }
    return unwrap(await sb.from('accounts')
      .insert({ ...account, user_id: user.id }).select().single(), 'createAccount');
  },

  async deleteAccount(id) {
    const sb = await getClient();
    unwrap(await sb.from('accounts').delete().eq('id', id), 'deleteAccount');
    return { ok: true };
  },

  async getHoldings() {
    const sb = await getClient();
    const rows = unwrap(await sb.from('holdings')
      .select('*, asset:assets(id, symbol, name, image_url, kind), account:accounts(id, label, provider)')
      .order('quantity', { ascending: false }), 'holdings') || [];

    const assetIds = [...new Set(rows.map((r) => r.asset_id))];
    const quotes = assetIds.length
      ? unwrap(await sb.from('asset_quotes').select('*').in('asset_id', assetIds), 'holdingQuotes')
      : [];
    const byAsset = new Map((quotes || []).map((q) => [q.asset_id, q]));

    return rows.map((row) => {
      const quote = byAsset.get(row.asset_id);
      const price = quote?.price ? Number(quote.price) : null;
      const quantity = Number(row.quantity) || 0;
      const value = price === null ? null : quantity * price;
      const cost = row.avg_cost ? quantity * Number(row.avg_cost) : null;
      return {
        ...row,
        symbol: row.asset?.symbol,
        name: row.asset?.name,
        price,
        value,
        cost,
        pnl: value === null || cost === null ? null : value - cost,
        pnl_pct: value === null || !cost ? null : (value / cost - 1) * 100,
        change_24h: quote?.change_24h ?? null,
        quote_fetched_at: quote?.fetched_at ?? null,
      };
    });
  },

  async saveHolding(holding) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    return unwrap(await sb.from('holdings')
      .upsert({ ...holding, user_id: user.id }, { onConflict: 'account_id,asset_id' })
      .select().single(), 'saveHolding');
  },

  async deleteHolding(id) {
    const sb = await getClient();
    unwrap(await sb.from('holdings').delete().eq('id', id), 'deleteHolding');
    return { ok: true };
  },

  async getNetWorthSeries(days = 365) {
    const sb = await getClient();
    return unwrap(await sb.rpc('net_worth_series', { p_days: days }), 'netWorth') || [];
  },

  async getInvestmentTrades() {
    const sb = await getClient();
    return unwrap(await sb.from('investment_transactions')
      .select('*, asset:assets(symbol, name)')
      .order('executed_at', { ascending: false }).limit(500), 'trades') || [];
  },

  /* — Banking ————————————————————————————————————————— */

  async listCategories() {
    const sb = await getClient();
    return unwrap(await sb.from('categories').select('*')
      .order('sort_order'), 'categories') || [];
  },

  async saveCategory(category) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    if (category.id) {
      return unwrap(await sb.from('categories').update(category)
        .eq('id', category.id).select().single(), 'updateCategory');
    }
    return unwrap(await sb.from('categories')
      .insert({ ...category, user_id: user.id }).select().single(), 'createCategory');
  },

  async listTransactions({ from, to, categoryId, status = 'active', search, limit = 300 } = {}) {
    const sb = await getClient();
    let query = sb.from('bank_transactions')
      .select('*, category:categories(id, slug, label, emoji, color, kind)')
      .order('booked_at', { ascending: false })
      .limit(limit);

    if (status !== 'all') query = query.eq('status', status);
    if (from) query = query.gte('booked_at', from);
    if (to) query = query.lte('booked_at', to);
    if (categoryId) query = query.eq('category_id', categoryId);
    if (search) query = query.ilike('raw_label', `%${search}%`);

    const rows = unwrap(await query, 'transactions') || [];
    return rows.map((row) => ({
      ...row,
      slug: row.category?.slug,
      emoji: row.category?.emoji ?? '❓',
      color: row.category?.color ?? 'var(--neutral)',
      category_label: row.category?.label ?? 'Non classé',
      needsConfirmation: Number(row.category_confidence) < config.categorization.askBelowConfidence,
    }));
  },

  async applyCategoryCorrection(transactionId, categoryId, applySimilar = false) {
    const sb = await getClient();
    return unwrap(await sb.rpc('apply_category_correction', {
      p_transaction_id: transactionId,
      p_category_id: categoryId,
      p_apply_similar: applySimilar,
    }), 'correction');
  },

  async setTransactionStatus(transactionId, status) {
    const sb = await getClient();
    return unwrap(await sb.rpc('set_transaction_status', {
      p_transaction_id: transactionId, p_status: status,
    }), 'status');
  },

  async monthlySummary(month) {
    const sb = await getClient();
    const rows = unwrap(await sb.rpc('monthly_summary', { p_month: month }), 'monthly');
    return rows?.[0] ?? null;
  },

  async categoryBreakdown(month, kind = 'expense') {
    const sb = await getClient();
    return unwrap(await sb.rpc('category_breakdown', { p_month: month, p_kind: kind }), 'breakdown') || [];
  },

  async listRules() {
    const sb = await getClient();
    return unwrap(await sb.from('category_rules')
      .select('*, category:categories(slug, label, emoji, color)')
      .order('priority', { ascending: false }), 'rules') || [];
  },

  async createRule(rule) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    return unwrap(await sb.from('category_rules')
      .insert({ ...rule, user_id: user.id }).select().single(), 'createRule');
  },

  async updateRule(id, patch) {
    const sb = await getClient();
    return unwrap(await sb.from('category_rules').update(patch)
      .eq('id', id).select().single(), 'updateRule');
  },

  async deleteRule(id) {
    const sb = await getClient();
    unwrap(await sb.from('category_rules').delete().eq('id', id), 'deleteRule');
    return { ok: true };
  },

  async listMemory() {
    const sb = await getClient();
    return unwrap(await sb.from('category_memory')
      .select('*, category:categories(slug, label, emoji, color)')
      .order('hits', { ascending: false }).limit(200), 'memory') || [];
  },

  async forgetMemory(keyValue, bucket) {
    const sb = await getClient();
    let query = sb.from('category_memory').delete().eq('key_value', keyValue);
    if (bucket) query = query.eq('amount_bucket', bucket);
    unwrap(await query, 'forgetMemory');
    return { ok: true };
  },

  async listRecurring() {
    const sb = await getClient();
    return unwrap(await sb.from('recurring_transactions')
      .select('*, category:categories(slug, label, emoji, color)')
      .order('average_amount', { ascending: false }), 'recurring') || [];
  },

  /**
   * Recalcule les récurrences à partir de l'historique et les enregistre.
   *
   * La détection tourne côté client parce que le moteur est le même que celui
   * de la démonstration — un seul code, un seul comportement. Le résultat est
   * persisté pour que les autres écrans, et les alertes côté serveur, y aient
   * accès sans tout recalculer.
   */
  async refreshRecurring(transactions) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();

    const rows = (transactions || []).map((r) => ({
      user_id: user.id,
      account_id: r.account_id ?? null,
      label: r.label,
      merchant: r.merchant,
      category_id: r.category_id ?? null,
      kind: r.kind,
      cadence: r.cadence,
      average_amount: r.average_amount,
      last_amount: r.last_amount,
      amount_variance: r.amount_variance,
      occurrences: r.occurrences,
      first_seen: r.first_seen,
      last_seen: r.last_seen,
      next_expected: r.next_expected,
      confidence: r.confidence,
      is_active: r.is_active,
      signature: r.signature,
    }));
    if (!rows.length) return [];

    const saved = unwrap(await sb.from('recurring_transactions')
      .upsert(rows, { onConflict: 'user_id,signature' })
      .select('id, signature'), 'saveRecurring') || [];

    // Rattacher chaque transaction à sa récurrence. C'est ce lien qui évite
    // qu'un loyer soit ensuite signalé comme dépense inhabituelle.
    const bySignature = new Map(saved.map((r) => [r.signature, r.id]));
    for (const detected of transactions) {
      const id = bySignature.get(detected.signature);
      if (!id || !detected.transaction_ids?.length) continue;
      await sb.from('bank_transactions')
        .update({ recurring_id: id })
        .in('id', detected.transaction_ids);
    }

    return this.listRecurring();
  },

  /**
   * Anomalies. Le calcul est fait par la base (`refresh_my_anomalies`), qui
   * applique exactement la même logique que le moteur JavaScript — comparaison
   * au marchand d'abord, à la catégorie ensuite. Le faire côté serveur permet
   * aux alertes de fonctionner application fermée.
   */
  async listAnomalies() {
    const sb = await getClient();
    await sb.rpc('refresh_my_anomalies').catch(() => {});

    const rows = unwrap(await sb.from('bank_transactions')
      .select('id, booked_at, amount, merchant, clean_label, raw_label, category_id, anomaly_score')
      .eq('is_anomaly', true)
      .order('anomaly_score', { ascending: false })
      .limit(30), 'anomalies') || [];

    return rows.map((row) => ({
      transaction_id: row.id,
      category_id: row.category_id,
      amount: Math.abs(Number(row.amount)),
      score: Number(row.anomaly_score),
      booked_at: row.booked_at,
      label: row.merchant || row.clean_label || row.raw_label,
      basis: 'serveur',
      explanation: `${formatEuro(Math.abs(Number(row.amount)))} : nettement au-dessus de vos dépenses habituelles pour ce marchand.`,
    }));
  },

  async saveRecurring(rows) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!rows?.length) return [];
    return unwrap(await sb.from('recurring_transactions')
      .upsert(rows.map((r) => ({ ...r, user_id: user.id })), { onConflict: 'user_id,signature' })
      .select(), 'saveRecurring');
  },

  async listImportBatches() {
    const sb = await getClient();
    return unwrap(await sb.from('import_batches').select('*')
      .order('created_at', { ascending: false }).limit(20), 'imports') || [];
  },

  async importTransactions(rows, batch) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();

    const batchRow = unwrap(await sb.from('import_batches')
      .insert({ ...batch, user_id: user.id }).select().single(), 'batch');

    // ignoreDuplicates : deux relevés qui se chevauchent ne créent pas de
    // doublon, grâce à la contrainte unique (user_id, fingerprint).
    const inserted = unwrap(await sb.from('bank_transactions')
      .upsert(rows.map((r) => ({ ...r, user_id: user.id, import_batch: batchRow.id })),
              { onConflict: 'user_id,fingerprint', ignoreDuplicates: true })
      .select('id'), 'importRows') || [];

    await sb.from('import_batches').update({
      rows_total: rows.length,
      rows_imported: inserted.length,
      rows_skipped: rows.length - inserted.length,
      status: 'done',
    }).eq('id', batchRow.id);

    return { batch: batchRow, imported: inserted.length, skipped: rows.length - inserted.length };
  },

  /* — Moteur ————————————————————————————————————————— */

  async getScoreModel() {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    let row = unwrap(await sb.from('score_models').select('*')
      .eq('is_default', true).maybeSingle(), 'scoreModel');
    if (!row) {
      row = unwrap(await sb.from('score_models')
        .insert({ user_id: user.id, name: 'Modèle équilibré', is_default: true })
        .select().single(), 'scoreModelInit');
    }
    return row;
  },

  async saveScoreModel(model) {
    const sb = await getClient();
    return unwrap(await sb.from('score_models').update({
      weights: model.weights, zone_thresholds: model.zone_thresholds, params: model.params,
    }).eq('id', model.id).select().single(), 'saveScoreModel');
  },

  async listScenarios(assetId) {
    const sb = await getClient();
    return unwrap(await sb.from('scenarios').select('*')
      .eq('asset_id', assetId).eq('is_active', true).order('created_at'), 'scenarios') || [];
  },

  async saveScenarios(assetId, scenarios) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    for (const s of scenarios) {
      if (s.id) await sb.from('scenarios').update(s).eq('id', s.id);
      else await sb.from('scenarios').insert({ ...s, user_id: user.id, asset_id: assetId });
    }
    return this.listScenarios(assetId);
  },

  async listAltRatios(assetId) {
    const sb = await getClient();
    return unwrap(await sb.from('alt_ratios').select('*')
      .eq('asset_id', assetId).order('ratio'), 'altRatios') || [];
  },

  async saveAltRatios(assetId, ratios) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    unwrap(await sb.from('alt_ratios').delete().eq('asset_id', assetId), 'clearRatios');
    if (ratios.length) {
      unwrap(await sb.from('alt_ratios')
        .insert(ratios.map((r) => ({ ...r, user_id: user.id, asset_id: assetId }))), 'insertRatios');
    }
    return this.listAltRatios(assetId);
  },

  async saveScore(row) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    return unwrap(await sb.from('investment_scores')
      .upsert({ ...row, user_id: user.id }, { onConflict: 'user_id,asset_id,day,model_id' })
      .select().single(), 'saveScore');
  },

  /* — Alertes, objectifs, observations ————————————— */

  async listAlerts() {
    const sb = await getClient();
    return unwrap(await sb.from('alerts')
      .select('*, asset:assets(symbol, name), category:categories(label, emoji)')
      .order('created_at', { ascending: false }), 'alerts') || [];
  },

  async saveAlert(alert) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    if (alert.id) {
      unwrap(await sb.from('alerts').update(alert).eq('id', alert.id), 'updateAlert');
    } else {
      unwrap(await sb.from('alerts').insert({ ...alert, user_id: user.id }), 'createAlert');
    }
    return this.listAlerts();
  },

  async deleteAlert(id) {
    const sb = await getClient();
    unwrap(await sb.from('alerts').delete().eq('id', id), 'deleteAlert');
    return { ok: true };
  },

  async listAlertEvents() {
    const sb = await getClient();
    return unwrap(await sb.from('alert_events').select('*')
      .order('created_at', { ascending: false }).limit(50), 'alertEvents') || [];
  },

  async markAlertsRead() {
    const sb = await getClient();
    unwrap(await sb.from('alert_events').update({ read_at: new Date().toISOString() })
      .is('read_at', null), 'markRead');
    return { ok: true };
  },

  async listGoals() {
    const sb = await getClient();
    return unwrap(await sb.from('goals').select('*')
      .eq('is_active', true).order('created_at'), 'goals') || [];
  },

  async saveGoal(goal) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    if (goal.id) unwrap(await sb.from('goals').update(goal).eq('id', goal.id), 'updateGoal');
    else unwrap(await sb.from('goals').insert({ ...goal, user_id: user.id }), 'createGoal');
    return this.listGoals();
  },

  async deleteGoal(id) {
    const sb = await getClient();
    unwrap(await sb.from('goals').delete().eq('id', id), 'deleteGoal');
    return { ok: true };
  },

  async listInsights() {
    const sb = await getClient();
    return unwrap(await sb.from('insights').select('*')
      .is('dismissed_at', null).order('created_at', { ascending: false }).limit(10), 'insights') || [];
  },

  async dismissInsight(id) {
    const sb = await getClient();
    unwrap(await sb.from('insights').update({ dismissed_at: new Date().toISOString() })
      .eq('id', id), 'dismissInsight');
    return { ok: true };
  },

  /* — Identifiants d'exchange ————————————————————————
     Le navigateur n'écrit ni ne lit jamais le secret : il l'envoie à l'Edge
     Function, qui le chiffre avec une clé connue d'elle seule. */

  async listCredentials() {
    const sb = await getClient();
    return unwrap(await sb.rpc('list_provider_credentials'), 'credentials') || [];
  },

  async saveCredential({ provider, label, apiKey, apiSecret, passphrase }) {
    const sb = await getClient();
    const { data, error } = await sb.functions.invoke('credentials-store', {
      body: { provider, label, apiKey, apiSecret, passphrase },
    });
    if (error) throw new Error(error.message || 'Enregistrement impossible');
    return data;
  },

  async deleteCredential(id) {
    const sb = await getClient();
    const { error } = await sb.functions.invoke('credentials-store', {
      body: { action: 'delete', id },
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  },

  async triggerSync(scope) {
    const sb = await getClient();
    const fn = { market: 'market-sync', kraken: 'kraken-sync', okx: 'okx-sync',
      portfolio: 'portfolio-snapshot', alerts: 'alerts-run' }[scope];
    if (!fn) throw new Error(`portée inconnue : ${scope}`);
    const { data, error } = await sb.functions.invoke(fn, { body: {} });
    if (error) throw new Error(error.message);
    return data;
  },

  async getSyncState() {
    const sb = await getClient();
    const rows = unwrap(await sb.from('sync_state').select('*'), 'syncState') || [];
    const out = {};
    for (const row of rows) out[row.scope] = row;
    return out;
  },

  async getDashboard() {
    const sb = await getClient();
    return unwrap(await sb.rpc('dashboard_snapshot'), 'dashboard');
  },

  async getGlossary(code) {
    const sb = await getClient();
    return unwrap(await sb.from('glossary').select('*').eq('code', code).maybeSingle(), 'glossary');
  },

  async logAssistant(entry) {
    const sb = await getClient();
    const { data: { user } } = await sb.auth.getUser();
    unwrap(await sb.from('assistant_messages').insert({ ...entry, user_id: user.id }), 'assistantLog');
    return { ok: true };
  },

  async listAssistantHistory() {
    const sb = await getClient();
    const rows = unwrap(await sb.from('assistant_messages').select('*')
      .order('created_at', { ascending: false }).limit(20), 'assistantHistory') || [];
    return rows.reverse();
  },
};

const formatEuro = (value) => new Intl.NumberFormat('fr-FR', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 2,
}).format(value);

function flattenQuote(row) {
  if (!row) return null;
  const quote = Array.isArray(row.quote) ? row.quote[0] : row.quote;
  return { ...row, quote: quote ? numeric(quote) : null };
}

/** PostgREST renvoie les `numeric` en chaînes : on les reconvertit une fois. */
function numeric(quote) {
  const out = { ...quote };
  for (const key of ['price', 'market_cap', 'volume_24h', 'circulating_supply', 'total_supply',
    'max_supply', 'ath', 'atl', 'change_1h', 'change_24h', 'change_7d', 'change_30d', 'change_1y']) {
    if (out[key] !== null && out[key] !== undefined) out[key] = Number(out[key]);
  }
  return out;
}
