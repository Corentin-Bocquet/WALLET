/**
 * WALLET · Assistant (§33)
 *
 * Le moteur local répond déjà aux questions cadrées (« combien j'ai dépensé
 * en restaurants »). Cette fonction prend le relais pour tout le reste.
 *
 * Deux règles non négociables :
 *   · le modèle ne reçoit QUE des agrégats, jamais la liste des opérations.
 *     Il n'a pas besoin de savoir où l'utilisateur a déjeuné mardi ;
 *   · le modèle n'a pas le droit d'inventer un chiffre. Les nombres viennent
 *     du contexte fourni, et la réponse cite ce sur quoi elle s'appuie.
 */

import {
  preflight, json, fail, requireUser, serviceClient, HttpError,
} from '../_shared/http.ts';
import { ask, GeminiError } from '../_shared/gemini.ts';

const MAX_QUESTION = 500;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const { user } = await requireUser(request);
    const service = serviceClient();
    const body = await request.json().catch(() => ({}));

    const question = String(body.question ?? '').trim().slice(0, MAX_QUESTION);
    if (!question) throw new HttpError('Question vide.', 400);

    const context = await buildContext(service, user.id, sanitizeClientContext(body.context));
    const history = sanitizeHistory(body.history);

    const answer = await ask(
      `Contexte chiffré (source unique de vérité) :\n${context.text}\n\n`
      + (history ? `Échanges précédents de cette conversation (du plus ancien au plus récent) :\n${history}\n\n` : '')
      + `Nouvelle question : ${question}`,
      {
        system:
          'Tu es l\'assistant de WALLET, une application de patrimoine personnel. '
          + 'Tu réponds en français, en 4 phrases maximum, sur un ton direct et concret. '
          + 'RÈGLE ABSOLUE : tous les chiffres que tu cites doivent provenir du contexte '
          + 'fourni. Tu n\'inventes ni un montant, ni une date, ni une catégorie. Si le '
          + 'contexte ne permet pas de répondre, tu le dis en une phrase et tu indiques '
          + 'ce qu\'il faudrait importer ou connecter. Tu ne donnes jamais de conseil '
          + 'd\'investissement personnalisé : tu décris ce que montrent les chiffres. '
          + 'La question peut être une relance de l\'échange précédent (« et en dollars ? », '
          + '« et le mois dernier ? ») : réponds-y dans ce contexte. Pour convertir une '
          + 'devise, utilise les taux fournis et indique le taux employé.',
        maxTokens: 800,
        temperature: 0.2,
      },
    );

    if (!answer) throw new GeminiError('Réponse vide.');

    // Trace : utile pour revoir un échange, et pour mesurer ce qui est demandé.
    await service.from('assistant_messages').insert([
      { user_id: user.id, role: 'user', content: question, intent: 'llm', engine: 'gemini' },
      {
        user_id: user.id, role: 'assistant', content: answer,
        intent: 'llm', engine: 'gemini', evidence: context.evidence,
      },
    ]);

    return json({ ok: true, answer, evidence: context.evidence });
  } catch (error) {
    if (error instanceof GeminiError) {
      return json({ ok: false, message: error.message }, 503);
    }
    return fail(error);
  }
});

type ClientContext = Record<string, number | null | Record<string, number>>;

