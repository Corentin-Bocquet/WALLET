/**
 * WALLET · Détection des dépenses inhabituelles (§20)
 *
 * On compare chaque dépense aux VOTRES, dans la même catégorie, sur une
 * fenêtre glissante. Méthode robuste médiane/MAD : contrairement à l'écart-type,
 * elle ne se laisse pas gonfler par les valeurs extrêmes qu'on cherche à
 * détecter.
 *
 * Deux garde-fous délibérés :
 *   · minimum 8 observations, sinon aucune détection n'est tentée — signaler
 *     une anomalie sur 3 points est du bruit, pas de l'information ;
 *   · les récurrences connues sont exclues : un loyer n'est pas une anomalie.
 */

import { median, mad, stdev } from './stats.js';

const DAY = 86400000;

export function detectAnomalies(transactions, {
  windowDays = 183,
  threshold = 3.5,
  minSamples = 8,
  now = Date.now(),
} = {}) {
  const byCategory = new Map();

  for (const tx of transactions || []) {
    if (tx.status && tx.status !== 'active') continue;
    if (tx.amount >= 0) continue;                       // dépenses seulement
    if (tx.recurring_id) continue;                       // un loyer n'est pas une surprise
    const key = tx.category_id || 'uncategorized';
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(tx);
  }

  const anomalies = [];

  for (const [categoryId, items] of byCategory) {
    const recent = items.filter((t) => now - new Date(t.booked_at).getTime() <= windowDays * DAY);
    if (recent.length < minSamples) continue;

    const amounts = recent.map((t) => Math.abs(t.amount));
    const m = median(amounts);
    const deviation = mad(amounts);
    const scale = deviation && deviation > 1e-9 ? deviation / 0.6745 : stdev(amounts);
    if (!scale || scale < 1e-9) continue;

    for (const tx of recent) {
      const amount = Math.abs(tx.amount);
      const score = (amount - m) / scale;
      if (score < threshold) continue;

      // Un écart relatif trop faible n'intéresse personne, même statistiquement
      // significatif : 4,20 € au lieu de 3,80 € n'est pas une nouvelle.
      if (amount < m * 1.8 || amount - m < 15) continue;

      anomalies.push({
        transaction_id: tx.id,
        category_id: categoryId === 'uncategorized' ? null : categoryId,
        amount,
        median: round2(m),
        score: round2(score),
        ratio: round2(amount / m),
        booked_at: tx.booked_at,
        label: tx.merchant || tx.clean_label || tx.raw_label,
        explanation: `${fmt(amount)} alors que votre habitude dans cette catégorie tourne autour de ${fmt(m)}.`,
        sample_size: recent.length,
      });
    }
  }

  return anomalies.sort((a, b) => b.score - a.score);
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
