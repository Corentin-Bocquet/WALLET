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

    const context = await buildContext(service, user.id);

    const answer = await ask(
      `Contexte chiffré (source unique de vérité) :\n${context.text}\n\n`
      + `Question : ${question}`,
      {
        system:
          'Tu es l\'assistant de WALLET, une application de patrimoine personnel. '
          + 'Tu réponds en français, en 4 phrases maximum, sur un ton direct et concret. '
          + 'RÈGLE ABSOLUE : tous les chiffres que tu cites doivent provenir du contexte '
          + 'fourni. Tu n\'inventes ni un montant, ni une date, ni une catégorie. Si le '
          + 'contexte ne permet pas de répondre, tu le dis en une phrase et tu indiques '
          + 'ce qu\'il faudrait importer ou connecter. Tu ne donnes jamais de conseil '
          + 'd\'investissement personnalisé : tu décris ce que montrent les chiffres.',
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

/** Agrégats seulement : jamais la liste des opérations. */
async function buildContext(service: ReturnType<typeof serviceClient>, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const evidence: Array<{ label: string; value: string }> = [];
  const lines: string[] = [`Date du jour : ${today}`];

  /* Patrimoine */
  const { data: snapshot } = await service.from('portfolio_snapshots')
    .select('day, total_value, crypto_value, cash_value, equity_value, is_partial')
    .eq('user_id', userId).order('day', { ascending: false }).limit(1).maybeSingle();

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
