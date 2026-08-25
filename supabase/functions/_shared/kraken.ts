/**
 * WALLET · Connecteur Kraken — LECTURE SEULE
 *
 * Seuls trois endpoints privés sont utilisés : Balance, TradeBalance et
 * TradesHistory. Aucun endpoint d'ordre n'est appelé, et la liste ci-dessous
 * est exhaustive : ajouter AddOrder ici serait le seul moyen de trader, ce
 * qui rend la garantie vérifiable en lisant ce fichier.
 *
 * Signature Kraken : HMAC-SHA512( path + SHA256(nonce + postdata), base64(secret) )
 */

import { hmac, sha256, concat, fromBase64, toBase64, bytesOf } from './crypto.ts';
import { HttpError } from './http.ts';

const BASE = 'https://api.kraken.com';

/** Endpoints autorisés. Toute autre valeur est rejetée avant l'appel. */
const ALLOWED = new Set(['Balance', 'TradeBalance', 'TradesHistory', 'Ledgers']);

export interface KrakenKeys { apiKey: string; apiSecret: string }

export async function krakenPrivate(
  keys: KrakenKeys,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  if (!ALLOWED.has(endpoint)) {
    // Garde-fou : même une erreur de programmation ne peut pas passer un ordre.
    throw new HttpError(`Endpoint Kraken non autorisé : ${endpoint}`, 500, false);
  }

  const path = `/0/private/${endpoint}`;
  const nonce = String(Date.now() * 1000);
  const body = new URLSearchParams({ nonce, ...params }).toString();

  const digest = await sha256(nonce + body);
  const signature = await hmac(
    fromBase64(keys.apiSecret),
    concat(bytesOf(path), digest),
    'SHA-512',
  );

  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'API-Key': keys.apiKey,
      'API-Sign': toBase64(signature),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'WALLET/1.0 (read-only)',
    },
    body,
  });

  if (!response.ok) {
    throw new HttpError(`Kraken a répondu ${response.status}.`, 502, false);
  }

  const payload = await response.json();
  if (Array.isArray(payload.error) && payload.error.length) {
    const message = payload.error.join(', ');
    // « Permission denied » sur un endpoint de lecture = clé mal configurée.
    throw new HttpError(`Kraken : ${message}`, 400);
  }
  return payload.result ?? {};
}

/**
 * Vérifie qu'une clé est bien en lecture seule.
 *
 * Kraken n'expose pas les permissions d'une clé. On procède donc par
 * l'absurde : on appelle un endpoint de LECTURE (qui doit réussir), puis on
 * tente une opération d'écriture avec `validate=true` — un mode « à blanc »
 * qui ne place aucun ordre. Si Kraken l'accepte, la clé a le droit de trader
 * et on la refuse.
 */
export async function krakenReadOnly(keys: KrakenKeys): Promise<boolean> {
  // 1. La lecture doit fonctionner, sinon la clé est inutilisable.
  await krakenPrivate(keys, 'Balance');

  // 2. Sonde d'écriture, en mode validation seule.
  const path = '/0/private/AddOrder';
  const nonce = String(Date.now() * 1000);
  const body = new URLSearchParams({
    nonce,
    pair: 'XBTEUR',
    type: 'buy',
    ordertype: 'limit',
    price: '1',            // volontairement absurde
    volume: '0.0001',
    validate: 'true',      // Kraken ne place RIEN avec ce drapeau
  }).toString();

  const digest = await sha256(nonce + body);
  const signature = await hmac(
    fromBase64(keys.apiSecret),
    concat(bytesOf(path), digest),
    'SHA-512',
  );

  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'API-Key': keys.apiKey,
      'API-Sign': toBase64(signature),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'WALLET/1.0 (permission probe)',
    },
    body,
  });

  const payload = await response.json().catch(() => ({ error: ['unreadable'] }));
  const errors: string[] = Array.isArray(payload.error) ? payload.error : [];

  // Permission refusée = exactement ce qu'on veut.
  const denied = errors.some((e) =>
    /Permission denied|Invalid key|EGeneral:Permission/i.test(e));

  return denied;
}

/** Solde par actif, symboles normalisés. */
export async function krakenBalances(keys: KrakenKeys) {
  const result = await krakenPrivate(keys, 'Balance') as Record<string, string>;

  const balances: Array<{ symbol: string; quantity: number }> = [];
  for (const [rawSymbol, rawAmount] of Object.entries(result)) {
    const quantity = Number(rawAmount);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    balances.push({ symbol: normalizeSymbol(rawSymbol), quantity });
  }
  return balances;
}

/**
 * Kraken utilise ses propres codes : XXBT pour BTC, ZEUR pour EUR, et suffixe
 * les actifs en jalonnement (« .S », « .M »). On ramène tout au symbole usuel.
 */
export function normalizeSymbol(raw: string): string {
  let symbol = raw.replace(/\.(S|M|F|B|P\d*|HOLD)$/i, '');

  const aliases: Record<string, string> = {
    XXBT: 'BTC', XBT: 'BTC', XETH: 'ETH', XXRP: 'XRP', XLTC: 'LTC',
    XXLM: 'XLM', XXMR: 'XMR', XZEC: 'ZEC', XREP: 'REP', XMLN: 'MLN',
    ZEUR: 'EUR', ZUSD: 'USD', ZGBP: 'GBP', ZCAD: 'CAD', ZJPY: 'JPY',
    XDG: 'DOGE',
  };
  if (aliases[symbol]) return aliases[symbol];

  // Les anciens codes commencent par X (crypto) ou Z (devise) sur 4 lettres.
  if (/^[XZ][A-Z]{3}$/.test(symbol)) symbol = symbol.slice(1);
  return symbol;
}

/** Historique d'achats/ventes, pour l'analyse de comportement (§31). */
export async function krakenTrades(keys: KrakenKeys, sinceSeconds?: number) {
  const params: Record<string, string> = {};
  if (sinceSeconds) params.start = String(sinceSeconds);

  const result = await krakenPrivate(keys, 'TradesHistory', params) as {
    trades?: Record<string, Record<string, string>>;
  };

  return Object.entries(result.trades ?? {}).map(([id, trade]) => ({
    external_id: id,
    pair: trade.pair,
    side: trade.type === 'sell' ? 'sell' : 'buy',
    quantity: Number(trade.vol),
    price: Number(trade.price),
    fee: Number(trade.fee ?? 0),
    executed_at: new Date(Number(trade.time) * 1000).toISOString(),
  }));
}
