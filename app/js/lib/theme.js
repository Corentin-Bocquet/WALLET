/**
 * WALLET · Thème
 *
 * Trois états : 'dark', 'light', 'system'. En 'system', aucun attribut n'est
 * posé sur <html> et c'est prefers-color-scheme qui décide — c'est ce que fait
 * la feuille de tokens.
 *
 * La couleur de la barre d'état iOS est mise à jour en même temps, sinon
 * l'application installée garde une encoche de la mauvaise couleur.
 */

const STORAGE_KEY = 'wallet.theme';

export function applyTheme(theme = 'dark') {
  const root = document.documentElement;

  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignoré */ }

  updateThemeColor();
  return theme;
}

export function storedTheme() {
  try { return localStorage.getItem(STORAGE_KEY) || 'dark'; } catch { return 'dark'; }
}

/** Applique le thème mémorisé avant le premier rendu, pour éviter un flash. */
export function bootTheme() {
  return applyTheme(storedTheme());
}

function updateThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  // La valeur réellement calculée, quel que soit le chemin (attribut ou média).
  const background = getComputedStyle(document.body || document.documentElement)
    .getPropertyValue('--bg').trim();
  if (background) meta.setAttribute('content', background);
}

// Le thème « système » doit suivre les changements en cours de session.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (!document.documentElement.hasAttribute('data-theme')) updateThemeColor();
    });
}
