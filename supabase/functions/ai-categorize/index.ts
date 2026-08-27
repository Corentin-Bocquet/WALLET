/**
 * WALLET · Catégorisation par IA (§15)
 *
 * Principe de frugalité : on ne classe pas 4 000 opérations, on classe les
 * MARCHANDS. « itm fouilloy » revient trente fois, il ne mérite qu'une seule
 * question. Le résultat est ensuite appliqué à toutes ses opérations.
 *
 * Et surtout : chaque réponse devient une RÈGLE et une entrée de MÉMOIRE.
 * L'application apprend une fois, puis n'a plus jamais besoin de l'IA pour ce
 * marchand — y compris sur les prochains imports. C'est ce qui rend la chose
 * gratuite dans la durée.
 */

import {
  preflight, json, fail, requireUser, serviceClient, HttpError,
} from '../_shared/http.ts';
import { askJson, GeminiError } from '../_shared/gemini.ts';

const MERCHANTS_PER_CALL = 80;
const MAX_CALLS_PER_RUN = 4;

Deno.serve(async (request) => {
  const early = preflight(request);
  if (early) return early;

  try {
    const { user } = await requireUser(request);
    const service = serviceClient();

    /* — Le référentiel de catégories de CET utilisateur ————— */
    const { data: categories } = await service.from('categories')
      .select('id, slug, label, kind').eq('user_id', user.id);

    if (!categories?.length) {
      throw new HttpError('Aucune catégorie. Initialisez vos préférences d’abord.', 400);
    }
    const idBySlug = new Map(categories.map((c) => [c.slug, c.id]));

    /* — Les marchands encore inconnus ————————————————— */
    const { data: pending } = await service.from('bank_transactions')
      .select('merchant, clean_label, amount')
      .eq('user_id', user.id).is('category_id', null)
      .limit(6000);

    const groups = new Map<string, { total: number; count: number }>();
    for (const row of pending ?? []) {
      const key = String(row.merchant || row.clean_label || '').trim().toLowerCase();
      if (!key) continue;
      const entry = groups.get(key) ?? { total: 0, count: 0 };
      entry.total += Number(row.amount) || 0;
      entry.count += 1;
      groups.set(key, entry);
    }

    const merchants = [...groups.entries()];
    if (!merchants.length) {
      return json({ ok: true, done: true, classified: 0, remaining: 0, rules: 0 });
    }

    const slate = merchants.slice(0, MERCHANTS_PER_CALL * MAX_CALLS_PER_RUN);
    const catalogue = categories
      .map((c) => `${c.slug} = ${c.label} (${c.kind})`).join('\n');

    let classified = 0;
    let rules = 0;
    const unresolved: string[] = [];

    for (let i = 0; i < slate.length; i += MERCHANTS_PER_CALL) {
      const batch = slate.slice(i, i + MERCHANTS_PER_CALL);

      const listing = batch.map(([name, stats]) => {
        const average = stats.total / stats.count;
        const sign = average < 0 ? 'dépense' : 'revenu';
        return `- "${name}" (${sign}, ${stats.count} fois, moyenne ${average.toFixed(2)} EUR)`;
      }).join('\n');

      const answer = await askJson<Record<string, string>>(
        `Catégories disponibles :\n${catalogue}\n\n`
        + `Marchands à classer :\n${listing}\n\n`
        + `Réponds par un objet JSON {"nom du marchand": "slug"} contenant CHAQUE `
        + `marchand de la liste, avec exactement son nom d'origine comme clé.`,
        {
          system:
            'Tu classes des opérations bancaires françaises. Tu réponds UNIQUEMENT '
            + 'par du JSON. Tu utilises exclusivement les slugs fournis. '
            + 'Un virement entre comptes personnels est "transfert". Un achat de '
            + 'cryptomonnaie ou de titres est "investissement". En cas de doute '
            + 'réel, utilise "autres" pour une dépense et "revenus" pour un '
            + 'encaissement : une catégorie inventée serait pire qu\'un doute assumé.',
          maxTokens: 8192,
        },
      );

      if (!answer) { batch.forEach(([name]) => unresolved.push(name)); continue; }

      for (const [name, stats] of batch) {
        const slug = String(answer[name] ?? '').trim();
        const categoryId = idBySlug.get(slug);
        if (!categoryId) { unresolved.push(name); continue; }

        // 1. La règle : l'application saura le refaire seule la prochaine fois.
        const { error: ruleError } = await service.from('category_rules').upsert({
          user_id: user.id,
          category_id: categoryId,
          match_type: 'equals',
          pattern: name,
          priority: 40,
          is_active: true,
          hit_count: stats.count,
          last_hit_at: new Date().toISOString(),
        }, { onConflict: 'user_id,match_type,pattern', ignoreDuplicates: false });
        if (!ruleError) rules += 1;

        // 2. La mémoire : elle sert aussi aux libellés approchants.
        await service.from('category_memory').upsert({
          user_id: user.id,
          key_type: 'merchant',
          key_value: name,
          amount_bucket: 'all',
          category_id: categoryId,
          hits: stats.count,
          last_seen_at: new Date().toISOString(),
        }, { onConflict: 'user_id,key_type,key_value,amount_bucket,category_id' });

        // 3. Les opérations déjà en base.
        const { data: updated } = await service.from('bank_transactions')
          .update({
            category_id: categoryId,
            category_source: 'model',
            category_confidence: 0.85,
            category_reason: { engine: 'gemini', merchant: name },
          })
          .eq('user_id', user.id).is('category_id', null)
          .or(`merchant.ilike.${name},clean_label.ilike.${name}`)
          .select('id');

        classified += updated?.length ?? 0;
      }
    }

    const remaining = Math.max(0, merchants.length - slate.length);

    return json({
      ok: true,
      done: remaining === 0,
      merchants_seen: slate.length,
      classified,
      rules,
      remaining,
      unresolved: unresolved.slice(0, 20),
    });
  } catch (error) {
    if (error instanceof GeminiError) {
      return json({ ok: false, message: error.message }, 503);
    }
    return fail(error);
  }
});
