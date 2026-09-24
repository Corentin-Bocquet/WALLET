/**
 * WALLET · Logique commune aux synchronisations d'exchange
 * Rapprocher des soldes bruts avec le référentiel d'actifs, puis écrire les
 * positions — sans jamais écraser une position saisie à la main.
 */

import { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const FIAT = new Set(['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD']);
const STABLE = new Set([
  'USDT', 'USDC', 'DAI', 'TUSD', 'USDG', 'PYUSD', 'FDUSD', 'USDE', 'EURC', 'EURT', 'EUROC', 'EURI',
]);

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
  rawBalances: RawBalance[],
) {
  // Un même symbole ne doit apparaître qu'une fois : voir krakenBalances().
  // Filet de sécurité pour tout futur connecteur qui oublierait d'additionner.
  const merged = new Map<string, number>();
  for (const b of rawBalances) merged.set(b.symbol, (merged.get(b.symbol) ?? 0) + b.quantity);
  const balances: RawBalance[] = [...merged.entries()].map(([symbol, quantity]) => ({ symbol, quantity }));

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
  const cashByCurrency: Record<string, number> = {};

  for (const balance of balances) {
    // Les devises fiat d'un exchange sont du cash, pas une position.
    if (FIAT.has(balance.symbol)) {
      cashByCurrency[balance.symbol] = (cashByCurrency[balance.symbol] ?? 0) + balance.quantity;
      continue;
    }

    let asset = bySymbol.get(balance.symbol);

    // Actif absent du référentiel : on le CRÉE au lieu de l'ignorer. Un solde
    // qui disparaît du patrimoine sans un mot est le pire des comportements ;
    // market-sync lui trouvera une cotation au prochain passage.
    if (!asset) {
      const { data: created } = await service.from('assets').upsert({
        kind: 'crypto',
        symbol: balance.symbol,
        name: balance.symbol,
        external_id: `exchange:${balance.symbol}`,
        source: 'exchange',
      }, { onConflict: 'kind,symbol,source' }).select('id, symbol, kind').maybeSingle();

      if (!created) { unknown.push(balance.symbol); continue; }
      asset = created as { id: string; symbol: string; kind: string };
      bySymbol.set(balance.symbol, asset);
      unknown.push(balance.symbol);
    }

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
    // Une écriture refusée doit faire échouer la synchronisation : ignorée,
    // elle laissait les anciennes quantités affichées comme si tout allait bien.
    const { error } = await service.from('holdings').upsert(rows, { onConflict: 'account_id,asset_id' });
    if (error) throw new Error(`Positions non enregistrées : ${error.message}`);
  }

  // Les positions synchronisées absentes du dernier relevé sont mises à zéro
  // (elles ont été vendues), pas supprimées : l'historique reste lisible.
  const seen = new Set(rows.map((r) => r.asset_id));
  const stale = existingRows.filter((h) => h.source === 'sync' && !seen.has(h.asset_id));
  if (stale.length) {
    const { error } = await service.from('holdings')
      .update({ quantity: 0, synced_at: new Date().toISOString() })
      .in('id', stale.map((h) => h.id));
    if (error) throw new Error(`Positions vendues non remises à zéro : ${error.message}`);
  }

  return { written: rows.length, cashByCurrency, unknown };
}

export const isStable = (symbol: string) => STABLE.has(symbol);
export const isFiat = (symbol: string) => FIAT.has(symbol);

/**
 * Devise de cotation d'une paire d'exchange, ramenée à une devise réelle :
 * un stablecoin dollar vaut un dollar, un stablecoin euro vaut un euro.
 *   « XXBTZEUR » → EUR, « SOL-USDT » → USD, « ETHUSDC » → USD
 */
export function quoteCurrency(pair: string): string | null {
  const raw = String(pair ?? '').toUpperCase().replace(/[-_/]/g, '');
  const match = /(ZEUR|ZUSD|EURT|EURC|USDT|USDC|EUR|USD|GBP|CHF)$/.exec(raw);
  if (!match) return null;
  const quote = match[1];
  if (quote === 'ZEUR' || quote === 'EURT' || quote === 'EURC') return 'EUR';
  if (quote === 'ZUSD' || quote === 'USDT' || quote === 'USDC') return 'USD';
  return quote;
}

/**
 * Taux EUR → devise les plus récents (table fx_rates, alimentée par
 * market-sync). Sert à ramener en euros le prix d'un achat fait en dollars :
 * sans cela, un achat de BTC à 60 000 USDT était comparé à un historique en
 * euros comme s'il avait coûté 60 000 €, et l'analyse de comportement
 * (« achats dans les creux ») se trompait d'environ 8 %.
 */
export async function latestEurRates(service: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await service.from('fx_rates')
    .select('quote, rate, day').eq('base', 'EUR')
    .order('day', { ascending: false }).limit(60);
  const rates = new Map<string, number>([['EUR', 1]]);
  for (const row of data ?? []) {
    if (!rates.has(row.quote)) rates.set(row.quote, Number(row.rate));
  }
  return rates;
}

/** Prix converti en euros, ou null si la devise n'a pas de taux connu. */
export function priceInEur(price: unknown, currency: string | null, rates: Map<string, number>) {
  const value = Number(price);
  if (!Number.isFinite(value)) return null;
  const rate = rates.get(currency ?? 'EUR');
  return rate ? value / rate : null;
}
