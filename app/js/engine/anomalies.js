/**
 * WALLET · Détection des dépenses inhabituelles (§20)
 *
 * La bonne question n'est pas « cette dépense est-elle grosse ? » mais
 * « cette dépense est-elle inhabituelle POUR CE MARCHAND ? ».
 *
 * La comparaison se fait donc en deux temps :
 *   1. contre l'historique du marchand lui-même, dès qu'il y a assez de passages ;
 *   2. à défaut seulement, contre la catégorie entière.
 *
 * Cette hiérarchie n'est pas cosmétique. Comparer un plein de courses à
 * 90 € à la médiane de la catégorie « alimentation » — tirée vers 10 € par
 * les passages quotidiens à la boulangerie — signale une anomalie chaque
 * semaine. Comparé aux autres pleins de courses, il est parfaitement normal.
 * Une catégorie mélange souvent plusieurs habitudes ; un marchand, presque
 * jamais.
 *
 * Deux garde-fous supplémentaires :
 *   · minimum 8 observations, sinon aucune détection n'est tentée — signaler
 *     une anomalie sur 3 points est du bruit, pas de l'information ;
 *   · les récurrences connues sont exclues : un loyer n'est pas une surprise.
 */

import { median, mad, stdev } from './stats.js';

const DAY = 86400000;

export function detectAnomalies(transactions, {
  windowDays = 183,
  threshold = 3.5,
  minSamples = 8,
  now = Date.now(),
} = {}) {
  const eligible = (transactions || []).filter((tx) => {
    if (tx.status && tx.status !== 'active') return false;
    if (tx.amount >= 0) return false;                    // dépenses seulement
    if (tx.recurring_id) return false;                   // un loyer n'est pas une surprise
    return now - new Date(tx.booked_at).getTime() <= windowDays * DAY;
  });

  const byMerchant = groupBy(eligible, (tx) =>
    (tx.merchant || tx.clean_label || '').trim() || null);
  const byCategory = groupBy(eligible, (tx) => tx.category_id || 'uncategorized');

  const anomalies = [];

  for (const tx of eligible) {
    const merchantKey = (tx.merchant || tx.clean_label || '').trim();
    const merchantPeers = merchantKey ? byMerchant.get(merchantKey) : null;

    // 1. Le marchand lui-même, s'il a assez d'historique.
    let peers = merchantPeers;
    let basis = 'merchant';
    let basisLabel = `vos autres « ${merchantKey} »`;

    // 2. Sinon la catégorie — mais alors on exige un écart plus net, parce
    //    qu'une catégorie mélange des habitudes de tailles différentes.
    let localThreshold = threshold;
    if (!peers || peers.length < minSamples) {
      peers = byCategory.get(tx.category_id || 'uncategorized');
      basis = 'category';
      basisLabel = 'votre habitude dans cette catégorie';
      localThreshold = threshold * 1.4;
    }

    if (!peers || peers.length < minSamples) continue;

    const amounts = peers.map((t) => Math.abs(t.amount));
    const m = median(amounts);
    const deviation = mad(amounts);
    const scale = deviation && deviation > 1e-9 ? deviation / 0.6745 : stdev(amounts);
    if (!scale || scale < 1e-9 || !m) continue;

    const amount = Math.abs(tx.amount);
    const score = (amount - m) / scale;
    if (score < localThreshold) continue;

    // Un écart relatif trop faible n'intéresse personne, même statistiquement
    // significatif : 4,20 € au lieu de 3,80 € n'est pas une nouvelle.
    if (amount < m * 1.8 || amount - m < 15) continue;

    anomalies.push({
      transaction_id: tx.id,
      category_id: tx.category_id || null,
      amount,
      median: round2(m),
      score: round2(score),
      ratio: round2(amount / m),
      booked_at: tx.booked_at,
      label: merchantKey || tx.raw_label,
      basis,
      explanation: `${fmt(amount)} alors que ${basisLabel} tourne autour de ${fmt(m)}.`,
      sample_size: peers.length,
    });
  }

  return anomalies.sort((a, b) => b.score - a.score);
}

function groupBy(items, keyOf) {
  const map = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null || key === undefined) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => `${n.toFixed(2).replace('.', ',')} €`;

/**
 * Alerte de dérive budgétaire : la catégorie dépasse-t-elle nettement sa propre
 * moyenne des mois précédents ? Comparaison au prorata du mois écoulé, sinon
 * on crierait au loup tous les 2 du mois.
 */
export function detectBudgetDrift(currentByCategory, historyByCategory, {
  dayOfMonth = new Date().getDate(),
  daysInMonth = 30,
  tolerance = 1.25,
} = {}) {
  const drifts = [];
  const elapsed = Math.max(0.1, dayOfMonth / daysInMonth);

  for (const [categoryId, spent] of Object.entries(currentByCategory || {})) {
    const history = historyByCategory?.[categoryId];
    if (!Array.isArray(history) || history.length < 3) continue;

    const typical = median(history);
    if (!typical || typical < 20) continue;

    const projected = spent / elapsed;
    if (projected > typical * tolerance) {
      drifts.push({
        category_id: categoryId,
        spent: round2(spent),
        typical: round2(typical),
        projected: round2(projected),
        overshoot_pct: round2((projected / typical - 1) * 100),
      });
    }
  }

  return drifts.sort((a, b) => b.overshoot_pct - a.overshoot_pct);
}
