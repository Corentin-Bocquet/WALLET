/**
 * WALLET · Briques d'interface partagées
 *
 * Regroupe ce que les cinq écrans réutilisent : en-têtes, états de chargement,
 * états vides, indicateur de fraîcheur, gros montant. L'objectif est que les
 * règles §45 (dire l'âge de la donnée) et §46 (ne jamais confondre inconnu et
 * zéro) soient appliquées par CONSTRUCTION, pas par vigilance.
 */

import { h, icon, mount } from '../lib/dom.js';
import { money, pct, ago, trendClass, trendArrow, UNKNOWN } from '../lib/fmt.js';
import { config } from '../config.js';
import { displayCurrency, cycleCurrency, canDisplay, onCurrencyChange } from '../lib/currency.js';
import { back } from '../lib/router.js';
import { explainChip } from './explain.js';

/* — En-têtes ————————————————————————————————————————— */

export function screenHead(title, { right = null, subtitle = null, explain = null } = {}) {
  return h('header.screen__head',
    h('div',
      h('h1.screen__title', title, explain ? explainChip(explain, { label: title }) : null),
      subtitle ? h('div.muted', { style: { fontSize: 'var(--fs-sm)' } }, subtitle) : null,
    ),
    right,
  );
}

export function subScreenHead(title, { right = null } = {}) {
  return h('header.screen__head',
    h('button.icon-btn.icon-btn--plain', {
      type: 'button', 'aria-label': 'Retour', 'data-sound': 'back',
      onclick: () => back(),
    }, icon('<path d="M15 5 8 12l7 7"/>')),
    h('h1.screen__title', { style: { flex: '1', textAlign: 'center', fontSize: 'var(--fs-h2)' } }, title),
    right || h('span', { style: { width: '40px' } }),
  );
}

export function section(title, { action = null, explain = null } = {}, ...children) {
  return h('section.section',
    h('div.section__head',
      h('h2.section__title', title, explain ? explainChip(explain, { label: title }) : null),
      action,
    ),
    ...children,
  );
}

export function seeAll(label, onClick) {
  return h('button.btn.btn--ghost.btn--sm', {
    type: 'button', 'data-sound': 'select', onclick: onClick,
  }, label, icon('<path d="M9 5l7 7-7 7"/>', 16));
}

/* — Le grand montant, motif central des références —————— */

/**
 * @param {number|null} value  null = INCONNU, affiché « — », jamais « 0 € »
 */
export function bigAmount(value, {
  label,
  currency,
  change = null,
  changePct = null,
  changeLabel = null,
  explain = null,
  unknownHint = null,
} = {}) {
  const known = Number.isFinite(value);

  return h('div',
    label ? h('div.eyebrow', label, explain ? explainChip(explain, { label }) : null) : null,
    h('div.display.sensitive', {
      style: { marginTop: '6px' },
      class: known ? '' : 'unknown',
    }, known ? money(value, currency ? { currency } : {}) : UNKNOWN),

    !known && unknownHint
      ? h('div.muted-2', { style: { fontSize: 'var(--fs-sm)', marginTop: '6px' } }, unknownHint)
      : null,

    known && (Number.isFinite(change) || Number.isFinite(changePct))
      ? h('div.num', {
          style: { marginTop: '8px', fontWeight: '600' },
          class: trendClass(changePct ?? change),
        },
        Number.isFinite(change) ? money(change, currency ? { currency, sign: true } : { sign: true }) : null,
        Number.isFinite(change) && Number.isFinite(changePct) ? ' ' : null,
        Number.isFinite(changePct) ? `(${pct(changePct)})` : null,
        changeLabel ? h('span.muted', { style: { fontWeight: '500' } }, ` ${changeLabel}`) : null,
      )
      : null,
  );
}

/* — Fraîcheur de la donnée (§45) ————————————————————— */

/**
 * N'affiche jamais « temps réel ». Dit l'âge réel, et bascule en avertissement
 * quand la donnée dépasse son seuil de fraîcheur.
 */
