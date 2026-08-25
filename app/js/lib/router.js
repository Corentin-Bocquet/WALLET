/**
 * WALLET · Routeur par hash
 *
 * Le hash plutôt que l'History API : l'application est hébergée sur GitHub
 * Pages, qui ne sait pas réécrire les URL vers index.html. Avec un hash, un
 * rechargement sur /#/portefeuille fonctionne sans configuration serveur.
 *
 * Conserve la position de défilement par écran, comme une app native.
 */

import { feedback } from './feedback.js';

const routes = new Map();
const scrollMemory = new Map();
let current = null;
let container = null;
let notFound = null;

export function defineRoute(path, handler) {
  routes.set(path, handler);
}

export function setNotFound(handler) { notFound = handler; }

export function start(mountNode) {
  container = mountNode;
  window.addEventListener('hashchange', () => render());
  render();
}

export function navigate(path, { replace = false, silent = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === target) return;
  if (!silent) feedback.tap();
  if (replace) window.location.replace(target);
  else window.location.hash = target;
}

export function back() {
  feedback.back();
  if (window.history.length > 1) window.history.back();
  else navigate('/', { replace: true });
}

export function currentRoute() { return current; }

/** Parse « /marches/asset-btc?onglet=score » → { path, params, query }. */
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathname, search = ''] = raw.split('?');
  const segments = pathname.split('/').filter(Boolean);
  return {
    pathname: '/' + segments.join('/'),
    segments,
    query: Object.fromEntries(new URLSearchParams(search)),
  };
}

/** Trouve la route déclarée qui correspond, en gérant les segments :param. */
function match(segments) {
  for (const [pattern, handler] of routes) {
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segments.length) continue;

    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
      else if (parts[i] !== segments[i]) { ok = false; break; }
    }
    if (ok) return { handler, params, pattern };
  }
  return null;
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  const { pathname, segments, query } = parseHash();

  // Mémorise où on en était sur l'écran qu'on quitte.
  if (current) scrollMemory.set(current.pathname, window.scrollY);

  const found = match(segments) || (segments.length === 0 ? match([]) : null);
  const handler = found?.handler || routes.get('/') || notFound;

  if (!handler) return;

  current = { pathname, pattern: found?.pattern ?? '/', params: found?.params ?? {}, query };
  document.body.dataset.route = found?.pattern ?? '/';

  let view;
  try {
    view = await handler({ params: current.params, query, pathname });
  } catch (error) {
    console.error('[wallet] écran en erreur', error);
    view = errorView(error);
  }

  // Une navigation plus récente a pris le dessus pendant l'attente.
  if (token !== renderToken) return;

  container.replaceChildren(view);

  const saved = scrollMemory.get(pathname);
  // Un écran déjà visité retrouve sa position ; un nouvel écran commence en haut.
  window.scrollTo({ top: saved ?? 0, behavior: 'instant' });

  window.dispatchEvent(new CustomEvent('wallet:navigated', { detail: current }));
}

function errorView(error) {
  const node = document.createElement('div');
  node.className = 'screen';
  node.innerHTML = `
    <div class="empty">
      <div class="empty__emoji">⚠️</div>
      <div class="empty__title">Cet écran n'a pas pu s'afficher</div>
      <p class="muted">${escapeHtml(error?.message || 'Erreur inconnue')}</p>
      <button class="btn btn--secondary" style="margin-top:24px"
              onclick="location.reload()">Recharger</button>
    </div>`;
  return node;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Force un nouveau rendu de l'écran courant (après une correction, un réglage…). */
export function refresh() { render(); }
