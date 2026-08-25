/**
 * WALLET · Point d'entrée
 *
 * Enchaînement au démarrage :
 *   1. thème appliqué avant tout rendu (pas de flash blanc)
 *   2. backend choisi (Supabase si configuré, démonstration sinon)
 *   3. session vérifiée → écran de connexion ou application
 *   4. préférences appliquées, routes déclarées, service worker enregistré
 */

import { h, mount, $ } from './lib/dom.js';
import { bootTheme, applyTheme } from './lib/theme.js';
import { installGlobalFeedback, setFeedbackPrefs, feedback } from './lib/feedback.js';
import { defineRoute, start, navigate, refresh } from './lib/router.js';
import { bottomNav } from './components/nav.js';
import { toast } from './lib/toast.js';
import { config, isConfigured } from './config.js';
import * as repo from './data/repo.js';

import { homeScreen } from './screens/home.js';
import { marketsScreen, assetScreen } from './screens/markets.js';
import { portfolioScreen } from './screens/portfolio.js';
import { opportunitiesScreen } from './screens/opportunities.js';
import { profileScreen, engineScreen, categoriesScreen } from './screens/profile.js';
import { bankingScreen, toClassifyScreen, recurringScreen, rulesScreen } from './screens/banking.js';
import { accountsScreen } from './screens/accounts.js';
import { alertsScreen, goalsScreen } from './screens/alerts.js';
import { authScreen } from './screens/auth.js';

const root = document.getElementById('app');

bootTheme();
installGlobalFeedback();

boot().catch((error) => {
  console.error('[wallet] démarrage impossible', error);
  mount(root, h('main.screen',
    h('div.empty',
      h('div.empty__emoji', '💥'),
      h('div.empty__title', 'WALLET n’a pas pu démarrer'),
      h('p.muted', error.message),
      h('button.btn.btn--primary', {
        style: { marginTop: '24px' },
        onclick: () => window.location.reload(),
      }, 'Réessayer'),
    ),
  ));
});

async function boot() {
  await repo.initBackend();

  let session = null;
  try {
    session = await repo.getSession();
  } catch (error) {
    // Serveur injoignable : on le dit, on ne bascule pas silencieusement en démo.
    if (isConfigured()) {
      mount(root, h('main.screen',
        h('div.empty',
          h('div.empty__emoji', '📡'),
          h('div.empty__title', 'Serveur injoignable'),
          h('p.muted', 'Vérifiez votre connexion, ou l’URL de votre projet Supabase.'),
          h('button.btn.btn--primary', {
            style: { marginTop: '24px' }, onclick: () => window.location.reload(),
          }, 'Réessayer'),
        ),
      ));
      return;
    }
  }

  if (!session) {
    mount(root, authScreen({
      onDemo: () => {
        // Le mode démonstration est un choix explicite, jamais un repli discret.
        feedback.launch();
        localStorage.setItem('wallet.demo.optin', '1');
        window.location.reload();
      },
    }));
    registerServiceWorker();
    return;
  }

  await applySettings();
  installRoutes();

  mount(root, h('div'));
  const outlet = h('div');
  root.append(outlet, bottomNav());
  start(outlet);

  registerServiceWorker();
  watchConnection();
  watchAuth();
}

/* — Préférences ————————————————————————————————————— */

async function applySettings() {
  try {
    const settings = await repo.getSettings();

    applyTheme(settings.theme ?? 'dark');
    document.body.dataset.blur = settings.privacy_blur ? 'on' : 'off';
    setFeedbackPrefs({
      sound: settings.sound_enabled !== false,
      haptics: settings.haptics_enabled !== false,
    });

    if (settings.base_currency) config.defaultCurrency = settings.base_currency;
    if (settings.locale) config.defaultLocale = settings.locale;
    document.documentElement.lang = (settings.locale ?? 'fr-FR').slice(0, 2);
  } catch (error) {
    console.warn('[wallet] préférences non chargées', error);
  }
}

/* — Routes ————————————————————————————————————————— */

function installRoutes() {
  defineRoute('/', homeScreen);

  defineRoute('/marches', marketsScreen);
  defineRoute('/marches/:id', assetScreen);

  defineRoute('/portefeuille', portfolioScreen);
  defineRoute('/opportunites', opportunitiesScreen);

  defineRoute('/banque', bankingScreen);
  defineRoute('/banque/a-classer', toClassifyScreen);
  defineRoute('/banque/recurrent', recurringScreen);
  defineRoute('/banque/regles', rulesScreen);

  defineRoute('/profil', profileScreen);
  defineRoute('/profil/comptes', accountsScreen);
  defineRoute('/profil/categories', categoriesScreen);
  defineRoute('/profil/moteur', engineScreen);
  defineRoute('/profil/alertes', alertsScreen);
  defineRoute('/profil/objectifs', goalsScreen);
}

/* — Service worker ————————————————————————————————— */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              // Une mise à jour est prête : on propose, on n'impose pas —
              // recharger au milieu d'une saisie serait hostile.
              toast('Mise à jour disponible. Touchez pour l’appliquer.', { duration: 8000 });
              document.querySelector('.toast')?.addEventListener('click', () => {
                installing.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              });
            }
          });
        });
      })
      .catch((error) => console.warn('[wallet] service worker non enregistré', error));
  });
}

/* — Connexion ————————————————————————————————————— */

function watchConnection() {
  let offlineToast = null;

  window.addEventListener('offline', () => {
    offlineToast = toast('Hors connexion. Les données affichées peuvent être anciennes.',
      { duration: 60000 });
  });

  window.addEventListener('online', () => {
    offlineToast?.();
    offlineToast = null;
    repo.invalidate();
    toast('Connexion rétablie', { kind: 'success' });
    refresh();
  });
}

/* — Session ————————————————————————————————————————— */

function watchAuth() {
  repo.onAuthChange((event) => {
    if (event === 'SIGNED_OUT') window.location.reload();
  });
}

/* — Installation iOS ————————————————————————————————
   iOS n'expose pas beforeinstallprompt : on ne peut donc pas déclencher
   l'installation depuis le code. On se contente d'un rappel discret, une
   seule fois, plutôt que de promettre un bouton magique (§51).            */

if (!window.matchMedia('(display-mode: standalone)').matches
    && !window.navigator.standalone
    && /iPhone|iPad/.test(navigator.userAgent)) {
  const seen = (() => { try { return localStorage.getItem('wallet.installHint'); } catch { return '1'; } })();
  if (!seen) {
    setTimeout(() => {
      toast('Astuce : Partager → « Sur l’écran d’accueil » pour installer WALLET.', { duration: 7000 });
      try { localStorage.setItem('wallet.installHint', '1'); } catch { /* ignoré */ }
    }, 4000);
  }
}
