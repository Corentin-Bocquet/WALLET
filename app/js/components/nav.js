/**
 * WALLET · Barre de navigation basse (§36)
 * Cinq entrées, pas une de plus. Chacune répond à une seule question (§41).
 *
 * Le budget (dépenses, catégories, récurrences) a sa propre entrée : c'est ce
 * qu'on consulte le plus souvent, et il n'était joignable que par un lien de
 * l'accueil. Les opportunités (zones, scénarios, simulations) vivent sous
 * Marchés, dont elles sont la lecture approfondie : un onglet interne les
 * sépare des cours.
 */

import { h, icon } from '../lib/dom.js';
import { navigate, currentRoute } from '../lib/router.js';

const ICONS = {
  home:    '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H9.5v-6h5v6h3a1 1 0 0 0 1-1V9.5"/>',
  markets: '<path d="M3 17.5 9 11l4 3.5 7.5-8"/><path d="M15.5 6.5H21v5.5"/>',
  wallet:  '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3" fill="currentColor" stroke="none"/>',
  // Un camembert : le budget, c'est la répartition de ce qui sort.
  budget:  '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 2.9a8.6 8.6 0 0 1 6.1 6.1H15z"/>',
  target:  '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  profile: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.4-3.7 4.2-5.5 7.5-5.5s6.1 1.8 7.5 5.5"/>',
};

export const TABS = [
  { path: '/',             label: 'Accueil',       icon: 'home',    question: 'Comment va mon patrimoine ?' },
  { path: '/banque',       label: 'Budget',        icon: 'budget',  question: 'Où part mon argent ?' },
  { path: '/portefeuille', label: 'Portefeuille',  icon: 'wallet',  question: 'Où est mon argent ?' },
  { path: '/marches',      label: 'Marchés',       icon: 'markets', question: 'Que font les marchés, où sont les zones intéressantes ?',
    also: ['/opportunites'] },
  { path: '/profil',       label: 'Profil',        icon: 'profile', question: 'Comment configurer mon application ?' },
];

export function bottomNav() {
  const nav = h('nav.dock', { 'aria-label': 'Navigation principale' });
  // La bulle de verre qui glisse sous l'onglet actif.
  const pill = h('span.dock__pill', { 'aria-hidden': 'true' });
  nav.append(pill);

  // Icônes seules : le nom de l'onglet reste annoncé aux lecteurs d'écran
  // et apparaît en info-bulle, sans encombrer la barre.
  const links = TABS.map((tab) => {
    const link = h('a', {
      href: `#${tab.path}`,
      'data-sound': 'tap',
      'aria-label': tab.label,
      title: tab.label,
      onclick: (event) => { event.preventDefault(); navigate(tab.path); },
    }, icon(ICONS[tab.icon], 25));
    nav.append(link);
    return link;
  });

  const sync = () => {
    const route = currentRoute();
    const path = route?.pathname || '/';
    let activeIndex = -1;
    for (const [index, link] of links.entries()) {
      const tab = TABS[index];
      // Un sous-écran (/portefeuille/xyz) garde son onglet allumé.
      const within = (base) => path === base || path.startsWith(`${base}/`);
      const active = tab.path === '/'
        ? path === '/'
        : within(tab.path) || (tab.also ?? []).some(within);
      if (active) { link.setAttribute('aria-current', 'page'); activeIndex = index; }
      else link.removeAttribute('aria-current');
    }
    pill.style.setProperty('--i', String(Math.max(0, activeIndex)));
    pill.hidden = activeIndex < 0;
  };

  window.addEventListener('wallet:navigated', sync);
  queueMicrotask(sync);
  return nav;
}

export { ICONS };
