/**
 * WALLET · Synchronisation du marché (§24, §50)
 *
 * Sources, toutes gratuites et sans carte bancaire :
 *   · CoinGecko API publique — prix, capitalisation, ATH/ATL des 100 premières
 *     cryptomonnaies. Limite indicative : ~10 à 30 appels par minute.
 *   · alternative.me — indice Fear & Greed, sans clé.
 *   · Frankfurter (BCE) — taux de change, sans clé.
 *
 * Le référentiel est PARTAGÉ entre tous les utilisateurs : un seul appel
 * alimente tout le monde. C'est le levier principal pour tenir dans le
 * gratuit, bien plus que n'importe quel réglage de cache.
 *
 * Rien ici n'échoue en bloc : si CoinGecko répond mais pas Fear & Greed, les
 * prix sont quand même écrits, et `sync_state` dit ce qui a manqué.
 */

import {
  preflight, json, fail, serviceClient, fetchJson, claimSlot, finishSlot, chunk,
} from '../_shared/http.ts';
import { dailyHistoryEur, okxSpotPrices } from '../_shared/marketdata.ts';

const COINGECKO = 'https://api.coingecko.com/api/v3';
const FEAR_GREED = 'https://api.alternative.me/fng/?limit=1';
const FX = 'https://api.frankfurter.app/latest?from=EUR';

