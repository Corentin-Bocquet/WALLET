/**
 * WALLET · Logique commune aux synchronisations d'exchange
 * Rapprocher des soldes bruts avec le référentiel d'actifs, puis écrire les
 * positions — sans jamais écraser une position saisie à la main.
 */

import { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const FIAT = new Set(['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD']);
const STABLE = new Set(['USDT', 'USDC', 'DAI', 'EURT', 'EURC', 'TUSD', 'USDG']);

export interface RawBalance { symbol: string; quantity: number }

/**
 * Écrit les positions d'un compte d'exchange.
 *
 * Deux règles :
 *   · une position `source: 'manual'` n'est jamais écrasée — l'utilisateur a
 *     saisi quelque chose, la synchronisation ne le contredit pas en silence ;
 *   · un actif inconnu du référentiel est SIGNALÉ, pas ignoré : sinon un
 *     solde disparaîtrait du patrimoine sans que personne ne le sache.
 */
export async function writeHoldings(
  service: SupabaseClient,
  userId: string,
  accountId: string,
  balances: RawBalance[],
) {
  const symbols = [...new Set(balances.map((b) => b.symbol))];

  const { data: assets } = await service.from('assets')
    .select('id, symbol, kind').in('symbol', symbols);
  const bySymbol = new Map<string, { id: string; symbol: string; kind: string }>(
    (assets ?? []).map((a: any) => [a.symbol, a]));

  const { data: existing } = await service.from('holdings')
    .select('id, asset_id, source').eq('account_id', accountId);
  const existingRows: Array<{ id: string; asset_id: string; source: string }> = existing ?? [];
  const existingByAsset = new Map(existingRows.map((h) => [h.asset_id, h]));

  const rows: Record<string, unknown>[] = [];
  const unknown: string[] = [];
  let cash = 0;

  for (const balance of balances) {
    // Les devises fiat d'un exchange sont du cash, pas une position.
    if (FIAT.has(balance.symbol)) { cash += balance.quantity; continue; }

    const asset = bySymbol.get(balance.symbol);
    if (!asset) { unknown.push(balance.symbol); continue; }

    const previous = existingByAsset.get(asset.id);
    if (previous?.source === 'manual') continue;

    rows.push({
      user_id: userId,
      account_id: accountId,
      asset_id: asset.id,
      quantity: balance.quantity,
      source: 'sync',
      synced_at: new Date().toISOString(),
    });
  }

  if (rows.length) {
    await service.from('holdings').upsert(rows, { onConflict: 'account_id,asset_id' });
  }

  // Les positions synchronisées absentes du dernier relevé sont mises à zéro
  // (elles ont été vendues), pas supprimées : l'historique reste lisible.
  const seen = new Set(rows.map((r) => r.asset_id));
  const stale = existingRows.filter((h) => h.source === 'sync' && !seen.has(h.asset_id));
  if (stale.length) {
    await service.from('holdings').update({ quantity: 0, synced_at: new Date().toISOString() })
      .in('id', stale.map((h) => h.id));
  }

  return { written: rows.length, cash, unknown };
}

export const isStable = (symbol: string) => STABLE.has(symbol);
export const isFiat = (symbol: string) => FIAT.has(symbol);
