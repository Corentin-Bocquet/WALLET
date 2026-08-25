/**
 * WALLET · Utilitaires HTTP partagés
 *
 * CORS, réponses JSON, authentification, et surtout : un limiteur de débit
 * et un cache qui protègent les quotas gratuits (§50). Une API gratuite
 * dépassée ne doit jamais mener à une offre payante — elle mène à un cache
 * plus long et à une fréquence réduite.
 */

import { createClient, SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function preflight(request: Request) {
  return request.method === 'OPTIONS' ? new Response('ok', { headers: CORS }) : null;
}

/**
 * Erreur utilisateur.
 * `expose` distingue ce qu'on peut montrer de ce qui doit rester au serveur :
 * un message d'API d'exchange peut contenir des détails à ne pas divulguer.
 */
export class HttpError extends Error {
  status: number;
  expose: boolean;
  constructor(message: string, status = 400, expose = true) {
    super(message);
    this.status = status;
    this.expose = expose;
  }
}

export function fail(error: unknown) {
  if (error instanceof HttpError) {
    console.error('[wallet]', error.status, error.message);
    return json({ error: error.expose ? error.message : 'Opération impossible.' }, error.status);
  }
  console.error('[wallet] erreur inattendue', error);
  return json({ error: 'Erreur interne.' }, 500);
}

/** Client agissant AU NOM de l'utilisateur : la RLS s'applique. */
export function userClient(request: Request): SupabaseClient {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization) throw new HttpError('Authentification requise.', 401);

  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
  );
}

/**
 * Client de service : contourne la RLS.
 * À n'utiliser que pour le référentiel de marché (partagé, non personnel) ou
 * après avoir vérifié l'identité et filtré explicitement sur user_id.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

export async function requireUser(request: Request) {
  const client = userClient(request);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new HttpError('Session invalide.', 401);
  return { client, user: data.user };
}

/* ------------------------------------------------------------------ */
/* Fraîcheur et limitation de débit                                    */
/* ------------------------------------------------------------------ */

/**
 * Empêche de rappeler une API avant l'expiration de son délai.
 * L'état vit dans `sync_state`, donc partagé entre toutes les instances de
 * la fonction — un simple compteur en mémoire ne tiendrait pas, les Edge
 * Functions étant recréées à chaque démarrage à froid.
 */
export async function claimSlot(
  service: SupabaseClient,
  scope: string,
  userId: string | null,
  minIntervalSeconds: number,
): Promise<{ allowed: boolean; state: Record<string, unknown> | null; retryAfter: number }> {
  const query = service.from('sync_state').select('*').eq('scope', scope);
  const { data: existing } = userId
    ? await query.eq('user_id', userId).maybeSingle()
    : await query.is('user_id', null).maybeSingle();

  const now = Date.now();
  if (existing?.next_allowed && new Date(existing.next_allowed).getTime() > now) {
    return {
      allowed: false,
      state: existing,
      retryAfter: Math.ceil((new Date(existing.next_allowed).getTime() - now) / 1000),
    };
  }

  await service.from('sync_state').upsert({
    ...(existing?.id ? { id: existing.id } : {}),
    user_id: userId,
    scope,
    status: 'running',
    last_attempt: new Date().toISOString(),
    next_allowed: new Date(now + minIntervalSeconds * 1000).toISOString(),
  }, { onConflict: 'user_id,scope' });

  return { allowed: true, state: existing ?? null, retryAfter: 0 };
}

export async function finishSlot(
  service: SupabaseClient,
  scope: string,
  userId: string | null,
  outcome: { status: 'ok' | 'error' | 'rate_limited'; message?: string; items?: number },
) {
  const patch: Record<string, unknown> = {
    user_id: userId,
    scope,
    status: outcome.status,
    message: outcome.message ?? null,
    items: outcome.items ?? null,
  };
  if (outcome.status === 'ok') patch.last_success = new Date().toISOString();

  // Un échec ne doit pas condamner la source jusqu'au prochain créneau
  // complet : on autorise un nouvel essai plus tôt.
  if (outcome.status === 'error') {
    patch.next_allowed = new Date(Date.now() + 60_000).toISOString();
  }

  await service.from('sync_state').upsert(patch, { onConflict: 'user_id,scope' });
}

/**
 * Requête HTTP avec délai maximal et réessais sur erreur transitoire.
 * Le repli exponentiel évite d'aggraver un rate-limit en insistant.
 */
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  { retries = 2, timeoutMs = 12_000, label = 'API' } = {},
): Promise<unknown> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? 0);
        throw new HttpError(
          `${label} : quota atteint. Réessayez dans ${retryAfter || 60} secondes.`,
          429,
        );
      }
      if (!response.ok) {
        const body = await response.text();
        throw new HttpError(`${label} a répondu ${response.status} : ${body.slice(0, 200)}`,
          502, false);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      // Un quota atteint ne se résout pas en réessayant tout de suite.
      if (error instanceof HttpError && error.status === 429) throw error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof HttpError
    ? lastError
    : new HttpError(`${label} injoignable.`, 503);
}

export const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};
