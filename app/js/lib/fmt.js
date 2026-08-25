/**
 * WALLET · Formatage
 *
 * Règle qui traverse tout le fichier : une valeur inconnue n'est pas zéro.
 * Toutes les fonctions renvoient « — » pour null/undefined/NaN, jamais « 0 € ».
 * (§46)
 */

import { config } from '../config.js';

export const UNKNOWN = '—';

const cache = new Map();
function nf(locale, options) {
  const key = locale + JSON.stringify(options);
  if (!cache.has(key)) cache.set(key, new Intl.NumberFormat(locale, options));
  return cache.get(key);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Montant en devise. `compact` pour les gros nombres (1,2 M€). */
export function money(value, {
  currency = config.defaultCurrency,
  locale = config.defaultLocale,
  decimals,
  compact = false,
  sign = false,
} = {}) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!isNum(n)) return UNKNOWN;

  const abs = Math.abs(n);
  let min = decimals, max = decimals;
  if (decimals === undefined) {
    // Un prix à 0,00004 € doit rester lisible ; un patrimoine à 12 500 € non.
    if (abs === 0) { min = max = 2; }
    else if (abs < 0.01) { min = 2; max = 8; }
    else if (abs < 1) { min = 2; max = 4; }
    else if (abs < 10000) { min = max = 2; }
    else { min = max = compact ? 1 : 0; }
  }

  return nf(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    notation: compact && abs >= 100000 ? 'compact' : 'standard',
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(n);
}

/** Nombre brut (quantité d'actif, nombre de transactions…). */
export function num(value, { locale = config.defaultLocale, decimals } = {}) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!isNum(n)) return UNKNOWN;
  const abs = Math.abs(n);
  const max = decimals ?? (abs < 1 ? 8 : abs < 1000 ? 4 : 2);
  return nf(locale, { maximumFractionDigits: max }).format(n);
}

/** Pourcentage. `value` est déjà en points de % (12.5 → « +12,5 % »). */
export function pct(value, { locale = config.defaultLocale, decimals = 2, sign = true } = {}) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!isNum(n)) return UNKNOWN;
  return nf(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: sign ? 'exceptZero' : 'auto',
  }).format(n) + ' %';
}

/** Classe CSS de couleur selon le signe, neutre si inconnu. */
export function trendClass(value) {
  if (!isNum(value) || value === 0) return 'muted';
  return value > 0 ? 'up' : 'down';
}

export function trendArrow(value) {
  if (!isNum(value) || value === 0) return '';
  return value > 0 ? '▲' : '▼';
}

/** Grande quantité compacte : 1 234 567 → « 1,2 M ». */
export function compact(value, { locale = config.defaultLocale } = {}) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!isNum(n)) return UNKNOWN;
  return nf(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/* — Dates —————————————————————————————————————————— */

export function day(value, { locale = config.defaultLocale, long = false } = {}) {
  if (!value) return UNKNOWN;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+d)) return UNKNOWN;
  return d.toLocaleDateString(locale, long
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { day: 'numeric', month: 'short' });
}

export function month(value, { locale = config.defaultLocale } = {}) {
  if (!value) return UNKNOWN;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+d)) return UNKNOWN;
  return d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

export function clock(value, { locale = config.defaultLocale } = {}) {
  if (!value) return UNKNOWN;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+d)) return UNKNOWN;
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * « il y a 15 secondes ». Affiché tel quel dans l'indicateur de fraîcheur :
 * on dit ce qu'on sait, on ne prétend jamais au temps réel (§45).
 */
export function ago(value, { locale = config.defaultLocale } = {}) {
  if (!value) return 'jamais';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(+d)) return 'jamais';

  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  const steps = [
    [60, 'second', 1],
    [3600, 'minute', 60],
    [86400, 'hour', 3600],
    [604800, 'day', 86400],
    [2629800, 'week', 604800],
    [31557600, 'month', 2629800],
    [Infinity, 'year', 31557600],
  ];
  if (seconds < 10) return "à l'instant";
  for (const [limit, unit, divisor] of steps) {
    if (Math.abs(seconds) < limit) return rtf.format(-Math.round(seconds / divisor), unit);
  }
  return 'jamais';
}

/** Slug lisible → « Uber Eats » depuis « uber eats ». */
export function titleCase(text) {
  if (!text) return '';
  return String(text)
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w.toUpperCase()))
    .join(' ');
}

/** Initiales pour l'avatar. */
export function initials(name, email) {
  const src = (name || '').trim() || (email || '').split('@')[0] || '?';
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || src[0].toUpperCase();
}
