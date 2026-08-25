/**
 * WALLET · Authentification (Phase 3)
 *
 * Supabase Auth, avec trois entrées : mot de passe, lien magique, création de
 * compte. Rien de sensible ici : la clé "anon" est publique par conception,
 * c'est la RLS qui protège les données.
 *
 * L'écran permet aussi de renseigner l'URL du projet Supabase, pour qu'on
 * puisse installer la PWA et la connecter depuis le téléphone, sans toucher
 * au code.
 */

import { h, mount } from '../lib/dom.js';
import { toast } from '../lib/toast.js';
import { openSheet } from '../lib/sheet.js';
import { config, saveConfig, isConfigured } from '../config.js';
import * as repo from '../data/repo.js';

export function authScreen({ onDemo } = {}) {
  const screen = h('main.screen', { style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100dvh' } });

  const brand = h('div', { style: { textAlign: 'center', marginBottom: '40px' } },
    h('div', { style: { fontSize: '52px', marginBottom: '12px' } }, '◈'),
    h('h1', { style: { fontSize: '30px', fontWeight: '700', letterSpacing: '-.03em' } }, 'WALLET'),
    h('p.muted', { style: { marginTop: '6px' } }, 'Votre patrimoine, simplement.'),
  );

  const form = h('div');
  screen.append(brand, form);

  if (!isConfigured()) {
    mount(form, notConfiguredPanel(onDemo));
    return screen;
  }

  mount(form, signInPanel());
  return screen;
}

/* — Aucun serveur renseigné ————————————————————————— */

function notConfiguredPanel(onDemo) {
  return h('div',
    h('div.notice', { style: { marginBottom: '24px' } },
      h('span', '🔌'),
      h('div',
        h('strong', 'Aucun serveur configuré'),
        'WALLET a besoin d’un projet Supabase pour stocker vos données. Il est gratuit et vous en restez propriétaire.',
      ),
    ),

    h('button.btn.btn--primary.btn--block', {
      type: 'button', 'data-sound': 'select',
      onclick: () => openServerSheet(),
    }, 'Connecter mon serveur Supabase'),

    h('button.btn.btn--ghost.btn--block', {
      type: 'button', 'data-sound': 'launch', style: { marginTop: '12px' },
      onclick: () => onDemo?.(),
    }, 'Essayer en mode démonstration'),

    h('p.explain__source', { style: { marginTop: '24px', textAlign: 'center' } },
      'Le mode démonstration utilise des données simulées, stockées uniquement sur cet appareil.'),
  );
}

export function openServerSheet() {
  openSheet({
    title: 'Connecter mon serveur',
    build: ({ close }) => {
      const url = h('input', {
        type: 'url', placeholder: 'https://xxxx.supabase.co',
        value: config.supabaseUrl || '', required: true,
        autocapitalize: 'off', autocorrect: 'off', spellcheck: false,
      });
      const key = h('input', {
        type: 'text', placeholder: 'eyJhbGciOi…',
        value: config.supabaseAnonKey || '', required: true,
        autocapitalize: 'off', autocorrect: 'off', spellcheck: false,
      });
      const error = h('div.field__error');

      return h('form', {
        onsubmit: (event) => {
          event.preventDefault();
          const trimmedUrl = url.value.trim().replace(/\/+$/, '');
          const trimmedKey = key.value.trim();

          if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(trimmedUrl)) {
            error.textContent = 'L’URL doit ressembler à https://votreprojet.supabase.co';
            return;
          }
          if (trimmedKey.length < 40) {
            error.textContent = 'Cette clé semble incomplète.';
            return;
          }

          saveConfig({ supabaseUrl: trimmedUrl, supabaseAnonKey: trimmedKey });
          close();
          toast('Serveur enregistré', { kind: 'success' });
          setTimeout(() => window.location.reload(), 500);
        },
      },
        h('p.muted', { style: { fontSize: 'var(--fs-sm)' } },
          'Ces deux valeurs se trouvent dans votre projet Supabase, onglet Settings → API.'),

        h('div.field', { style: { marginTop: '20px' } },
          h('label', 'URL du projet'), url),
        h('div.field',
          h('label', 'Clé publique (anon)'), key,
          h('div.field__hint',
            'Cette clé est PUBLIQUE par conception : elle ne donne accès à rien sans authentification, et les politiques de sécurité de la base font le reste. Ne collez jamais ici la clé « service_role ».')),
        error,
        h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
          'Enregistrer'),
      );
    },
  });
}

/* — Connexion ————————————————————————————————————————— */

