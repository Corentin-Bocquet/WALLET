/**
 * WALLET · Évaluation des alertes (§32)
 *
 * Tourne côté serveur, pour que les alertes fonctionnent application fermée.
 * Chaque alerte respecte son délai de répétition : être notifié dix fois pour
 * le même franchissement est le meilleur moyen de faire couper les
 * notifications.
 *
 * Les franchissements (`crosses_up` / `crosses_down`) comparent à la DERNIÈRE
 * valeur observée, stockée sur l'alerte : sans cette mémoire, une alerte
 * « franchit 60 000 € » se déclencherait à chaque passage tant que le prix
 * reste au-dessus.
 */

import {
  preflight, json, fail, serviceClient, requireUser,
} from '../_shared/http.ts';

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  const service = serviceClient();

  try {
    const url = new URL(request.url);
    const isCron = url.searchParams.get('cron') === '1'
      && request.headers.get('x-cron-secret') === Deno.env.get('CRON_SECRET');

    let query = service.from('alerts')
      .select('*, asset:assets(symbol, name)')
      .eq('is_active', true);

    if (!isCron) {
      const { user } = await requireUser(request);
      query = query.eq('user_id', user.id);
    }

    const { data: alerts } = await query;
    const fired = [];

    for (const alert of alerts ?? []) {
      // Délai de répétition : on ne réévalue même pas.
      if (alert.last_fired_at) {
        const elapsed = Date.now() - new Date(alert.last_fired_at).getTime();
        if (elapsed < (alert.cooldown_hours ?? 24) * 3600 * 1000) continue;
      }

      const observation = await observe(service, alert);
      if (observation === null) continue;

      const triggered = evaluate(alert, observation);

      // La valeur observée est mémorisée à chaque passage, déclenchement ou
      // non : c'est elle qui rend les franchissements détectables.
      await service.from('alerts')
        .update({
          last_value: observation,
          ...(triggered ? { last_fired_at: new Date().toISOString() } : {}),
        })
        .eq('id', alert.id);

      if (!triggered) continue;

      const event = buildEvent(alert, observation);
      await service.from('alert_events').insert({
        user_id: alert.user_id,
        alert_id: alert.id,
        ...event,
      });
      fired.push({ alert: alert.label, value: observation });
    }

    return json({ ok: true, evaluated: alerts?.length ?? 0, fired });
  } catch (error) {
    return fail(error);
  }
});

/** Valeur courante du sujet surveillé, ou null si elle n'est pas connue. */
async function observe(
  service: ReturnType<typeof serviceClient>,
  alert: Record<string, any>,
): Promise<number | null> {
  switch (alert.subject) {
    case 'price': {
      const { data } = await service.from('asset_quotes')
        .select('price').eq('asset_id', alert.asset_id).maybeSingle();
      return data?.price ? Number(data.price) : null;
    }
    case 'score': {
      const { data } = await service.from('investment_scores')
        .select('score').eq('user_id', alert.user_id).eq('asset_id', alert.asset_id)
        .order('day', { ascending: false }).limit(1).maybeSingle();
      return data?.score ? Number(data.score) : null;
    }
    case 'net_worth': {
      const { data } = await service.from('portfolio_snapshots')
        .select('total_value').eq('user_id', alert.user_id)
        .order('day', { ascending: false }).limit(1).maybeSingle();
      return data?.total_value ? Number(data.total_value) : null;
    }
    case 'category_spend': {
      const start = new Date();
      start.setUTCDate(1);
      const { data } = await service.from('bank_transactions')
        .select('amount').eq('user_id', alert.user_id)
        .eq('category_id', alert.category_id).eq('status', 'active')
        .gte('booked_at', start.toISOString().slice(0, 10));
      if (!data?.length) return 0;
      return Math.abs(data.reduce((sum, tx) => sum + Math.min(0, Number(tx.amount)), 0));
    }
    case 'savings_rate': {
      const { data } = await service.rpc('monthly_summary_for', { p_user: alert.user_id });
      const rate = data?.[0]?.savings_rate;
      return rate === null || rate === undefined ? null : Number(rate);
    }
    case 'anomaly': {
      const { count } = await service.from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', alert.user_id).eq('is_anomaly', true)
        .gte('booked_at', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
      return count ?? 0;
    }
    default:
      return null;
  }
}

function evaluate(alert: Record<string, any>, value: number): boolean {
  const threshold = alert.threshold === null ? null : Number(alert.threshold);
  const previous = alert.last_value === null ? null : Number(alert.last_value);

  switch (alert.operator) {
    case 'gte': return threshold !== null && value >= threshold;
    case 'lte': return threshold !== null && value <= threshold;
    case 'crosses_up':
      // Il faut une valeur précédente SOUS le seuil : sans elle, on ne peut
      // pas parler de franchissement, seulement de position.
      return threshold !== null && previous !== null && previous < threshold && value >= threshold;
    case 'crosses_down':
      return threshold !== null && previous !== null && previous > threshold && value <= threshold;
    case 'changes':
      return previous !== null && previous !== value;
    default:
      return false;
  }
}

function buildEvent(alert: Record<string, any>, value: number) {
  const symbol = alert.asset?.symbol ?? '';
  const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value);

  const titles: Record<string, string> = {
    price: `${symbol} à ${formatted} €`,
    score: `Score ${symbol} : ${formatted}/100`,
    zone: `${symbol} a changé de zone`,
    net_worth: `Patrimoine : ${formatted} €`,
    category_spend: `Budget : ${formatted} € dépensés`,
    savings_rate: `Taux d'épargne : ${formatted} %`,
    anomaly: `${formatted} dépense(s) inhabituelle(s) cette semaine`,
  };

  const severity = alert.subject === 'anomaly' ? 'warning'
    : alert.operator === 'lte' || alert.operator === 'crosses_down' ? 'info'
    : 'success';

  return {
    title: titles[alert.subject] ?? alert.label,
    body: `Votre alerte « ${alert.label} » s'est déclenchée.`,
    severity,
    value,
    payload: { subject: alert.subject, operator: alert.operator, threshold: alert.threshold },
  };
}