// 10 minutes : largement sous les quotas, et bien plus frais que nécessaire
// pour un suivi de patrimoine.
const MIN_INTERVAL_SECONDS = 600;
const HISTORY_DAYS = 400;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const service = serviceClient();
  const report = { assets: 0, quotes: 0, history: 0, indicators: 0, fx: 0, warnings: [] as string[] };

  try {
    const force = new URL(request.url).searchParams.get('force') === '1';
    const slot = await claimSlot(service, 'market', null, MIN_INTERVAL_SECONDS);
    if (!slot.allowed && !force) {
      return json({
        ok: true, skipped: true, retry_after: slot.retryAfter,
        message: `Données déjà rafraîchies il y a moins de ${MIN_INTERVAL_SECONDS / 60} minutes.`,
      });
    }

    /* — 1. Les 100 principales cryptos ————————————— */
    const markets = await fetchJson(
      `${COINGECKO}/coins/markets?vs_currency=eur&order=market_cap_desc`
      + '&per_page=100&page=1&sparkline=false'
      + '&price_change_percentage=1h,24h,7d,30d,1y',
      { headers: { accept: 'application/json' } },
      { label: 'CoinGecko' },
    ) as Array<Record<string, unknown>>;

    const assetRows = markets.map((coin) => ({
      kind: 'crypto',
      symbol: String(coin.symbol).toUpperCase(),
      name: String(coin.name),
      external_id: String(coin.id),
      source: 'coingecko',
      image_url: coin.image ?? null,
      rank: coin.market_cap_rank ?? null,
      is_stablecoin: isStablecoin(String(coin.symbol)),
    }));

    const { data: upserted, error: assetError } = await service.from('assets')
      .upsert(assetRows, { onConflict: 'kind,symbol,source' })
      .select('id, external_id');
    if (assetError) throw new Error(`assets : ${assetError.message}`);

    report.assets = upserted?.length ?? 0;
    const idByExternal = new Map((upserted ?? []).map((a) => [a.external_id, a.id]));

    /* — 2. Cotations ————————————————————————————— */
    const quoteRows = markets.map((coin) => {
      const assetId = idByExternal.get(String(coin.id));
      if (!assetId) return null;
      return {
        asset_id: assetId,
        currency: 'EUR',
        price: coin.current_price ?? null,
        market_cap: coin.market_cap ?? null,
        volume_24h: coin.total_volume ?? null,
        circulating_supply: coin.circulating_supply ?? null,
        total_supply: coin.total_supply ?? null,
        max_supply: coin.max_supply ?? null,
        ath: coin.ath ?? null,
        ath_date: coin.ath_date ? String(coin.ath_date).slice(0, 10) : null,
        atl: coin.atl ?? null,
        atl_date: coin.atl_date ? String(coin.atl_date).slice(0, 10) : null,
        change_1h: coin.price_change_percentage_1h_in_currency ?? null,
        change_24h: coin.price_change_percentage_24h_in_currency ?? null,
        change_7d: coin.price_change_percentage_7d_in_currency ?? null,
        change_30d: coin.price_change_percentage_30d_in_currency ?? null,
        change_1y: coin.price_change_percentage_1y_in_currency ?? null,
        fetched_at: new Date().toISOString(),
        stale_after: new Date(Date.now() + MIN_INTERVAL_SECONDS * 2000).toISOString(),
      };
    }).filter(Boolean);

    const { error: quoteError } = await service.from('asset_quotes')
      .upsert(quoteRows as Record<string, unknown>[], { onConflict: 'asset_id' });
    if (quoteError) throw new Error(`asset_quotes : ${quoteError.message}`);
    report.quotes = quoteRows.length;

    /* — 3. Actifs détenus hors des cent premières capitalisations ————
       Les altcoins récents ne figurent pas dans le classement CoinGecko.
       Sans cotation ils valaient zéro dans le patrimoine, ce qui est pire
       qu'une valeur approximative : c'est une valeur fausse et silencieuse.
       OKX les cote tous, en un seul appel.                                  */
    const { data: fxRow } = await service.from('fx_rates')
      .select('rate').eq('base', 'EUR').eq('quote', 'USD')
      .order('day', { ascending: false }).limit(1).maybeSingle();
    const usdToEur = fxRow?.rate ? 1 / Number(fxRow.rate) : null;

    try {
      const { data: orphans } = await service.from('assets')
        .select('id, symbol').neq('source', 'coingecko').eq('kind', 'crypto');

      if (orphans?.length) {
        const spot = await okxSpotPrices();
        const rows = [];
        for (const asset of orphans) {
          const entry = spot.get(asset.symbol.toUpperCase());
          const price = entry?.eur
            ?? (Number.isFinite(usdToEur) && entry?.usd ? entry.usd * (usdToEur as number) : null);
          if (price === null) continue;
          rows.push({
            asset_id: asset.id, currency: 'EUR', price,
            fetched_at: new Date().toISOString(),
            stale_after: new Date(Date.now() + MIN_INTERVAL_SECONDS * 2000).toISOString(),
          });
        }
        if (rows.length) {
          await service.from('asset_quotes').upsert(rows, { onConflict: 'asset_id' });
          report.quotes += rows.length;
        }
        const priced = new Set(rows.map((r) => r.asset_id));
        const unpriced = orphans.filter((a) => !priced.has(a.id)).map((a) => a.symbol);
        if (unpriced.length) {
          report.warnings.push(`Sans cotation : ${unpriced.join(', ')}.`);
        }
      }
    } catch {
      report.warnings.push('Cotation des actifs hors classement indisponible.');
    }

    /* — 4. Historique ————————————————————————————
       Une bougie journalière par actif suivi, depuis les marchés publics des
       exchanges. Le plafond par passage évite de dépasser le temps d'exécution
       d'une fonction ; les actifs restants sont traités au passage suivant.  */
    const followed = await followedAssets(service);
    let historyCalls = 0;

    for (const asset of followed) {
      if (historyCalls >= 12) {
        report.warnings.push('Historique : suite au prochain passage.');
        break;
      }
      if (!(await needsHistory(service, asset.id))) continue;
      historyCalls += 1;

      const candles = await dailyHistoryEur(asset.symbol, HISTORY_DAYS, usdToEur);
      if (!candles.length) {
        report.warnings.push(`Historique ${asset.symbol} indisponible.`);
        continue;
      }

      const rows = candles.map((c) => ({
        asset_id: asset.id, currency: 'EUR', day: c.day, close: c.close,
      }));
      for (const batch of chunk(rows, 500)) {
        await service.from('price_history')
          .upsert(batch, { onConflict: 'asset_id,currency,day' });
      }
      report.history += rows.length;
    }

    /* — 4. Fear & Greed ————————————————————————— */
    try {
      const fng = await fetchJson(FEAR_GREED, {}, { label: 'Fear & Greed', retries: 1 }) as { data?: Array<{ value: string; value_classification: string }> };
      const entry = fng.data?.[0];
      if (entry) {
        await service.from('market_indicators').upsert({
          code: 'fear_greed',
          asset_id: null,
          day: new Date().toISOString().slice(0, 10),
          value: Number(entry.value),
          value_text: entry.value_classification,
          source: 'alternative.me',
          is_derived: false,
          confidence: 1,
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'code,asset_id,day' });
        report.indicators += 1;
      }
    } catch {
      report.warnings.push('Fear & Greed indisponible.');
    }

    /* — 5. Dominance Bitcoin ————————————————————— */
    try {
      const global = await fetchJson(`${COINGECKO}/global`, {}, { label: 'CoinGecko (global)', retries: 1 }) as { data?: { market_cap_percentage?: Record<string, number> } };
      const dominance = global.data?.market_cap_percentage?.btc;
      if (Number.isFinite(dominance)) {
        await service.from('market_indicators').upsert({
          code: 'btc_dominance', asset_id: null,
          day: new Date().toISOString().slice(0, 10),
          value: dominance, source: 'coingecko', is_derived: false, confidence: 1,
          fetched_at: new Date().toISOString(),
        }, { onConflict: 'code,asset_id,day' });
        report.indicators += 1;
      }
    } catch {
      report.warnings.push('Dominance indisponible.');
    }

    /* — 6. Taux de change ————————————————————————— */
    try {
      const rates = await fetchJson(FX, {}, { label: 'Frankfurter', retries: 1 }) as { date?: string; rates?: Record<string, number> };
      const day = rates.date ?? new Date().toISOString().slice(0, 10);
      const rows = Object.entries(rates.rates ?? {})
        .filter(([quote]) => ['USD', 'GBP', 'CHF', 'JPY', 'CAD'].includes(quote))
        .map(([quote, rate]) => ({ base: 'EUR', quote, day, rate, source: 'ecb' }));

      if (rows.length) {
        await service.from('fx_rates').upsert(rows, { onConflict: 'base,quote,day' });
        report.fx = rows.length;
      }
    } catch {
      report.warnings.push('Taux de change indisponibles.');
    }

    await finishSlot(service, 'market', null, {
      status: 'ok',
      items: report.quotes,
      message: report.warnings.length ? report.warnings.join(' · ') : undefined,
    });

    return json({ ok: true, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    const rateLimited = /quota|429/i.test(message);

    await finishSlot(service, 'market', null, {
      status: rateLimited ? 'rate_limited' : 'error',
      message,
    });

    // Un quota atteint n'est PAS un incident : on attend, on ne bascule
    // jamais sur une offre payante (§50).
    if (rateLimited) {
      return json({
        ok: false, rate_limited: true,
        message: 'Quota gratuit atteint. La prochaine synchronisation se fera plus tard.',
      }, 429);
    }
    return fail(error);
  }
});

