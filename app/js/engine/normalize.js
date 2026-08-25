/**
 * WALLET · Normalisation des libellés
 *
 * DOIT rester rigoureusement identique à public.normalize_label() et
 * public.amount_bucket() (migration 0007). Si les deux divergent, la mémoire
 * écrite côté base ne sera plus retrouvée côté client. Les tests comparent
 * les deux implémentations sur un jeu de libellés réels.
 */

const NOISE = /\b(cb|carte|paiement|prlv|prelevement|vir|virement|sepa|inst|achat|retrait|facture|ref|mandat|echeance)\b/g;
const DATES = /[0-9]{2}[/.\-][0-9]{2}([/.\-][0-9]{2,4})?/g;
const LONG_NUMBERS = /[0-9]{4,}/g;
const NON_ALNUM = /[^a-z0-9 ]+/g;

const ACCENTS_FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ';
const ACCENTS_TO   = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY';

export function deaccent(text) {
  let out = '';
  for (const ch of String(text || '')) {
    const i = ACCENTS_FROM.indexOf(ch);
    out += i === -1 ? ch : ACCENTS_TO[i];
  }
  return out;
}

export function normalizeLabel(raw) {
  return deaccent(raw)
    .toLowerCase()
    .replace(NOISE, ' ')
    .replace(DATES, ' ')
    .replace(LONG_NUMBERS, ' ')
    .replace(NON_ALNUM, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const BUCKETS = ['micro', 'small', 'medium', 'large', 'xl'];

export function amountBucket(amount) {
  const abs = Math.abs(Number(amount) || 0);
  if (abs < 10) return 'micro';
  if (abs < 30) return 'small';
  if (abs < 100) return 'medium';
  if (abs < 400) return 'large';
  return 'xl';
}

export const BUCKET_LABEL = {
  micro:  'moins de 10 €',
  small:  'de 10 à 30 €',
  medium: 'de 30 à 100 €',
  large:  'de 100 à 400 €',
  xl:     'plus de 400 €',
};

/**
 * Empreinte de dédoublonnage à l'import : deux relevés qui se chevauchent ne
 * doivent pas créer deux fois la même ligne.
 */
export function fingerprint({ account_id, booked_at, amount, raw_label }) {
  const date = String(booked_at).slice(0, 10);
  const cents = Math.round(Number(amount) * 100);
  return [account_id, date, cents, normalizeLabel(raw_label)].join('|');
}
