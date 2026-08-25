/**
 * WALLET · Enregistrement des clés d'exchange (§4)
 *
 * Le navigateur envoie la clé UNE fois ; cette fonction la chiffre et la
 * range. Elle ne redescend jamais. Aucun endpoint de WALLET ne renvoie un
 * secret déchiffré.
 *
 * Avant d'enregistrer, la clé est TESTÉE et ses permissions VÉRIFIÉES : une
 * clé disposant de droits de trading ou de retrait est refusée. Le cahier
 * des charges est catégorique là-dessus, et une vérification vaut mieux
 * qu'une case à cocher.
 */

import { preflight, json, fail, requireUser, serviceClient, HttpError } from '../_shared/http.ts';
import { encryptSecret, fingerprintOf } from '../_shared/crypto.ts';
import { krakenPrivate, krakenReadOnly } from '../_shared/kraken.ts';
import { okxPrivate, okxReadOnly } from '../_shared/okx.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const service = serviceClient();

    /* — Suppression ————————————————————————————————— */
    if (body.action === 'delete') {
      if (!body.id) throw new HttpError('Identifiant manquant.');
      const { error } = await service.from('provider_credentials')
        .delete().eq('id', body.id).eq('user_id', user.id);
      if (error) throw new HttpError('Suppression impossible.', 500, false);
      return json({ ok: true });
    }

    /* — Enregistrement ————————————————————————————— */
    const provider = String(body.provider ?? '');
    const apiKey = String(body.apiKey ?? '').trim();
    const apiSecret = String(body.apiSecret ?? '').trim();
    const passphrase = String(body.passphrase ?? '').trim();

    if (!['kraken', 'okx'].includes(provider)) {
      throw new HttpError('Fournisseur non pris en charge.');
    }
    if (!apiKey || !apiSecret) {
      throw new HttpError('Clé et secret sont requis.');
    }
    if (provider === 'okx' && !passphrase) {
      throw new HttpError('OKX exige également une passphrase.');
    }

    /* La clé doit fonctionner ET être en lecture seule. ------------- */
    let permissionsOk: boolean;
    try {
      permissionsOk = provider === 'kraken'
        ? await krakenReadOnly({ apiKey, apiSecret })
        : await okxReadOnly({ apiKey, apiSecret, passphrase });
    } catch (error) {
      throw new HttpError(
        `La clé n'a pas pu être vérifiée auprès de ${provider === 'okx' ? 'OKX' : 'Kraken'}. `
        + `Vérifiez qu'elle est active et correctement recopiée.`,
        400,
      );
    }

    if (!permissionsOk) {
      throw new HttpError(
        'Cette clé dispose de droits de trading ou de retrait. WALLET refuse de '
        + 'l\'enregistrer. Créez une clé en lecture seule et réessayez.',
        400,
      );
    }

    const payload = JSON.stringify({ apiKey, apiSecret, passphrase: passphrase || null });
    const encrypted = await encryptSecret(user.id, payload);

    const { error } = await service.from('provider_credentials').upsert({
      user_id: user.id,
      provider,
      label: String(body.label ?? provider),
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      key_version: encrypted.key_version,
      scope: 'read_only',
      fingerprint: fingerprintOf(apiKey),
      last_error: null,
    }, { onConflict: 'user_id,provider,label' });

    if (error) throw new HttpError('Enregistrement impossible.', 500, false);

    // Le compte correspondant est créé s'il n'existe pas encore.
    const { data: existingAccount } = await service.from('accounts')
      .select('id').eq('user_id', user.id).eq('provider', provider).maybeSingle();

    if (!existingAccount) {
      await service.from('accounts').insert({
        user_id: user.id,
        kind: 'exchange',
        provider,
        label: provider === 'okx' ? 'OKX' : 'Kraken',
        currency: 'EUR',
        balance: null,          // inconnu tant que rien n'est synchronisé
      });
    }

    return json({ ok: true, permissions_ok: true, fingerprint: fingerprintOf(apiKey) });
  } catch (error) {
    return fail(error);
  }
});