export function freshness(timestamp, {
  status = 'ok',
  thresholdSeconds = config.freshness.quotesSeconds,
  prefix = 'Mis à jour',
  message = null,
} = {}) {
  if (status === 'running' || status === 'syncing') {
    return h('span.freshness.freshness--syncing',
      h('span.freshness__dot'), 'Synchronisation…');
  }
  if (status === 'error') {
    return h('span.freshness.freshness--error',
      h('span.freshness__dot'), message || 'Synchronisation indisponible');
  }
  if (!timestamp) {
    return h('span.freshness.freshness--stale',
      h('span.freshness__dot'), message || 'Jamais synchronisé');
  }

  const age = (Date.now() - new Date(timestamp).getTime()) / 1000;
  const stale = age > thresholdSeconds;

  return h(`span.freshness${stale ? '.freshness--stale' : ''}`,
    h('span.freshness__dot'),
    `${prefix} ${ago(timestamp)}`,
  );
}

/** Bandeau d'avertissement quand une source manque (§46). */
export function partialNotice(unknown = [], { onFix = null } = {}) {
  if (!unknown.length) return null;
  const names = unknown.map((u) => u.label).filter(Boolean).slice(0, 3).join(', ');
  return h('div.notice.notice--warn',
    h('span', '⚠️'),
    h('div',
      h('strong', 'Total partiel'),
      `Le solde de ${names}${unknown.length > 3 ? ` et ${unknown.length - 3} autre(s)` : ''} n'est pas connu. Il n'est pas compté comme 0 €.`,
      onFix ? h('div', { style: { marginTop: '8px' } },
        h('button.btn.btn--sm.btn--secondary', { type: 'button', onclick: onFix }, 'Renseigner')) : null,
    ),
  );
}

/* — États ————————————————————————————————————————————— */

export function loadingRows(count = 4) {
  return h('div.rows',
    Array.from({ length: count }, () => h('div.row',
      h('div.avatar.skeleton'),
      h('div.row__main',
        h('div.row__title.skeleton', { style: { width: '55%' } }, '…'),
        h('div.row__sub.skeleton', { style: { width: '35%', marginTop: '6px' } }, '…'),
      ),
      h('div.row__end', h('div.row__value.skeleton', { style: { width: '64px' } }, '…')),
    )),
  );
}

export function loadingBlock(height = 140) {
  return h('div.skeleton', { style: { height: `${height}px`, borderRadius: 'var(--r-lg)' } });
}

export function emptyState({ emoji = '🗂️', title, body, action = null }) {
  return h('div.empty',
    h('div.empty__emoji', emoji),
    h('div.empty__title', title),
    body ? h('p', body) : null,
    action ? h('div', { style: { marginTop: '24px' } }, action) : null,
  );
}

/**
 * État d'erreur. Distingue explicitement l'échec de synchronisation du vide :
 * l'utilisateur doit savoir qu'il manque une donnée, pas croire qu'il n'a rien.
 */
export function errorState(error, { onRetry = null, what = 'ces données' } = {}) {
  return h('div.notice.notice--danger',
    h('span', '⚠️'),
    h('div',
      h('strong', `Impossible de charger ${what}`),
      error?.message || 'La source est momentanément indisponible.',
      h('div', { style: { marginTop: '10px' } },
        onRetry
          ? h('button.btn.btn--sm.btn--secondary', { type: 'button', 'data-sound': 'select', onclick: onRetry }, 'Réessayer')
          : null,
      ),
    ),
  );
}

/**
 * Rend un bloc asynchrone en gérant les trois états d'un coup.
 * Évite de réécrire le même try/catch/squelette dans chaque écran.
 */
export function asyncBlock(promise, {
  loading = () => loadingBlock(),
  render,
  empty = null,
  what = 'ces données',
} = {}) {
  const host = h('div');
  mount(host, loading());

  Promise.resolve(promise)
    .then((data) => {
      const isEmpty = data === null || data === undefined
        || (Array.isArray(data) && data.length === 0);
      if (isEmpty && empty) mount(host, empty());
      else mount(host, render(data));
    })
    .catch((error) => {
      console.warn('[wallet]', what, error);
      mount(host, errorState(error, { what }));
    });

  return host;
}

/* — Divers ————————————————————————————————————————————— */

export function badge(text, kind = '') {
  return h(`span.badge${kind ? `.badge--${kind}` : ''}`, text);
}

/** Pastille « estimé » : rappelle qu'un chiffre est dérivé, pas mesuré (§47). */
export function estimateBadge(note = 'estimé') {
  return h('span.badge.badge--estimate', { title: 'Valeur calculée localement, pas mesurée à la source' }, note);
}

