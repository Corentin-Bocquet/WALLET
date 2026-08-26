/**
 * WALLET · Instantané quotidien du patrimoine (§23, §43)
 *
 * Écrit une ligne par jour et par utilisateur. Sans cette photographie
 * quotidienne, la courbe de l'accueil serait impossible : les prix passés
 * existent, mais pas la composition passée du portefeuille.
 *
 * `is_partial` est posé dès qu'une source manque. C'est ce drapeau qui permet
 * à l'interface de dire « total partiel » au lieu d'afficher un chiffre faux
 * avec assurance (§46).
 */

import {
  preflight, json, fail, serviceClient, requireUser, claimSlot, finishSlot,
} from '../_shared/http.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const service = serviceClient();

  try {
    const url = new URL(request.url);
    const isCron = url.searchParams.get('cron') === '1'
      && request.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET');

    // Deux usages : déclenché par l'utilisateur, ou par le planificateur pour
    // tout le monde. Le second exige un secret partagé.
    const userIds: string[] = [];
    if (isCron) {
      const { data } = await service.from('profiles').select('id');
      userIds.push(...(data ?? []).map((p) => p.id));
    } else {
      const { user } = await requireUser(request);
      userIds.push(user.id);
    }

    const results = [];
    for (const userId of userIds) {
      results.push(await snapshotFor(service, userId));
    }

    return json({ ok: true, users: results.length, results });
  } catch (error) {
    return fail(error);
  }
});

async function snapshotFor(service: ReturnType<typeof serviceClient>, userId: string) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: accounts } = await service.from('accounts')
    .select('id, kind, balance, include_in_net_worth, is_active, label')
    .eq('user_id', userId);

  const { data: holdings } = await service.from('holdings')
    .select('quantity, asset_id, assets(kind, symbol)')
    .eq('user_id', userId);

  const assetIds = [...new Set((holdings ?? []).map((h) => h.asset_id))];
  const { data: quotes } = assetIds.length
    ? await service.from('asset_quotes').select('asset_id, price, fetched_at').in('asset_id', assetIds)
    : { data: [] };
  const priceByAsset = new Map<string, { asset_id: string; price: number | null; fetched_at: string }>(
    (quotes ?? []).map((q: any) => [q.asset_id, q]));

  let cash = 0;
  let crypto = 0;
  let equity = 0;
  let other = 0;
  let partial = false;
  const missing: string[] = [];

  for (const account of accounts ?? []) {
    if (!account.include_in_net_worth || account.is_active === false) continue;

    // Un compte d'exchange est valorisé par ses positions POUR LES CRYPTOS,
    // mais ses liquidités (euros et dollars laissés sur la plateforme) ne sont
    // pas des positions : sans cette ligne elles disparaissaient du patrimoine.
    // On ne les compte que si un solde a réellement été relevé.
    if (account.kind === 'exchange') {
      if (account.balance !== null && account.balance !== undefined) {
        cash += Number(account.balance);
      }
      continue;
    }

    if (account.balance === null || account.balance === undefined) {
      partial = true;
      missing.push(account.label);
      continue;
    }
    cash += Number(account.balance);
  }

  for (const holding of holdings ?? []) {
    const quantity = Number(holding.quantity) || 0;
    if (quantity === 0) continue;

    const quote = priceByAsset.get(holding.asset_id);
    if (!quote?.price) {
      partial = true;
      missing.push(holding.assets?.symbol ?? 'actif inconnu');
      continue;
    }

    const value = quantity * Number(quote.price);
    const kind = holding.assets?.kind;
    if (kind === 'stock' || kind === 'etf') equity += value;
    else if (kind === 'crypto') crypto += value;
    else other += value;
  }

  const total = cash + crypto + equity + other;

  const { error } = await service.from('portfolio_snapshots').upsert({
    user_id: userId,
    day: today,
    captured_at: new Date().toISOString(),
    currency: 'EUR',
    total_value: round2(total),
    crypto_value: round2(crypto),
    equity_value: round2(equity),
    cash_value: round2(cash),
    other_value: round2(other),
    is_partial: partial,
    breakdown: { missing },
  }, { onConflict: 'user_id,day' });

  if (error) return { user_id: userId, ok: false, error: error.message };

  await finishSlot(service, 'portfolio', userId, {
    status: 'ok',
    message: partial ? `Sources manquantes : ${missing.join(', ')}` : undefined,
  });

  return { user_id: userId, ok: true, total: round2(total), is_partial: partial, missing };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