async function followedAssets(service: ReturnType<typeof serviceClient>) {
  // Actifs détenus ou mis en favori par au moins un utilisateur, plus BTC
  // et ETH qui alimentent les indicateurs globaux.
  const { data: held } = await service.from('holdings').select('asset_id');
  const { data: watched } = await service.from('asset_watchlist').select('asset_id');

  const ids = new Set([...(held ?? []), ...(watched ?? [])].map((r) => r.asset_id));

  const { data: core } = await service.from('assets')
    .select('id, symbol, external_id').in('symbol', ['BTC', 'ETH']).eq('source', 'coingecko');
  for (const asset of core ?? []) ids.add(asset.id);

  if (!ids.size) return core ?? [];

  // Pas de filtre sur la source : un actif ajouté par une synchronisation
  // d'exchange mérite le même historique qu'un actif du classement.
  const { data: assets } = await service.from('assets')
    .select('id, symbol, external_id').in('id', [...ids]);
  return assets ?? [];
}

async function needsHistory(service: ReturnType<typeof serviceClient>, assetId: string) {
  const { data } = await service.from('price_history')
    .select('day').eq('asset_id', assetId)
    .order('day', { ascending: false }).limit(1).maybeSingle();

  if (!data) return true;
  const lastDay = new Date(data.day).getTime();
  return Date.now() - lastDay > 20 * 3600 * 1000;   // au plus une fois par jour
}

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'TUSD', 'FDUSD', 'USDE', 'PYUSD', 'EURC', 'EURT']);
const isStablecoin = (symbol: string) => STABLES.has(symbol.toUpperCase());
