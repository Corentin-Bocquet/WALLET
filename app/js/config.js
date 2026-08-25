/**
 * WALLET · Configuration
 *
 * Ce fichier ne contient AUCUN secret. La clé "anon" de Supabase est publique
 * par conception : c'est la Row Level Security (migration 0006) qui protège
 * les données, pas le secret de cette clé. Les vraies clés sensibles (Kraken,
 * OKX, service_role) ne vivent que dans les secrets Supabase, côté serveur.
 *
 * Trois façons de renseigner l'URL et la clé, dans cet ordre de priorité :
 *   1. window.WALLET_CONFIG, injecté par app/config.local.js (ignoré par git)
 *   2. localStorage, via l'écran de connexion (« Configurer le serveur »)
 *   3. les valeurs ci-dessous
 */

const FALLBACK = {
  supabaseUrl: '',
  supabaseAnonKey: '',
};

function readStored() {
  try {
    const raw = localStorage.getItem('wallet.config');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const injected = typeof window !== 'undefined' ? (window.WALLET_CONFIG || {}) : {};
const stored = readStored();

export const config = {
  ...FALLBACK,
  ...stored,
  ...injected,

  /** Version affichée dans Profil, et clé de cache du service worker. */
  version: '1.0.1',

  /** Devise de repli tant que les préférences ne sont pas chargées. */
  defaultCurrency: 'EUR',
  defaultLocale: 'fr-FR',

  /**
   * Fraîcheur : au-delà, on affiche « donnée ancienne » plutôt que de laisser
   * croire à du temps réel (§45).
   */
  freshness: {
    quotesSeconds: 15 * 60,
    portfolioSeconds: 60 * 60,
    bankSeconds: 24 * 60 * 60,
  },

  /**
   * Seuil sous lequel une catégorisation est considérée incertaine et
   * l'utilisateur est sollicité plutôt que de deviner (§15).
   */
  categorization: {
    askBelowConfidence: 0.6,
    autoApplyAbove: 0.8,
  },
};

export function saveConfig(patch) {
  const next = { ...readStored(), ...patch };
  localStorage.setItem('wallet.config', JSON.stringify(next));
  Object.assign(config, next);
  return next;
}

/** Vrai quand aucun backend n'est configuré : on bascule en démonstration. */
export function isConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}
