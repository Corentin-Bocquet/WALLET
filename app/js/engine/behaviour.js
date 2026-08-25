/**
 * WALLET · Analyse du comportement d'investissement (§31)
 *
 * Volontairement DESCRIPTIF, jamais prescriptif. On rapporte ce qui s'est
 * passé ; on ne dit pas quoi faire, et on ne félicite ni ne réprimande.
 * Chaque observation porte le nombre d'achats sur lequel elle repose : trois
 * achats ne font pas un profil d'investisseur, et l'interface le dit.
 */

import { median, mean } from './stats.js';

const DAY = 86400000;
const MIN_TRADES = 5;

/**
 * @param {Array} trades   investment_transactions (side 'buy'), avec executed_at et price
 * @param {Array} history  série quotidienne de l'actif
 */
export function analyseBehaviour(trades, history, { asOf = Date.now() } = {}) {
  const buys = (trades || [])
    .filter((t) => t.side === 'buy' && Number.isFinite(Number(t.price)))
    .map((t) => ({ ...t, t: new Date(t.executed_at).getTime(), price: Number(t.price) }))
    .filter((t) => t.t <= asOf)
    .sort((a, b) => a.t - b.t);

  if (buys.length < MIN_TRADES) {
    return {
      available: false,
      reason: `Il faut au moins ${MIN_TRADES} achats pour dire quoi que ce soit d'utile. Vous en avez ${buys.length}.`,
      trades: buys.length,
    };
  }

  const series = (history || [])
    .map((p) => ({ t: new Date(p.day).getTime(), close: Number(p.close) }))
    .filter((p) => Number.isFinite(p.close))
    .sort((a, b) => a.t - b.t);

  const observations = [];

  /* — 1. Achetez-vous après des hausses ? ————————————— */
  const priorMoves = buys.map((b) => trailingReturn(series, b.t, 30)).filter(Number.isFinite);
  if (priorMoves.length >= MIN_TRADES) {
    const medianMove = median(priorMoves);
    const afterRally = priorMoves.filter((m) => m > 15).length;
    const afterDip = priorMoves.filter((m) => m < -15).length;

    if (afterRally / priorMoves.length > 0.4) {
      observations.push({
        code: 'buys_after_rally',
        title: 'Vos achats suivent souvent une hausse',
        body: `${afterRally} de vos ${priorMoves.length} achats sont intervenus après une progression de plus de 15 % sur le mois précédent.`,
        evidence: { after_rally: afterRally, total: priorMoves.length, median_prior_30d: round2(medianMove) },
        severity: 'info',
      });
    }
    if (afterDip / priorMoves.length > 0.4) {
      observations.push({
        code: 'buys_after_dip',
        title: 'Vos achats suivent souvent une baisse',
        body: `${afterDip} de vos ${priorMoves.length} achats sont intervenus après un repli de plus de 15 % sur le mois précédent.`,
        evidence: { after_dip: afterDip, total: priorMoves.length, median_prior_30d: round2(medianMove) },
        severity: 'info',
      });
    }
  }

  /* — 2. Vos meilleurs achats, à quel moment ? ————————— */
  const withOutcome = buys
    .map((b) => ({ ...b, drawdownAtBuy: drawdownAt(series, b.t), outcome: outcomeSince(series, b.t, b.price) }))
    .filter((b) => Number.isFinite(b.outcome) && Number.isFinite(b.drawdownAtBuy));

  if (withOutcome.length >= MIN_TRADES) {
    const best = withOutcome.slice().sort((a, b) => b.outcome - a.outcome).slice(0, Math.max(2, Math.ceil(withOutcome.length / 3)));
    const bestDd = median(best.map((b) => b.drawdownAtBuy));
    const allDd = median(withOutcome.map((b) => b.drawdownAtBuy));

    if (Number.isFinite(bestDd) && Number.isFinite(allDd) && bestDd < allDd - 8) {
      observations.push({
        code: 'best_buys_in_drawdown',
        title: 'Vos meilleurs achats ont eu lieu dans les creux',
        body: `Vos ${best.length} achats les plus performants ont été faits alors que le prix était à ${Math.round(bestDd)} % sous son sommet, contre ${Math.round(allDd)} % en moyenne pour l'ensemble.`,
        evidence: { best_median_drawdown: round2(bestDd), overall_median_drawdown: round2(allDd), sample: withOutcome.length },
        severity: 'success',
      });
    }
  }

  /* — 3. Régularité ————————————————————————————————— */
  const gaps = [];
  for (let i = 1; i < buys.length; i += 1) gaps.push((buys[i].t - buys[i - 1].t) / DAY);
  if (gaps.length >= 3) {
    const m = median(gaps);
    const spread = mean(gaps.map((g) => Math.abs(g - m)));
    const regular = spread / Math.max(m, 1) < 0.35;
    observations.push({
      code: regular ? 'regular_cadence' : 'irregular_cadence',
      title: regular ? 'Vos achats sont réguliers' : 'Vos achats sont irréguliers',
      body: regular
        ? `Vous achetez environ tous les ${Math.round(m)} jours, avec peu d'écart.`
        : `L'écart entre deux achats varie beaucoup autour de ${Math.round(m)} jours.`,
      evidence: { median_gap_days: Math.round(m), mean_deviation_days: round2(spread), trades: buys.length },
      severity: 'info',
    });
  }

  /* — 4. Concentration temporelle ————————————————————— */
  const byMonth = new Map();
  for (const b of buys) {
    const key = new Date(b.t).toISOString().slice(0, 7);
    byMonth.set(key, (byMonth.get(key) || 0) + b.price * Number(b.quantity || 0));
  }
  const monthly = [...byMonth.values()];
  const total = monthly.reduce((a, v) => a + v, 0);
  const biggest = Math.max(...monthly);
  if (total > 0 && biggest / total > 0.5 && monthly.length >= 4) {
    observations.push({
      code: 'concentrated_entry',
      title: 'Une grande partie de vos achats tient à un seul mois',
      body: `${Math.round((biggest / total) * 100)} % du montant investi l'a été sur un seul mois. Votre prix de revient dépend donc beaucoup de ce moment-là.`,
      evidence: { share_pct: round2((biggest / total) * 100), months: monthly.length },
      severity: 'warning',
    });
  }

  return {
    available: true,
    trades: buys.length,
    observations,
    disclaimer: 'Ces observations décrivent ce que montrent vos données passées. Elles ne sont ni un conseil ni une prévision.',
  };
}

/* — Internes ————————————————————————————————————————— */

function priceAt(series, t) {
  if (!series.length) return null;
  let lo = 0, hi = series.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) { best = series[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best?.close ?? null;
}

function trailingReturn(series, t, days) {
  const now = priceAt(series, t);
  const before = priceAt(series, t - days * DAY);
  if (!now || !before) return NaN;
  return (now / before - 1) * 100;
}

function drawdownAt(series, t) {
  const upTo = series.filter((p) => p.t <= t);
  if (!upTo.length) return NaN;
  const peak = Math.max(...upTo.map((p) => p.close));
  const now = upTo[upTo.length - 1].close;
  return (now / peak - 1) * 100;
}

function outcomeSince(series, t, buyPrice) {
  const last = series[series.length - 1];
  if (!last || !buyPrice) return NaN;
  return (last.close / buyPrice - 1) * 100;
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