export function changeBadge(value) {
  if (!Number.isFinite(value)) return h('span.badge', UNKNOWN);
  const kind = value > 0 ? 'up' : value < 0 ? 'down' : '';
  return h(`span.badge${kind ? `.badge--${kind}` : ''}`, `${trendArrow(value)} ${pct(value)}`);
}

export function switchRow({ label, hint, checked, onChange, explain = null }) {
  const toggle = h('button.switch', {
    type: 'button', role: 'switch',
    'aria-checked': checked ? 'true' : 'false',
    'aria-label': label,
    'data-sound': 'toggle',
  });
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', next ? 'true' : 'false');
    onChange(next);
  });

  return h('div.switch-row',
    h('div',
      h('div.switch-row__label', label, explain ? explainChip(explain, { label }) : null),
      hint ? h('div.switch-row__hint', hint) : null,
    ),
    toggle,
  );
}

export function accordion(title, buildBody, { open = false } = {}) {
  const body = h('div.accordion__body');
  const node = h('div.accordion', { dataset: { open: String(open) } },
    h('button.accordion__head', {
      type: 'button', 'aria-expanded': String(open), 'data-sound': 'select',
      onclick: () => {
        const next = node.dataset.open !== 'true';
        node.dataset.open = String(next);
        node.querySelector('.accordion__head').setAttribute('aria-expanded', String(next));
        body.hidden = !next;
        if (next && !body.dataset.built) {
          mount(body, buildBody());
          body.dataset.built = '1';
        }
      },
    }, h('span', title), h('span.accordion__chev', icon('<path d="M6 9l6 6 6-6"/>', 18))),
    body,
  );

  body.hidden = !open;
  if (open) { mount(body, buildBody()); body.dataset.built = '1'; }
  return node;
}

/** Bandeau du mode démonstration : dire clairement ce qui est simulé (§51). */
export function demoBanner() {
  return h('div.notice', { style: { marginBottom: '16px' } },
    h('span', '🧪'),
    h('div',
      h('strong', 'Mode démonstration'),
      'Les prix et les transactions affichés sont simulés. Connectez votre serveur Supabase et vos comptes depuis Profil pour voir vos vraies données.',
    ),
  );
}

export { money, pct, UNKNOWN };


/* — Interrupteur euro / dollar ————————————————————————— */

/**
 * Bascule la devise d'affichage. Volontairement limité à l'euro et au dollar :
 * ce sont les deux seules devises qu'on veut comparer d'un coup d'œil. Les
 * autres se choisissent dans les préférences, où l'on prend le temps.
 *
 * Une devise dont le taux est inconnu rend l'interrupteur inactif plutôt que
 * de laisser convertir avec un taux inventé (§46).
 */
export function currencyToggle({ compact = false } = {}) {
  const paint = (root) => {
    const active = displayCurrency();
    const usable = canDisplay('USD');
    root.replaceChildren(
      h('span.ccy-switch__opt', { class: active === 'EUR' ? 'is-on' : '' }, '€'),
      h('span.ccy-switch__opt', { class: active === 'USD' ? 'is-on' : '' }, '$'),
      h('span.ccy-switch__knob', { style: { transform: active === 'USD' ? 'translateX(100%)' : 'none' } }),
    );
    root.setAttribute('aria-label', `Afficher en ${active === 'EUR' ? 'euros' : 'dollars'}`);
    root.disabled = !usable;
    root.title = usable ? 'Basculer euro / dollar' : 'Taux de change indisponible';
  };

  const root = h('button.ccy-switch', {
    type: 'button',
    'data-sound': 'toggle',
    class: compact ? 'ccy-switch--compact' : '',
    onclick: () => { cycleCurrency(1); },
  });

  paint(root);
  const stop = onCurrencyChange(() => paint(root));
  // Le routeur remplace le DOM à chaque rendu : on se désabonne quand
  // l'élément quitte la page, sinon les écouteurs s'accumulent.
  if (typeof MutationObserver !== 'undefined') {
    queueMicrotask(() => {
      const observer = new MutationObserver(() => {
        if (!root.isConnected) { stop(); observer.disconnect(); }
      });
      if (root.ownerDocument?.body) {
        observer.observe(root.ownerDocument.body, { childList: true, subtree: true });
      }
    });
  }
  return root;
}
