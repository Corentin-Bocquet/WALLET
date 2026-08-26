/**
 * WALLET · Données de marché publiques (§50)
 *
 * Pourquoi ne pas utiliser CoinGecko pour l'historique : depuis les serveurs
 * Supabase, dont l'adresse de sortie est partagée entre des milliers de
 * projets, CoinGecko répond 429 sur pratiquement tous les appels. Espacer
 * les requêtes n'y change rien, le quota est consommé par les voisins.
 *
 * Les points d'entrée PUBLICS d'OKX et de Kraken n'ont ni clé ni quota
 * problématique, et couvrent à la fois les grandes capitalisations et les
 * altcoins que CoinGecko ne classe pas dans ses cent premières.
 *
 * CoinGecko reste utilisé pour ce qu'il fait bien et que les exchanges ne
 * fournissent pas : noms, logos, classement, capitalisation.
 */

const OKX = 'https://www.okx.com/api/v5';
const KRAKEN = 'https://api.kraken.com/0/public';

export interface Candle { day: string; close: number }

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function getJson(url: string, timeoutMs = 12000): Promise<any | null> {
  const abort = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(url, { signal: abort, headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Bougies journalières OKX, les plus récentes d'abord.
 * OKX plafonne à 100 bougies par appel : on remonte le temps par paliers.
 */
async function okxCandles(instId: string, days: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let before: string | null = null;

  for (let page = 0; page < Math.ceil(days / 100) && page < 8; page += 1) {
    const url = `${OKX}/market/history-candles?instId=${instId}&bar=1D&limit=100`
      + (before ? `&after=${before}` : '');
    const payload = await getJson(url);
    const rows: string[][] = payload?.data ?? [];
    if (payload?.code !== '0' || !rows.length) break;

    for (const row of rows) {
      const close = Number(row[4]);
      if (Number.isFinite(close)) out.push({ day: dayOf(Number(row[0])), close });
    }
    before = rows[rows.length - 1][0];
    if (out.length >= days) break;
  }
  return out;
}

/** Bougies journalières Kraken, utilisées en secours. */
async function krakenCandles(pair: string): Promise<Candle[]> {
  const payload = await getJson(`${KRAKEN}/OHLC?pair=${pair}&interval=1440`);
  const result = payload?.result;
  if (!result) return [];
  const key = Object.keys(result).find((k) => k !== 'last');
  if (!key) return [];
  return (result[key] as any[][])
    .map((row) => ({ day: dayOf(Number(row[0]) * 1000), close: Number(row[4]) }))
    .filter((c) => Number.isFinite(c.close));
}

/**
 * Historique en euros pour un symbole.
 *
 * On privilégie une paire déjà libellée en euros. À défaut on passe par
 * l'USDT et on convertit — mais uniquement si le taux du jour est connu :
 * un historique converti avec un taux inventé serait faux sur toute sa
 * longueur, et alimenterait ensuite des scores et des scénarios faux.
 */
export async function dailyHistoryEur(
  symbol: string,
  days = 400,
  usdToEur: number | null = null,
): Promise<Candle[]> {
  const upper = symbol.toUpperCase();

  const direct = await okxCandles(`${upper}-EUR`, days);
  if (direct.length > 30) return direct.slice(0, days);

  if (Number.isFinite(usdToEur)) {
    const usdt = await okxCandles(`${upper}-USDT`, days);
    if (usdt.length > 30) {
      return usdt.slice(0, days).map((c) => ({ day: c.day, close: c.close * (usdToEur as number) }));
    }
  }

  const kraken = await krakenCandles(`${upper === 'BTC' ? 'XBT' : upper}EUR`);
  if (kraken.length > 30) return kraken.slice(-days);

  return direct.length ? direct : [];
}

/** Prix comptant de tous les marchés OKX, en un seul appel. */
export async function okxSpotPrices(): Promise<Map<string, { usd: number | null; eur: number | null }>> {
  const payload = await getJson(`${OKX}/market/tickers?instType=SPOT`, 20000);
  const out = new Map<string, { usd: number | null; eur: number | null }>();
  if (payload?.code !== '0') return out;

  for (const row of payload.data ?? []) {
    const [base, quote] = String(row.instId).split('-');
    const price = Number(row.last);
    if (!base || !Number.isFinite(price)) continue;

    const entry = out.get(base) ?? { usd: null, eur: null };
    if (quote === 'EUR') entry.eur = price;
    else if (quote === 'USDT' || quote === 'USDC' || quote === 'USD') entry.usd ??= price;
    out.set(base, entry);
  }
  return out;
}
