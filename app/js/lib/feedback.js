/**
 * WALLET · Son et vibration
 *
 * Les sons fournis sont décodés une fois puis rejoués via WebAudio : sur iOS,
 * un <audio> par clic sature et introduit un retard audible. Le contexte n'est
 * créé qu'au premier geste utilisateur, comme l'exige Safari.
 * Tout est désactivable depuis Profil.
 */

import { config } from '../config.js';

const FILES = {
  tap:        'tap.wav',
  select:     'select.wav',
  toggle:     'toggle.wav',
  sheetOpen:  'sheet-open.wav',
  sheetClose: 'sheet-close.wav',
  back:       'back.wav',
  launch:     'launch.wav',
  success:    'success.wav',
  alert:      'alert.wav',
  warn:       'warn.wav',
  error:      'error.wav',
};

const VOLUME = {
  tap: 0.18, select: 0.22, toggle: 0.2, sheetOpen: 0.25, sheetClose: 0.2,
  back: 0.2, launch: 0.3, success: 0.32, alert: 0.35, warn: 0.28, error: 0.3,
};

let ctx = null;
const buffers = new Map();
const pending = new Map();

const prefs = { sound: true, haptics: true };

export function setFeedbackPrefs({ sound, haptics }) {
  if (typeof sound === 'boolean') prefs.sound = sound;
  if (typeof haptics === 'boolean') prefs.haptics = haptics;
}

function audioContext() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

async function load(name) {
  if (buffers.has(name)) return buffers.get(name);
  if (pending.has(name)) return pending.get(name);

  const context = audioContext();
  const file = FILES[name];
  if (!context || !file) return null;

  const task = fetch(new URL(`../../sounds/${file}`, import.meta.url))
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((buf) => context.decodeAudioData(buf))
    .then((decoded) => { buffers.set(name, decoded); return decoded; })
    .catch(() => null)          // un son absent ne doit jamais casser l'app
    .finally(() => pending.delete(name));

  pending.set(name, task);
  return task;
}

/** Réveille le contexte audio au premier geste (contrainte iOS). */
export function unlockAudio() {
  const context = audioContext();
  if (context && context.state === 'suspended') context.resume().catch(() => {});
  // Préchargement des sons les plus fréquents, une seule fois.
  ['tap', 'select', 'sheetOpen', 'sheetClose'].forEach(load);
}

export async function play(name) {
  if (!prefs.sound) return;
  const context = audioContext();
  if (!context) return;
  if (context.state === 'suspended') { try { await context.resume(); } catch { return; } }

  const buffer = await load(name);
  if (!buffer) return;

  const source = context.createBufferSource();
  const gain = context.createGain();
  gain.gain.value = VOLUME[name] ?? 0.2;
  source.buffer = buffer;
  source.connect(gain).connect(context.destination);
  source.start(0);
}

/**
 * Vibration. iOS Safari n'expose pas navigator.vibrate ; l'appel est donc
 * silencieusement sans effet là-bas — d'où l'absence de promesse de haptique
 * dans l'interface (§51 : ne rien prétendre qu'on ne fait pas).
 */
export function haptic(pattern = 8) {
  if (!prefs.haptics) return;
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* ignoré */ }
  }
}

export const feedback = {
  tap()        { play('tap');        haptic(6); },
  select()     { play('select');     haptic(8); },
  toggle()     { play('toggle');     haptic(10); },
  sheetOpen()  { play('sheetOpen');  haptic(10); },
  sheetClose() { play('sheetClose'); haptic(6); },
  back()       { play('back');       haptic(6); },
  launch()     { play('launch');     haptic([10, 40, 12]); },
  success()    { play('success');    haptic([12, 40, 12]); },
  alert()      { play('alert');      haptic([16, 60, 16]); },
  warn()       { play('warn');       haptic([20, 50, 20]); },
  error()      { play('error');      haptic([28, 60, 28]); },
};

/**
 * Délégation globale : tout élément portant [data-sound] joue son effet.
 * Évite de câbler le son composant par composant.
 */
export function installGlobalFeedback(root = document) {
  const onFirst = () => { unlockAudio(); root.removeEventListener('pointerdown', onFirst); };
  root.addEventListener('pointerdown', onFirst, { once: true });

  root.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('[data-sound]');
    if (!target) return;
    const kind = target.dataset.sound || 'tap';
    if (typeof feedback[kind] === 'function') feedback[kind]();
  }, { passive: true });
}
