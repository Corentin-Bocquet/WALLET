/**
 * WALLET · Client Gemini
 *
 * Modèle : gemini-3.5-flash-lite, avec repli sur d'autres modèles. Palier gratuit, sans carte bancaire,
 * 1 500 requêtes par jour. Largement au-dessus de nos besoins : on classe
 * par MARCHAND et non par opération, ce qui divise le volume par quatre.
 *
 * La clé ne vit que dans les secrets Supabase. Elle n'atteint jamais le
 * navigateur : c'est la raison d'être de cette fonction côté serveur.
 */

/**
 * Modèles essayés dans l'ordre. Un nom de modèle se retire ou se renomme :
 * si le premier répond « introuvable » ou « surchargé », on passe au suivant
 * au lieu de laisser l'assistant en panne. GEMINI_MODEL (secret Supabase)
 * permet d'en imposer un en tête sans redéployer le code.
 */
const MODELS = [
  Deno.env.get('GEMINI_MODEL'),
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
].filter((m, i, all): m is string => Boolean(m) && all.indexOf(m) === i);

const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export class GeminiError extends Error {}

function apiKey(): string {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) {
    throw new GeminiError(
      'Aucune clé Gemini configurée. Définissez GEMINI_API_KEY dans les secrets Supabase.',
    );
  }
  return key;
}

interface AskOptions {
  system?: string;
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Un appel, une réponse texte. Renvoie null plutôt que de jeter sur un refus. */
export async function ask(prompt: string, options: AskOptions = {}): Promise<string | null> {
  const {
    system, json = false, temperature = 0, maxTokens = 4096, timeoutMs = 40000,
  } = options;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const key = apiKey();
  let lastError = 'Gemini injoignable.';

  for (const model of MODELS) {
    const response = await fetch(endpoint(model), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => null);

    // Réseau coupé ou délai dépassé : un autre modèle ne ferait pas mieux.
    if (!response) throw new GeminiError('Gemini injoignable.');

    // Clé refusée : inutile d'essayer les autres modèles.
    if (response.status === 401 || response.status === 403) {
      throw new GeminiError('Clé Gemini refusée. Vérifiez GEMINI_API_KEY dans les secrets Supabase.');
    }

    // Modèle inconnu, retiré, surchargé ou quota épuisé pour CE modèle : les
    // quotas gratuits sont comptés par modèle, le suivant a souvent de la marge.
    if ([404, 400, 429, 500, 503].includes(response.status)) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      lastError = response.status === 429
        ? 'Quota Gemini atteint pour aujourd’hui sur tous les modèles. Réessayez demain.'
        : `Gemini a répondu ${response.status} : ${detail}`;
      continue;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new GeminiError(`Gemini a répondu ${response.status} : ${detail}`);
    }

    const payload = await response.json();
    const parts = payload?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: { text?: string }) => p.text ?? '').join('').trim();
    if (text) return text;
    lastError = 'Réponse vide.';
  }

  // Tous les modèles ont répondu, mais sans texte (refus) : null, comme avant.
  if (lastError === 'Réponse vide.') return null;
  throw new GeminiError(lastError);
}

/** Même chose, mais on exige un objet JSON. */
export async function askJson<T = unknown>(
  prompt: string,
  options: Omit<AskOptions, 'json'> = {},
): Promise<T | null> {
  const text = await ask(prompt, { ...options, json: true });
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Certains modèles encadrent le JSON de balises : on récupère le bloc.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]) as T; } catch { return null; }
  }
}
