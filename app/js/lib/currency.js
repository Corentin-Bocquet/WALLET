/**
 * WALLET · Devise d'affichage
 *
 * Tout est calculé et stocké en euros côté serveur. Ce module ne touche pas
 * aux données : il ne change QUE la façon de les afficher.
 *
 * Règle de prudence (§46) : si le taux de change n'est pas connu, on refuse
 * de basculer plutôt que d'afficher un montant faux. Un patrimoine converti
 * avec un taux inventé serait pire que pas de bouton du tout.
 */

export const BASE = 'EUR';
export const SUPPORTED = ['EUR', 'USD', 'GBP', 'CHF', 'JPY'];

/**
 * L'interrupteur ne bascule QU'ENTRE l'euro et le dollar : c'est un
 * aller-retour d'un geste, pas un sélecteur. Les autres devises se
 * choisissent dans les préférences, où l'on prend le temps de lire.
 */
export const TOGGLE_PAIR = ['EUR', 'USD'];

const KEY = 'wallet.displayCurrency';
const RATES_KEY = 'wallet.fxRates';

const SYMBOLS = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', JPY: '¥' };

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

/** Taux depuis l'euro : { USD: 1.1669 }. L'euro vaut toujours 1. */
let rates = { ...readStored(RATES_KEY, {}), EUR: 1 };
let current = SUPPORTED.includes(readStored(KEY, BASE)) ? readStored(KEY, BASE) : BASE;

const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(current); } catch { /* rien */ } });

export const displayCurrency = () => current;
export const symbolOf = (code) => SYMBOLS[code] ?? code;

/** Vrai si l'on sait convertir vers cette devise. */
export const canDisplay = (code) => code === BASE || Number.isFinite(rates[code]);

export function setRates(next) {
  rates = { ...rates, ...next, EUR: 1 };
  try { localStorage.setItem(RATES_KEY, JSON.stringify(rates)); } catch { /* rien */ }
  // Une devise devenue affichable peut débloquer un choix mémorisé.
  if (!canDisplay(current)) { current = BASE; }
  notify();
}

export function setDisplayCurrency(code) {
  if (!SUPPORTED.includes(code) || !canDisplay(code) || code === current) return false;
  current = code;
  try { localStorage.setItem(KEY, JSON.stringify(code)); } catch { /* rien */ }
  notify();
  return true;
}

/** Passe à la devise suivante. Utilisé par le bouton et par le balayage. */
export function cycleCurrency(direction = 1) {
  const usable = TOGGLE_PAIR.filter(canDisplay);
  if (usable.length < 2) return false;
  const index = usable.indexOf(current);
  const next = usable[(index + direction + usable.length) % usable.length];
  return setDisplayCurrency(next);
}

/** Convertit un montant exprimé en euros vers la devise d'affichage. */
export function fromBase(value) {
  const rate = rates[current];
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(rate)) return value;
  return value * rate;
}

export function onCurrencyChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