/** Les totaux envoyés par l'application : des nombres, rien d'autre. */
function sanitizeClientContext(raw: unknown): ClientContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: ClientContext = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key.slice(0, 40)] = value;
    else if (value && typeof value === 'object') {
      const nested: Record<string, number> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
        if (typeof v === 'number' && Number.isFinite(v)) nested[k.slice(0, 12)] = v;
      }
      out[key.slice(0, 40)] = nested;
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Les derniers échanges, bornés en nombre et en longueur. */
function sanitizeHistory(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  return raw.slice(-8)
    .filter((m) => m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string')
    .map((m) => {
      const { role, content } = m as { role?: string; content: string };
      return `${role === 'assistant' ? 'Assistant' : 'Utilisateur'} : ${content.slice(0, 600)}`;
    })
    .join('\n');
}

/** Agrégats seulement : jamais la liste des opérations. */
async function buildContext(
  service: ReturnType<typeof serviceClient>, userId: string, client: ClientContext | null,
) {
  const today = new Date().toISOString().slice(0, 10);
  const evidence: Array<{ label: string; value: string }> = [];
  const lines: string[] = [`Date du jour : ${today}`];

  // Les totaux calculés par l'application : ce sont les chiffres affichés à
  // l'écran, toujours présents même si aucun instantané quotidien n'existe.
  if (client) {
    lines.push(`Totaux affichés dans l'application (EUR) : ${JSON.stringify(client)}`);
    if (typeof client.net_worth === 'number') {
      evidence.push({ label: 'Patrimoine total', value: `${client.net_worth} EUR` });
    }
  }

  /* Taux de change (base EUR) */
  const { data: fx } = await service.from('fx_rates')
    .select('quote, rate, day').eq('base', 'EUR').order('day', { ascending: false }).limit(20);
  const rates = new Map<string, number>();
  for (const r of fx ?? []) if (!rates.has(r.quote)) rates.set(r.quote, Number(r.rate));
  if (rates.size) {
    lines.push('Taux de change depuis l\'euro : ' + [...rates.entries()].map(([q, r]) => `1 EUR = ${r} ${q}`).join(' · '));
  }

  /* Patrimoine */
  const { data: snapshot } = await service.from('portfolio_snapshots')
    .select('day, total_value, crypto_value, cash_value, equity_value, is_partial')
    .eq('user_id', userId).order('day', { ascending: false }).limit(1).maybeSingle();

  if (!snapshot && !client) {
    // Aucun instantané ni total fourni : on valorise les positions en direct.
    const { data: live } = await service.from('holdings')
      .select('quantity, asset_id, assets(symbol)').eq('user_id', userId).gt('quantity', 0);
    const ids = [...new Set((live ?? []).map((h) => h.asset_id))];
    const { data: quotes } = ids.length
      ? await service.from('asset_quotes').select('asset_id, price').in('asset_id', ids)
      : { data: [] };
    const price = new Map((quotes ?? []).map((q: { asset_id: string; price: number }) => [q.asset_id, Number(q.price)]));
    const total = (live ?? []).reduce((sum: number, h: { quantity: unknown; asset_id: string }) =>
      sum + (Number(h.quantity) || 0) * Number(price.get(h.asset_id) ?? 0), 0);
    if (total > 0) lines.push(`Valeur actuelle des positions crypto : ${Math.round(total)} EUR`);
  }

  if (snapshot) {
    lines.push(
      `Patrimoine au ${snapshot.day} : ${snapshot.total_value} EUR `
      + `(crypto ${snapshot.crypto_value}, liquidités ${snapshot.cash_value}, `
      + `actions ${snapshot.equity_value})${snapshot.is_partial ? ' [partiel]' : ''}`,
    );
    evidence.push({ label: 'Patrimoine total', value: `${snapshot.total_value} EUR` });
  }

  /* Comptes */
  const { data: accounts } = await service.from('accounts')
    .select('label, kind, balance, currency').eq('user_id', userId).eq('is_active', true);
  if (accounts?.length) {
    lines.push('Comptes : ' + accounts
      .map((a) => `${a.label} (${a.kind}) ${a.balance ?? 'solde inconnu'} ${a.currency}`)
      .join(' · '));
  }

  /* Positions */
  const { data: holdings } = await service.from('holdings')
    .select('quantity, assets(symbol)').eq('user_id', userId).gt('quantity', 0);
  if (holdings?.length) {
    lines.push('Positions : ' + holdings
      .map((h: any) => `${h.assets?.symbol ?? '?'} ${h.quantity}`).join(' · '));
  }

  /* Couverture des données bancaires */
  const { data: bounds } = await service.from('bank_transactions')
    .select('booked_at').eq('user_id', userId)
    .order('booked_at', { ascending: false }).limit(1).maybeSingle();
  if (bounds) {
    lines.push(`Dernière opération bancaire connue : ${bounds.booked_at}`);
    evidence.push({ label: 'Dernier relevé', value: String(bounds.booked_at) });
  }

  /* Dépenses par catégorie sur 12 mois */
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const { data: rows } = await service.from('bank_transactions')
    .select('amount, categories(label)')
    .eq('user_id', userId).lt('amount', 0).gte('booked_at', since).limit(6000);

  const byCategory = new Map<string, { total: number; count: number }>();
  for (const row of rows ?? []) {
    const label = (row as any).categories?.label ?? 'Non classé';
    const entry = byCategory.get(label) ?? { total: 0, count: 0 };
    entry.total += Number(row.amount) || 0;
    entry.count += 1;
    byCategory.set(label, entry);
  }
  const ranked = [...byCategory.entries()].sort((a, b) => a[1].total - b[1].total).slice(0, 15);
  if (ranked.length) {
    lines.push('Dépenses par catégorie sur 12 mois : ' + ranked
      .map(([label, s]) => `${label} ${Math.round(s.total)} EUR (${s.count} op.)`).join(' · '));
    evidence.push({ label: 'Premier poste (12 mois)', value: `${ranked[0][0]} ${Math.round(ranked[0][1].total)} EUR` });
  }

  return { text: lines.join('\n'), evidence };
}
