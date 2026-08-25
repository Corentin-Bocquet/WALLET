/**
 * WALLET · Connecteur OKX — LECTURE SEULE
 *
 * Signature OKX : base64(HMAC-SHA256(timestamp + METHOD + path + body, secret))
 * avec un horodatage ISO à la milliseconde.
 *
 * Comme pour Kraken, la liste des chemins autorisés est close : aucun
 * endpoint /trade/order n'y figure, et la fonction refuse tout chemin absent
 * de la liste avant même de signer.
 */

import { hmac, toBase64 } from './crypto.ts';
import { HttpError } from './http.ts';

const BASE = 'https://www.okx.com';

const ALLOWED = [
  '/api/v5/account/balance',
  '/api/v5/account/config',
  '/api/v5/asset/balances',
  '/api/v5/account/bills-archive',
  '/api/v5/trade/fills-history',
];

export interface OkxKeys { apiKey: string; apiSecret: string; passphrase: string }

export async function okxPrivate(
  keys: OkxKeys,
  path: string,
  query: Record<string, string> = {},
): Promise<unknown[]> {
  if (!ALLOWED.includes(path)) {
    throw new HttpError(`Endpoint OKX non autorisé : ${path}`, 500, false);
  }

  const search = new URLSearchParams(query).toString();
  const fullPath = search ? `${path}?${search}` : path;
  const timestamp = new Date().toISOString();

  const signature = await hmac(keys.apiSecret, `${timestamp}GET${fullPath}`, 'SHA-256');

  const response = await fetch(BASE + fullPath, {
    method: 'GET',
    headers: {
      'OK-ACCESS-KEY': keys.apiKey,
      'OK-ACCESS-SIGN': toBase64(signature),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': keys.passphrase,
      'Content-Type': 'application/json',
      'User-Agent': 'WALLET/1.0 (read-only)',
    },
  });

  if (!response.ok) {
    throw new HttpError(`OKX a répondu ${response.status}.`, 502, false);
  }

  const payload = await response.json();
  if (payload.code && payload.code !== '0') {
    throw new HttpError(`OKX : ${payload.msg || payload.code}`, 400);
  }
  return payload.data ?? [];
}

/**
 * Vérifie les permissions.
 *
 * OKX, contrairement à Kraken, EXPOSE les permissions de la clé via
 * /account/config → champ `perm` (« read_only », « trade », « withdraw »).
 * Pas besoin de sonde : on lit et on décide.
 */
export async function okxReadOnly(keys: OkxKeys): Promise<boolean> {
  const data = await okxPrivate(keys, '/api/v5/account/config') as Array<{ perm?: string }>;
  const permissions = String(data[0]?.perm ?? '').toLowerCase();

  if (!permissions) {
    // Champ absent : on ne peut pas garantir, donc on refuse plutôt que
    // de supposer. Mieux vaut un faux refus qu'une clé trop puissante.
    return false;
  }
  return !/trade|withdraw/.test(permissions);
}

/** Solde consolidé : compte de trading + compte de financement. */
export async function okxBalances(keys: OkxKeys) {
  const totals = new Map<string, number>();

  const trading = await okxPrivate(keys, '/api/v5/account/balance') as Array<{
    details?: Array<{ ccy: string; eq?: string; cashBal?: string }>;
  }>;
  for (const account of trading) {
    for (const detail of account.details ?? []) {
      const quantity = Number(detail.eq ?? detail.cashBal ?? 0);
      if (Number.isFinite(quantity) && quantity > 0) {
        totals.set(detail.ccy, (totals.get(detail.ccy) ?? 0) + quantity);
      }
    }
  }

  const funding = await okxPrivate(keys, '/api/v5/asset/balances') as Array<{
    ccy: string; bal?: string;
  }>;
  for (const entry of funding) {
    const quantity = Number(entry.bal ?? 0);
    if (Number.isFinite(quantity) && quantity > 0) {
      totals.set(entry.ccy, (totals.get(entry.ccy) ?? 0) + quantity);
    }
  }

  return [...totals.entries()].map(([symbol, quantity]) => ({ symbol, quantity }));
}

/** Historique d'exécutions (90 jours maximum côté OKX). */
export async function okxFills(keys: OkxKeys) {
  const data = await okxPrivate(keys, '/api/v5/trade/fills-history', {
    instType: 'SPOT', limit: '100',
  }) as Array<Record<string, string>>;

  return data.map((fill) => ({
    external_id: fill.tradeId,
    pair: fill.instId,
    side: fill.side === 'sell' ? 'sell' : 'buy',
    quantity: Number(fill.fillSz),
    price: Number(fill.fillPx),
    fee: Math.abs(Number(fill.fee ?? 0)),
    executed_at: new Date(Number(fill.ts)).toISOString(),
  }));
}
