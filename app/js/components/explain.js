/**
 * WALLET · Système d'explication à trois niveaux (§6, §7)
 *
 *   Niveau 1 — une phrase. C'est TOUT ce qui est montré par défaut.
 *   Niveau 2 — quelques phrases, derrière « Pourquoi c'est utile ? ».
 *   Niveau 3 — l'explication technique complète, derrière un second tap.
 *
 * Les textes vivent dans la table `glossary` (migration 0008) et sont mis en
 * cache localement : une explication déjà lue s'ouvre instantanément, même
 * hors connexion.
 */

import { h, mount } from '../lib/dom.js';
import { openSheet } from '../lib/sheet.js';
import { feedback } from '../lib/feedback.js';
import { getGlossary } from '../data/repo.js';

const memory = new Map();

/**
 * Puce ⓘ à poser à côté de n'importe quel terme.
 *   explainChip('mvrv')  →  <button class="info-chip">ⓘ</button>
 */
export function explainChip(code, { label } = {}) {
  return h('button.info-chip', {
    type: 'button',
    'aria-label': `Qu'est-ce que ${label || code} ?`,
    'data-sound': 'sheetOpen',
    onclick: (event) => {
      event.stopPropagation();
      event.preventDefault();
      showExplanation(code, { label });
    },
  }, 'ⓘ');
}

/** Titre + puce, l'assemblage le plus courant : « MVRV ⓘ ». */
export function labelWithInfo(text, code, tag = 'span') {
  return h(tag, { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
    text, explainChip(code, { label: text }));
}

export async function showExplanation(code, { label } = {}) {
  const sheet = openSheet({ title: label || code, build: () => h('div.skeleton', { style: { height: '96px' } }) });

  let entry = memory.get(code);
  if (!entry) {
    entry = await getGlossary(code).catch(() => null);
    if (entry) memory.set(code, entry);
  }

  if (!entry) {
    sheet.setContent(h('p', "Aucune explication n'est encore disponible pour ce terme."));
    return;
  }

  sheet.setTitle(entry.term);
  sheet.setContent(renderLevels(entry));
}

function renderLevels(entry) {
  const container = h('div');
  let level = 1;

  const paint = () => {
    const parts = [
      h('p.explain__q', "C'est quoi ?"),
      h('p', entry.level1),
    ];

    if (level >= 2) {
      parts.push(
        h('p.explain__q', "Pourquoi c'est utile ?"),
        h('p', entry.level2),
      );
    }

    if (level >= 3) {
      parts.push(
        h('p.explain__q', 'En détail'),
        h('p', entry.level3),
      );
      if (entry.formula) {
        parts.push(h('div.explain__formula', entry.formula));
      }
    }

    if (level < 3) {
      parts.push(h('button.explain__more', {
        type: 'button',
        'data-sound': 'select',
        onclick: () => { level += 1; feedback.select(); paint(); },
      }, level === 1 ? 'Pourquoi c’est utile ? →' : "Voir l'explication avancée →"));
    }

    const sources = Array.isArray(entry.sources) ? entry.sources : [];
    if (sources.length) {
      parts.push(h('p.explain__source',
        'Source : ' + sources.join(' · ')));
    }

    mount(container, parts);
  };

  paint();
  return container;
}

/**
 * Panneau « Pourquoi ce résultat ? » (§47).
 * Reçoit une liste de facteurs {label, value, weight, note} et les affiche
 * triés par contribution. Utilisé par l'Investment Score et la catégorisation.
 */
export function showReasoning({ title, subtitle, factors = [], footnote }) {
  openSheet({
    title,
    build: () => h('div',
      subtitle ? h('p', subtitle) : null,
      h('div.rows', { style: { marginTop: '20px' } },
        factors.length
          ? factors.map((f) => h('div.row',
              h('div.avatar.avatar--dot', {
                style: { background: f.color || 'var(--surface-3)' },
              }),
              h('div.row__main',
                h('div.row__title', f.label),
                f.note ? h('div.row__sub', f.note) : null,
              ),
              h('div.row__end',
                h('div.row__value', f.display ?? f.value ?? '—'),
                f.weight !== undefined
                  ? h('div.row__sub', `poids ${f.weight}`)
                  : null,
              ),
            ))
          : h('p.muted', 'Aucun facteur disponible pour le moment.'),
      ),
      footnote ? h('p.explain__source', footnote) : null,
    ),
  });
}
