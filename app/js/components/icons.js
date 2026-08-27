/**
 * WALLET · Jeu d'icônes
 *
 * Un seul trait pour toute l'application : 24×24, contour de 1,9, couleur
 * héritée du texte. C'est ce qui distingue une interface d'un assemblage
 * d'émojis — ces derniers changent de style selon l'appareil, ne suivent pas
 * la couleur du thème, et ne se mettent jamais à l'échelle proprement.
 *
 * Dessins inspirés de Lucide (licence ISC), redessinés au trait maison.
 */

import { icon } from '../lib/dom.js';

export const PATHS = {
  /* — Argent et comptes ————————————————————————————— */
  bank: '<path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M2 18h20M12 3l9 5H3z"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9H5a2 2 0 0 1-2-2z"/><circle cx="17" cy="14" r="1.2"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2a3 3 0 0 0-2.5-1.2c-1.6 0-2.6.8-2.6 2s1 1.7 2.6 2 2.6.8 2.6 2-1 2-2.6 2a3 3 0 0 1-2.5-1.2M12 6.2v11.6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  briefcase: '<rect x="2.5" y="7" width="19" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M2.5 12h19"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 20z"/><path d="M9.5 21.5v-7h5v7"/>',

  /* — Marchés ————————————————————————————————————— */
  trendUp: '<path d="M3 17.5 9.5 11l4 4L21 7.5"/><path d="M15.5 7.5H21v5.5"/>',
  trendDown: '<path d="M3 6.5 9.5 13l4-4L21 16.5"/><path d="M15.5 16.5H21V11"/>',
  chart: '<path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="12.5" y="7" width="3" height="10" rx="1"/><rect x="18" y="13" width="3" height="4" rx="1"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M14.5 2.5A9 9 0 0 1 21.5 9.5h-7z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 13 4-3.5"/><circle cx="12" cy="17" r="1.4"/>',
  ruler: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M7 8v3M12 8v4M17 8v3"/>',

  /* — Vie quotidienne ————————————————————————————— */
  receipt: '<path d="M5 3h14v18l-2.3-1.6-2.4 1.6-2.3-1.6L9.7 21l-2.4-1.6L5 21z"/><path d="M9 8h6M9 12h6"/>',
  tag: '<path d="M20.5 13.5 13 21a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 2.6 12L3 4l8-.4a2 2 0 0 1 1.5.6l8 8a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 13h18M12 9v12"/><path d="M12 9S9.5 3 7 4.5 9.5 9 12 9zM12 9s2.5-6 5-4.5S14.5 9 12 9z"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5a2.1 2.1 0 0 0-3-3L13 8 4.8 6.2a.7.7 0 0 0-.7 1.1l4.5 4.2-2.3 3.4-2.4-.5.8 2.9 2.9.8-.5-2.4 3.4-2.3 4.2 4.5a.7.7 0 0 0 1.1-.7z"/>',

  /* — États et signaux ————————————————————————————— */
  alert: '<path d="M12 3.5 22 20H2z"/><path d="M12 10v4M12 17h.01"/>',
  check: '<path d="m4 12.5 5 5L20 6.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.4M12 16.8h.01"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>',
  bulb: '<path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6h5.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-13.7-5.3L3 9"/><path d="M4 13a8 8 0 0 0 13.7 5.3L21 15"/><path d="M3 4v5h5M21 20v-5h-5"/>',
  lock: '<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  shield: '<path d="M12 3 5 6v6c0 4.4 3 7.7 7 9 4-1.3 7-4.6 7-9V6z"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 10.7a2 2 0 0 0 2.8 2.8"/><path d="M6.7 6.9C4.6 8.2 3 10 2 12c1.8 3.6 5.5 6 10 6 1.6 0 3.1-.3 4.4-.9M9.9 6.2A9.9 9.9 0 0 1 12 6c4.5 0 8.2 2.4 10 6-.7 1.4-1.7 2.6-2.9 3.6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.2H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.8 3H10a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"/>',
  brain: '<path d="M9.5 3.5A2.5 2.5 0 0 0 7 6v.3A2.7 2.7 0 0 0 4.5 9c0 .8.3 1.5.9 2A2.7 2.7 0 0 0 5 16.5a2.7 2.7 0 0 0 2.6 2.7A2.4 2.4 0 0 0 10 21a2 2 0 0 0 2-2V5.5a2 2 0 0 0-2.5-2z"/><path d="M14.5 3.5A2.5 2.5 0 0 1 17 6v.3A2.7 2.7 0 0 1 19.5 9c0 .8-.3 1.5-.9 2A2.7 2.7 0 0 1 19 16.5a2.7 2.7 0 0 1-2.6 2.7A2.4 2.4 0 0 1 14 21a2 2 0 0 1-2-2"/>',
  flask: '<path d="M9 3h6M10.5 3v6L5 18.5A2 2 0 0 0 6.8 21.5h10.4A2 2 0 0 0 19 18.5L13.5 9V3"/><path d="M7.8 15h8.4"/>',
  star: '<path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.2-5.4-2.9-5.4 2.9 1-6.2L3.2 10l6.1-.9z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>',
  inbox: '<path d="M3 12h5l1.5 3h5L16 12h5"/><path d="M4.6 5.5 3 12v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6l-1.6-6.5A2 2 0 0 0 17.5 4h-11a2 2 0 0 0-1.9 1.5z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/>',
  pen: '<path d="M4 20h4L20 8a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14.5 5.5 4 4"/>',
  traffic: '<rect x="7" y="2.5" width="10" height="19" rx="3"/><circle cx="12" cy="7.5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="16.5" r="1.6"/>',
  buoy: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6"/><path d="m6 6 3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5"/>',
  dot: '<circle cx="12" cy="12" r="5"/>',
  arrowRight: '<path d="M4 12h15"/><path d="m13 6 6 6-6 6"/>',
  arrowUp: '<path d="M12 20V5"/><path d="m6 11 6-6 6 6"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  shopping: '<path d="M5 7h14l-1.2 12.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  confetti: '<path d="m3.5 20.5 5.7-14.3 9.1 9.1z"/><path d="M14 3.5v2M18.5 6l1.5-1.5M20 11h2"/>',
};

/** Une icône, par son nom. Un nom inconnu renvoie un point plutôt qu'un vide. */
export function glyph(name, size = 20) {
  return icon(PATHS[name] ?? PATHS.dot, size);
}

export const hasGlyph = (name) => Boolean(PATHS[name]);
