/**
 * WALLET · Synchronisation OKX (lecture seule)
 */

import {
  preflight, json, fail, requireUser, serviceClient, HttpError,
  claimSlot, finishSlot,
} from '../_shared/http.ts';
import { decryptSecret } from '../_shared/crypto.ts';
import { okxBalances, okxFills } from '../_shared/okx.ts';
import { writeHoldings } from '../_shared/sync.ts';

const MIN_INTERVAL_SECONDS = 60;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const service = serviceClient();
  let userId: string | null = null;

  try {
    const { user } = await requireUser(request);
    userId = user.id;

    const slot = await claimSlot(service, 'okx', userId, MIN_INTERVAL_SECONDS);
    if (!slot.allowed) {
      return json({
        ok: false, rate_limited: true, retry_after: slot.retryAfter,
        message: `Déjà synchronisé récemment. Réessayez dans ${slot.retryAfter} s.`,
      }, 429);
    }

    const { data: credential } = await service.from('provider_credentials')
      .select('*').eq('user_id', userId).eq('provider', 'okx').maybeSingle();
    if (!credential) throw new HttpError('Aucune clé OKX enregistrée.', 404);

    const keys = JSON.parse(await decryptSecret(userId, credential.ciphertext, credential.iv));

    const { data: account } = await service.from('accounts')
      .select('id').eq('user_id', userId).eq('provider', 'okx').maybeSingle();
    if (!account) throw new HttpError('Compte OKX introuvable.', 404);

    const balances = await okxBalances(keys);
    const result = await writeHoldings(service, userId, account.id, balances);

    await service.from('accounts').update({
      balance: result.cash > 0 ? result.cash : null,
      balance_at: new Date().toISOString(),
    }).eq('id', account.id);

    let fillsImported = 0;
    try {
      const fills = await okxFills(keys);
      fillsImported = await importFills(service, userId, account.id, fills);
    } catch (error) {
      console.warn('[wallet] historique OKX indisponible', error);
    }

    await service.from('provider_credentials')
      .update({ last_used_at: new Date().toISOString(), last_error: null })
      .eq('id', credential.id);

    await finishSlot(service, 'okx', userId, {
      status: 'ok', items: result.written,
      message: result.unknown.length
        ? `${result.unknown.length} actifs non suivis : ${result.unknown.join(', ')}`
        : undefined,
    });

    return json({
      ok: true, holdings: result.written, cash: result.cash,
      trades: fillsImported, unknown_assets: result.unknown,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    await finishSlot(service, 'okx', userId, { status: 'error', message });
    if (userId) {
      await service.from('provider_credentials')
        .update({ last_error: message.slice(0, 300) })
        .eq('user_id', userId).eq('provider', 'okx');
    }
    return fail(error);
  }
});

async function importFills(
  service: ReturnType<typeof serviceClient>,
  userId: string,
  accountId: string,
  fills: Array<Record<string, unknown>>,
) {
  if (!fills.length) return 0;

  const { data: assets } = await service.from('assets').select('id, symbol');
  const bySymbol = new Map((assets ?? []).map((a) => [a.symbol, a.id]));

  const rows = fills.map((fill) => {
    const [base] = String(fill.pair ?? '').split('-');
    const assetId = bySymbol.get(base);
    if (!assetId) return null;
    return {
      user_id: userId, account_id: accountId, asset_id: assetId,
      side: fill.side, quantity: fill.quantity, price: fill.price, fee: fill.fee,
      currency: 'EUR', executed_at: fill.executed_at,
      external_id: fill.external_id, source: 'okx',
    };
  }).filter(Boolean);

  if (!rows.length) return 0;
  const { error } = await service.from('investment_transactions')
    .upsert(rows, { onConflict: 'user_id,source,external_id', ignoreDuplicates: true });
  return error ? 0 : rows.length;
}
