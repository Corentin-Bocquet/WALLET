/**
 * WALLET · Marques et actifs
 *
 * Deux besoins différents :
 *   · le logo d'un exchange ou d'une banque, dessiné une fois pour toutes ;
 *   · le logo d'une cryptomonnaie, qui vient du référentiel (CoinGecko en
 *     fournit l'URL). On garde une pastille avec le sigle en repli : une
 *     image qui ne charge pas ne doit jamais laisser un trou.
 */

import { h } from '../lib/dom.js';

const SVG = 'http://www.w3.org/2000/svg';

function svg(viewBox, inner, size) {
  const node = document.createElementNS(SVG, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = inner;
  return node;
}

/** Couleur de marque, utilisée aussi pour les pastilles de compte. */
export const BRAND_COLOR = {
  kraken: '#5741D9',
  okx: '#000000',
  boursorama: '#0F4C9C',
  manual: 'var(--surface-2)',
};

const BRANDS = {
  // Kraken : le calmar stylisé, en blanc sur le violet de la marque.
  kraken: (size) => svg('0 0 32 32',
    '<rect width="32" height="32" rx="7" fill="#5741D9"/>'
    + '<path fill="#fff" d="M16 6.2c-4.7 0-8.5 3.8-8.5 8.5v2.1a1.6 1.6 0 0 0 3.2 0v-2.1a1.6 1.6 0 0 1 3.2 0v2.1a1.6 1.6 0 0 0 3.2 0v-2.1a1.6 1.6 0 0 1 3.2 0v2.1a1.6 1.6 0 0 0 3.2 0v-2.1c0-4.7-3.8-8.5-8.5-8.5z"/>'
    + '<path fill="#fff" d="M13.1 20.3h5.8v5.5h-5.8z" opacity=".0"/>', size),

  // OKX : la grille de carrés, en noir et blanc.
  okx: (size) => svg('0 0 32 32',
    '<rect width="32" height="32" rx="7" fill="#000"/>'
    + '<g fill="#fff">'
    + '<rect x="6" y="6" width="6.4" height="6.4" rx="1"/>'
    + '<rect x="19.6" y="6" width="6.4" height="6.4" rx="1"/>'
    + '<rect x="12.8" y="12.8" width="6.4" height="6.4" rx="1"/>'
    + '<rect x="6" y="19.6" width="6.4" height="6.4" rx="1"/>'
    + '<rect x="19.6" y="19.6" width="6.4" height="6.4" rx="1"/>'
    + '</g>', size),

  // Boursorama : la flèche à trois pans.
  boursorama: (size) => svg('0 0 32 32',
    '<rect width="32" height="32" rx="7" fill="#fff"/>'
    + '<path fill="#00AEEF" d="M4 17.5 20.5 6 15.8 16z"/>'
    + '<path fill="#0B3D91" d="M20.5 6 15.8 16l4.8 1.6z"/>'
    + '<path fill="#E6007E" d="M15.8 16l4.8 1.6L16.4 26z"/>', size),
};

/** Logo d'un fournisseur, ou null s'il n'est pas connu. */
export function brandLogo(provider, size = 28) {
  const key = String(provider || '').toLowerCase();
  const draw = BRANDS[key] ?? (key.includes('bourso') ? BRANDS.boursorama : null);
  return draw ? draw(size) : null;
}

/** Pastille d'un actif : le vrai logo, avec le sigle en repli. */
export function assetAvatar(asset, size = 40) {
  const symbol = String(asset?.symbol ?? '?').slice(0, 4);
  const fallback = h('span', {
    style: { fontWeight: '700', fontSize: '13px', letterSpacing: '-.02em' },
  }, symbol);

  const holder = h('div.avatar', {
    style: {
      background: 'var(--surface-2)', width: `${size}px`, height: `${size}px`,
      overflow: 'hidden', display: 'grid', placeItems: 'center',
    },
  }, fallback);

  const url = asset?.image_url;
  if (url) {
    const img = h('img', {
      src: url, alt: '', loading: 'lazy', width: size, height: size,
      style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' },
      // Une image de logo peut disparaître d'un CDN : on garde le sigle.
      onerror: (event) => { event.currentTarget.remove(); },
    });
    holder.replaceChildren(img);
    img.addEventListener('error', () => holder.replaceChildren(fallback), { once: true });
  }
  return holder;
}

/** Badge coloré d'un compte, pour distinguer d'où vient une position. */
export function accountBadge(label, provider) {
  const color = BRAND_COLOR[String(provider || '').toLowerCase()] ?? 'var(--surface-2)';
  return h('span.acct-badge', {
    style: { '--badge': color },
    title: `Détenu sur ${label}`,
  }, label);
}
