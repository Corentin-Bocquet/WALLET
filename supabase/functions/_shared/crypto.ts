/**
 * WALLET · Chiffrement des identifiants d'exchange
 *
 * AES-256-GCM, clé dérivée par HKDF-SHA256 d'un secret qui ne vit QUE dans
 * les secrets Supabase (`CREDENTIALS_KEY`). La clé n'est jamais écrite en
 * base, jamais envoyée au navigateur, jamais journalisée.
 *
 * Le sel de dérivation inclut l'identifiant de l'utilisateur : deux comptes
 * ayant la même clé API produisent des chiffrés différents, et une fuite de
 * la base seule ne permet pas de déchiffrer sans le secret.
 *
 * `key_version` en base prépare la rotation : on pourra déchiffrer avec
 * l'ancienne clé et rechiffrer avec la nouvelle sans migration bloquante.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Uint8Array explicitement adossé à un ArrayBuffer (et non à un
 * SharedArrayBuffer). WebCrypto n'accepte que celui-là comme BufferSource ;
 * sans cette précision, chaque appel à crypto.subtle est refusé au typage.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/** Encode une chaîne en octets utilisables par WebCrypto. */
export const bytesOf = (text: string): Bytes => encoder.encode(text) as Bytes;

export const KEY_VERSION = 1;

function masterSecret(): string {
  const secret = Deno.env.get('CREDENTIALS_KEY');
  if (!secret || secret.length < 32) {
    throw new Error(
      'CREDENTIALS_KEY manquant ou trop court (32 caractères minimum). '
      + 'Définissez-le avec : supabase secrets set CREDENTIALS_KEY=…',
    );
  }
  return secret;
}

async function deriveKey(userId: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', bytesOf(masterSecret()), 'HKDF', false, ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: bytesOf(`wallet:credentials:v${KEY_VERSION}`),
      info: bytesOf(userId),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(userId: string, plaintext: string) {
  const key = await deriveKey(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12)) as Bytes;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, bytesOf(plaintext),
  );

  return {
    ciphertext: toBase64(new Uint8Array(ciphertext) as Bytes),
    iv: toBase64(iv),
    key_version: KEY_VERSION,
  };
}

export async function decryptSecret(
  userId: string,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const key = await deriveKey(userId);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ciphertext),
  );
  return decoder.decode(plain);
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length) as Bytes;
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function hexToBytes(hex: string): Bytes {
  const bytes = new Uint8Array(hex.length / 2) as Bytes;
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** HMAC générique, utilisé pour signer les requêtes Kraken et OKX. */
export async function hmac(
  keyBytes: Bytes | string,
  message: Bytes | string,
  hash: 'SHA-256' | 'SHA-512' = 'SHA-256',
): Promise<Bytes> {
  const rawKey = typeof keyBytes === 'string' ? bytesOf(keyBytes) : keyBytes;
  const rawMessage = typeof message === 'string' ? bytesOf(message) : message;

  const key = await crypto.subtle.importKey(
    'raw', rawKey, { name: 'HMAC', hash }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, rawMessage)) as Bytes;
}

export async function sha256(message: Bytes | string): Promise<Bytes> {
  const raw = typeof message === 'string' ? bytesOf(message) : message;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', raw)) as Bytes;
}

export function concat(...parts: Bytes[]): Bytes {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total) as Bytes;
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Empreinte affichable d'une clé publique : les 4 derniers caractères. */
export const fingerprintOf = (apiKey: string) => apiKey.slice(-4);