function signInPanel() {
  let mode = 'signin';
  const container = h('div');

  const paint = () => {
    const email = h('input', {
      type: 'email', placeholder: 'vous@exemple.fr', required: true,
      autocomplete: 'email', autocapitalize: 'off', spellcheck: false,
    });
    const password = h('input', {
      type: 'password', placeholder: '••••••••',
      autocomplete: mode === 'signup' ? 'new-password' : 'current-password',
      minlength: 8,
    });
    const name = h('input', { type: 'text', placeholder: 'Votre prénom', autocomplete: 'given-name' });
    const error = h('div.field__error');
    const submit = h('button.btn.btn--primary.btn--block', { type: 'submit', 'data-sound': 'select' },
      ({ signin: 'Se connecter', signup: 'Créer mon compte', magic: 'Recevoir un lien' })[mode]);

    const form = h('form', {
      onsubmit: async (event) => {
        event.preventDefault();
        error.textContent = '';
        submit.disabled = true;
        submit.textContent = 'Un instant…';

        try {
          if (mode === 'magic') {
            await repo.signInWithMagicLink(email.value.trim());
            mount(container, h('div.notice',
              h('span', '📬'),
              h('div', h('strong', 'Lien envoyé'),
                `Ouvrez le message envoyé à ${email.value.trim()} depuis cet appareil pour vous connecter.`)));
            return;
          }

          if (mode === 'signup') {
            await repo.signUp(email.value.trim(), password.value, name.value.trim());
            // Selon le réglage Supabase, la session peut être immédiate ou
            // nécessiter une confirmation par e-mail : on ne présume de rien.
            const session = await repo.getSession();
            if (session) {
              await repo.seedDefaults().catch(() => {});
              window.location.reload();
            } else {
              mount(container, h('div.notice',
                h('span', '📬'),
                h('div', h('strong', 'Compte créé'),
                  'Confirmez votre adresse depuis le message que vous venez de recevoir, puis revenez ici.')));
            }
            return;
          }

          await repo.signIn(email.value.trim(), password.value);
          window.location.reload();
        } catch (e) {
          error.textContent = humanError(e);
          submit.disabled = false;
          submit.textContent = ({ signin: 'Se connecter', signup: 'Créer mon compte', magic: 'Recevoir un lien' })[mode];
        }
      },
    },
      mode === 'signup' ? h('div.field', h('label', 'Prénom'), name) : null,
      h('div.field', h('label', 'Adresse e-mail'), email),
      mode !== 'magic'
        ? h('div.field', h('label', 'Mot de passe'), password,
            mode === 'signup' ? h('div.field__hint', 'Au moins 8 caractères.') : null)
        : null,
      error,
      submit,
    );

    mount(container,
      form,
      h('div', { style: { display: 'grid', gap: '4px', marginTop: '20px' } },
        mode !== 'signin' ? link('J’ai déjà un compte', () => { mode = 'signin'; paint(); }) : null,
        mode !== 'signup' ? link('Créer un compte', () => { mode = 'signup'; paint(); }) : null,
        mode !== 'magic' ? link('Se connecter sans mot de passe', () => { mode = 'magic'; paint(); }) : null,
        mode === 'signin' ? link('Mot de passe oublié', async () => {
          const address = prompt('Votre adresse e-mail ?');
          if (!address) return;
          try {
            await repo.resetPassword(address.trim());
            toast('Message de réinitialisation envoyé', { kind: 'success' });
          } catch (e) { toast(humanError(e), { kind: 'error' }); }
        }) : null,
      ),

      h('div', { style: { marginTop: '28px', paddingTop: '20px', borderTop: '1px solid var(--hairline)', textAlign: 'center' } },
        link('Changer de serveur', () => openServerSheet()),
      ),
    );
  };

  paint();
  return container;
}

function link(label, onClick) {
  return h('button.btn.btn--ghost.btn--block', {
    type: 'button', 'data-sound': 'tap',
    style: { minHeight: '44px', fontSize: 'var(--fs-sm)' },
    onclick: onClick,
  }, label);
}

/** Traduit les messages Supabase, qui sont en anglais et peu parlants. */
function humanError(error) {
  const message = String(error?.message || '');
  if (/Invalid login credentials/i.test(message)) return 'Adresse e-mail ou mot de passe incorrect.';
  if (/Email not confirmed/i.test(message)) return 'Confirmez d’abord votre adresse depuis le message reçu.';
  if (/User already registered/i.test(message)) return 'Un compte existe déjà avec cette adresse.';
  if (/Password should be at least/i.test(message)) return 'Le mot de passe doit faire au moins 8 caractères.';
  if (/rate limit|too many/i.test(message)) return 'Trop de tentatives. Réessayez dans quelques minutes.';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'Serveur injoignable. Vérifiez l’URL et votre connexion.';
  return message || 'Connexion impossible.';
}
