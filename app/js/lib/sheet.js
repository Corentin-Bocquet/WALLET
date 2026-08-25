/**
 * WALLET · Bottom sheet
 *
 * C'est le véhicule du principe de masquage (§39) : rien de complexe n'est
 * affiché d'emblée, tout est à un tap. Gère le glissement au doigt, la touche
 * Échap, le piège de focus et l'empilement (une explication peut s'ouvrir
 * par-dessus un détail).
 */

import { h, mount, nextFrame } from './dom.js';
import { feedback } from './feedback.js';

const stack = [];

export function openSheet({ title, build, onClose, label } = {}) {
  const scrim = h('div.sheet-scrim', { onclick: () => close() });
  const body = h('div.sheet__body');
  const panel = h('div.sheet', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': label || title || 'Détail',
  },
    h('div.sheet__grabber', { 'aria-hidden': 'true' }),
    title ? h('h2.sheet__title', title) : null,
    body,
  );

  document.body.append(scrim, panel);
  const entry = { scrim, panel, body, onClose, close };
  stack.push(entry);
  document.documentElement.style.overflow = 'hidden';

  // Le contenu peut être synchrone ou asynchrone (chargement de données).
  const content = typeof build === 'function' ? build({ close, body, setTitle }) : build;
  if (content instanceof Promise) {
    mount(body, h('div.skeleton', { style: { height: '120px' } }));
    content.then((node) => node && mount(body, node)).catch(() => {
      mount(body, h('p', 'Impossible de charger ce contenu.'));
    });
  } else if (content) {
    mount(body, content);
  }

  nextFrame().then(() => {
    scrim.dataset.open = 'true';
    panel.dataset.open = 'true';
    panel.focus?.();
  });

  feedback.sheetOpen();
  installDrag(panel, close);
  document.addEventListener('keydown', onKey);

  function setTitle(next) {
    const node = panel.querySelector('.sheet__title');
    if (node) node.textContent = next;
  }

  function onKey(event) {
    if (event.key === 'Escape' && stack[stack.length - 1] === entry) {
      event.preventDefault();
      close();
    }
  }

  function close() {
    const index = stack.indexOf(entry);
    if (index === -1) return;
    stack.splice(index, 1);
    document.removeEventListener('keydown', onKey);

    scrim.dataset.open = 'false';
    panel.dataset.open = 'false';
    panel.style.transform = '';
    feedback.sheetClose();

    setTimeout(() => {
      scrim.remove();
      panel.remove();
      if (!stack.length) document.documentElement.style.overflow = '';
      onClose?.();
    }, 260);
  }

  return { close, setContent: (node) => mount(body, node), setTitle };
}

export const closeAllSheets = () => [...stack].reverse().forEach((s) => s.close());

/** Glisser vers le bas pour fermer, avec seuil de vitesse. */
function installDrag(panel, close) {
  let startY = 0;
  let currentY = 0;
  let dragging = false;
  let startedAt = 0;

  panel.addEventListener('pointerdown', (event) => {
    // On ne démarre le glissement que depuis le haut du panneau, sinon on
    // empêcherait de faire défiler le contenu.
    if (panel.scrollTop > 0) return;
    if (!event.isPrimary) return;
    dragging = true;
    startY = event.clientY;
    currentY = 0;
    startedAt = performance.now();
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    currentY = Math.max(0, event.clientY - startY);
    panel.style.transform = `translateY(${currentY}px)`;
  }, { passive: true });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    const velocity = currentY / Math.max(1, performance.now() - startedAt);
    if (currentY > panel.offsetHeight * 0.3 || velocity > 0.6) close();
    else panel.style.transform = '';
  };

  panel.addEventListener('pointerup', end, { passive: true });
  panel.addEventListener('pointercancel', end, { passive: true });
}

/** Feuille de confirmation, pour les gestes irréversibles. */
export function confirmSheet({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const sheet = openSheet({
      title,
      onClose: () => { if (!decided) resolve(false); },
      build: ({ close }) => h('div',
        h('p', message),
        h('div', { style: { display: 'grid', gap: '12px', marginTop: '28px' } },
          h(`button.btn.btn--block${danger ? '.btn--danger' : '.btn--primary'}`, {
            'data-sound': danger ? 'warn' : 'select',
            onclick: () => { decided = true; resolve(true); close(); },
          }, confirmLabel),
          h('button.btn.btn--ghost.btn--block', {
            'data-sound': 'back',
            onclick: () => { decided = true; resolve(false); close(); },
          }, 'Annuler'),
        ),
      ),
    });
    void sheet;
  });
}
