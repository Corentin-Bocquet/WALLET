/**
 * WALLET · Détection des dépenses récurrentes (§19)
 *
 * Approche : regrouper par marchand normalisé, puis chercher une régularité
 * dans les écarts entre dates. On exige au moins 3 occurrences — deux points
 * font toujours une droite, ce n'est pas une preuve de récurrence.
 *
 * La confiance combine :
 *   · la régularité des intervalles (écart-type rapporté à la moyenne)
 *   · la stabilité des montants
 *   · le nombre d'occurrences
 *   · la fraîcheur (un abonnement résilié il y a 8 mois n'est plus actif)
 */

import { median, stdev, mean } from './stats.js';
import { normalizeLabel } from './normalize.js';

const DAY = 86400000;

/** Cadences reconnues, en jours, avec leur tolérance. */
/**
 * Régularité minimale pour parler de récurrence : en dessous, les intervalles
 * varient de plus des deux tiers de leur propre médiane, ce qui décrit un
 * marchand fréquenté au hasard, pas un prélèvement.
 */
const MIN_REGULARITY = 0.35;

const CADENCES = [
  { code: 'weekly',    days: 7,     tolerance: 2 },
  { code: 'biweekly',  days: 14,    tolerance: 3 },
  { code: 'monthly',   days: 30.44, tolerance: 5 },
  { code: 'bimonthly', days: 60.9,  tolerance: 8 },
  { code: 'quarterly', days: 91.3,  tolerance: 12 },
  { code: 'yearly',    days: 365.25, tolerance: 25 },
];

export const CADENCE_LABEL = {
  weekly: 'par semaine', biweekly: 'toutes les 2 semaines', monthly: 'par mois',
  bimonthly: 'tous les 2 mois', quarterly: 'par trimestre', yearly: 'par an',
  irregular: 'irrégulier',
};

/**
 * @param {Array} transactions  transactions actives, tous mois confondus
 * @param {object} options      { minOccurrences, now }
 * @returns {Array} récurrences détectées, triées par montant décroissant
 */
