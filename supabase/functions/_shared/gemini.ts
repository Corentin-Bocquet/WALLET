/**
 * WALLET · Client Gemini
 *
 * Modèle : gemini-3.5-flash-lite. Palier gratuit, sans carte bancaire,
 * 1 500 requêtes par jour. Largement au-dessus de nos besoins : on classe
 * par MARCHAND et non par opération, ce qui divise le volume par quatre.
 *
 * La clé ne vit que dans les secrets Supabase. Elle n'atteint jamais le
 * navigateur : c'est la raison d'être de cette fonction côté serveur.
 */

const MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

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

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (!response) throw new GeminiError('Gemini injoignable.');

  if (response.status === 429) {
    throw new GeminiError('Quota Gemini atteint pour aujourd’hui. Réessayez demain.');
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new GeminiError(`Gemini a répondu ${response.status} : ${detail}`);
  }

  const payload = await response.json();
  const parts = payload?.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p: { text?: string }) => p.text ?? '').join('').trim();
  return text || null;
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
