/**
 * WALLET · Barre de navigation basse (§36)
 * Cinq entrées, pas une de plus. Chacune répond à une seule question (§41).
 */

import { h, icon } from '../lib/dom.js';
import { navigate, currentRoute } from '../lib/router.js';

const ICONS = {
  home:    '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H9.5v-6h5v6h3a1 1 0 0 0 1-1V9.5"/>',
  markets: '<path d="M3 17.5 9 11l4 3.5 7.5-8"/><path d="M15.5 6.5H21v5.5"/>',
  wallet:  '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3" fill="currentColor" stroke="none"/>',
  target:  '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  profile: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.7 4.2-5.5 7.5-5.5s6.1 1.8 7.5 5.5"/>',
};

export const TABS = [
  { path: '/',             label: 'Accueil',       icon: 'home',    question: 'Comment va mon patrimoine ?' },
  { path: '/marches',      label: 'Marchés',       icon: 'markets', question: 'Que font les marchés ?' },
  { path: '/portefeuille', label: 'Portefeuille',  icon: 'wallet',  question: 'Où est mon argent ?' },
  { path: '/opportunites', label: 'Opportunités',  icon: 'target',  question: 'Où sont les zones intéressantes ?' },
  { path: '/profil',       label: 'Profil',        icon: 'profile', question: 'Comment configurer mon application ?' },
];

export function bottomNav() {
  const nav = h('nav.dock', { 'aria-label': 'Navigation principale' });

  for (const tab of TABS) {
    const link = h('a', {
      href: `#${tab.path}`,
      'data-sound': 'tap',
      'aria-label': `${tab.label} — ${tab.question}`,
      onclick: (event) => { event.preventDefault(); navigate(tab.path); },
    }, icon(ICONS[tab.icon]), h('span', tab.label));
    nav.append(link);
  }

  const sync = () => {
    const route = currentRoute();
    const path = route?.pathname || '/';
    for (const [index, link] of [...nav.children].entries()) {
      const tab = TABS[index];
      // Un sous-écran (/portefeuille/xyz) garde son onglet allumé.
      const active = tab.path === '/'
        ? path === '/'
        : path === tab.path || path.startsWith(`${tab.path}/`);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  };

  window.addEventListener('wallet:navigated', sync);
  queueMicrotask(sync);
  return nav;
}

export { ICONS };