export function detectRecurring(transactions, {
  minOccurrences = 3,
  now = Date.now(),
} = {}) {
  const groups = new Map();

  for (const tx of transactions || []) {
    if (tx.status && tx.status !== 'active') continue;
    const key = (tx.merchant || normalizeLabel(tx.raw_label) || '').trim();
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const found = [];

  for (const [key, items] of groups) {
    // Un marchand peut porter à la fois un abonnement et des achats ponctuels
    // (Amazon Prime vs commandes). On sépare par ordre de grandeur du montant.
    for (const cluster of clusterByAmount(items)) {
      if (cluster.length < minOccurrences) continue;

      const sorted = cluster.slice().sort((a, b) => date(a) - date(b));
      const gaps = [];
      for (let i = 1; i < sorted.length; i += 1) {
        gaps.push((date(sorted[i]) - date(sorted[i - 1])) / DAY);
      }
      if (!gaps.length) continue;

      const medianGap = median(gaps);
      const cadence = matchCadence(medianGap);
      if (!cadence) continue;

      const amounts = sorted.map((t) => Math.abs(t.amount));
      const avgAmount = mean(amounts);
      const amountSd = stdev(amounts) ?? 0;

      // Régularité : 1 quand les intervalles sont identiques, 0 quand ils
      // varient autant que leur propre moyenne.
      const gapSd = stdev(gaps) ?? 0;
      const regularity = clamp01(1 - gapSd / Math.max(medianGap, 1));
      const amountStability = clamp01(1 - amountSd / Math.max(avgAmount, 1));
      const volume = clamp01((sorted.length - minOccurrences + 1) / 6);

      const last = date(sorted[sorted.length - 1]);
      const sinceLast = (now - last) / DAY;
      // Au-delà de deux périodes sans passage, on considère l'abonnement arrêté.
      const isActive = sinceLast <= cadence.days * 2 + cadence.tolerance;
      const freshness = clamp01(1 - Math.max(0, sinceLast - cadence.days) / (cadence.days * 3));

      // Garde-fou : la régularité n'est pas un simple poids, c'est la
      // définition même d'une récurrence. Sans elle, un marchand visité à
      // intervalles quelconques mais toujours pour le même montant passerait
      // pour un abonnement — porté par la seule stabilité des montants.
      if (regularity < MIN_REGULARITY) continue;

      const confidence = round3(
        0.40 * regularity + 0.25 * amountStability + 0.20 * volume + 0.15 * freshness);

      const first = sorted[0];
      found.push({
        signature: `${key}|${cadence.code}|${bucketOf(avgAmount)}`,
        merchant: key,
        label: prettyLabel(first),
        account_id: first.account_id,
        category_id: majority(sorted.map((t) => t.category_id)),
        kind: guessKind(sorted, avgAmount),
        cadence: cadence.code,
        cadence_days: cadence.days,
        average_amount: round2(avgAmount),
        last_amount: round2(Math.abs(sorted[sorted.length - 1].amount)),
        amount_variance: round2(amountSd),
        direction: sorted[0].amount >= 0 ? 'credit' : 'debit',
        occurrences: sorted.length,
        first_seen: isoDay(date(sorted[0])),
        last_seen: isoDay(last),
        next_expected: isActive ? isoDay(last + cadence.days * DAY) : null,
        confidence,
        is_active: isActive,
        transaction_ids: sorted.map((t) => t.id).filter(Boolean),
      });
    }
  }

  return found
    .filter((r) => r.confidence >= 0.45)
    .sort((a, b) => b.average_amount - a.average_amount);
}

/* — Utilitaires ————————————————————————————————————— */

const date = (tx) => new Date(tx.booked_at).getTime();
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function matchCadence(gapDays) {
  if (!Number.isFinite(gapDays)) return null;
  let best = null;
  for (const c of CADENCES) {
    const distance = Math.abs(gapDays - c.days);
    if (distance <= c.tolerance && (!best || distance < best.distance)) {
      best = { ...c, distance };
    }
  }
  return best;
}

/**
 * Sépare les montants d'ordres de grandeur différents : un abonnement à 11 €
 * et une commande à 240 € chez le même marchand ne sont pas la même série.
 */
function clusterByAmount(items) {
  if (items.length < 3) return [items];
  const sorted = items.slice().sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
  const clusters = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = Math.abs(sorted[i].amount);
    const previous = Math.abs(sorted[i - 1].amount);
    // Rupture quand le montant double par rapport au précédent.
    if (previous > 0 && current / previous > 2 && current - previous > 8) {
      clusters.push([]);
    }
    clusters[clusters.length - 1].push(sorted[i]);
  }
  return clusters;
}

function bucketOf(amount) {
  return Math.round(Math.log10(Math.max(amount, 1)) * 2);
}

function majority(values) {
  const counts = new Map();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = null;
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count };
  }
  return best?.value ?? null;
}

function guessKind(items, avgAmount) {
  const isCredit = items[0].amount >= 0;
  const label = (items[0].merchant || items[0].clean_label || '').toLowerCase();

  if (isCredit) return avgAmount > 800 ? 'salary' : 'transfer';
  if (/loyer|foncia|nexity|orpi|syndic|bail/.test(label)) return 'rent';
  if (/assurance|maaf|macif|axa|allianz|matmut|gmf/.test(label)) return 'insurance';
  if (/pret|credit|echeance|emprunt/.test(label)) return 'loan';
  if (avgAmount > 400) return 'rent';
  return 'subscription';
}

function prettyLabel(tx) {
  const source = tx.merchant || tx.clean_label || tx.raw_label || '';
  return source
    .split(/\s+/)
    .slice(0, 4)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ');
}

/**
 * Coût mensuel total des récurrences actives, ramené à une base mensuelle.
 * Sert à répondre à « combien me coûtent mes abonnements ? ».
 */
export function monthlyRecurringCost(recurrings) {
  const perMonth = { weekly: 30.44 / 7, biweekly: 30.44 / 14, monthly: 1,
    bimonthly: 0.5, quarterly: 1 / 3, yearly: 1 / 12, irregular: 0 };
  return (recurrings || [])
    .filter((r) => r.is_active && r.direction === 'debit')
    .reduce((total, r) => total + r.average_amount * (perMonth[r.cadence] ?? 0), 0);
}
