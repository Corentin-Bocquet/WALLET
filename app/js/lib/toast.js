/** WALLET · Toasts. Un message court, jamais bloquant. */

import { h, mount } from './dom.js';
import { feedback } from './feedback.js';

let host = null;

function ensureHost() {
  if (host?.isConnected) return host;
  host = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
  document.body.append(host);
  return host;
}

export function toast(message, { kind = 'info', duration = 2600 } = {}) {
  const node = h(`div.toast${kind === 'error' ? '.toast--error' : kind === 'success' ? '.toast--success' : ''}`, message);
  ensureHost().append(node);

  if (kind === 'error') feedback.error();
  else if (kind === 'success') feedback.success();

  const remove = () => {
    node.style.transition = 'opacity 180ms, transform 180ms';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 200);
  };
  setTimeout(remove, duration);
  return remove;
}

export const clearToasts = () => host && mount(host);
