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
import { glyph } from './components/icons.js';
import { toast } from './lib/toast.js';
import { config, isConfigured } from './config.js';
import * as repo from './data/repo.js';
import { setRates, onCurrencyChange } from './lib/currency.js';

import { authScreen } from './screens/auth.js';

/**
 * Les écrans sont chargés à la demande.
 *
 * Sans cela, ouvrir l'accueil télécharge aussi le portefeuille, les marchés,
 * les opportunités, le profil, la banque, les comptes et les alertes — soit
 * plus du double du code nécessaire au premier affichage. Sur un iPhone en 4G,
 * c'est la différence entre une ouverture immédiate et une attente.
 *
 * Chaque module n'est chargé qu'une fois ; le navigateur le met ensuite en
 * cache, et le service worker le conserve hors connexion.
 */
const lazy = (loader, name) => async (context) => {
  const module = await loader();
  return module[name](context);
};

const root = document.getElementById('app');

bootTheme();
installGlobalFeedback();

boot().catch((error) => {
  console.error('[wallet] démarrage impossible', error);
  mount(root, h('main.screen',
    h('div.empty',
      h('div.empty__emoji', glyph('alert')),
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

  // Les taux de change alimentent le basculement euro / dollar. Un échec ici
  // n'empêche pas l'application de démarrer : on reste simplement en euros.
  repo.getFxRates().then(setRates).catch(() => {});
  onCurrencyChange(() => refresh());

  let session = null;
  try {
    session = await repo.getSession();
  } catch (error) {
    // Serveur injoignable : on le dit, on ne bascule pas silencieusement en démo.
    if (isConfigured()) {
      mount(root, h('main.screen',
        h('div.empty',
          h('div.empty__emoji', glyph('clock')),
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
  autoSyncExchanges();
}

/* — Synchronisation à l'ouverture ——————————————————————
   Plutôt que d'attendre un geste sur le bouton du portefeuille, les
   exchanges connectés sont relancés en arrière-plan quand leur dernière
   synchronisation date de plus d'une heure. Le serveur limite déjà la
   fréquence ; un échec ici reste silencieux, le bouton manuel dit tout. */

const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

async function autoSyncExchanges() {
  if (repo.isDemoMode() || !navigator.onLine) return;
  try {
    const state = await repo.getSyncState();
    const stale = ['kraken', 'okx'].some((provider) => {
      const last = state[provider]?.last_success;
      // Aucune ligne = jamais synchronisé : syncExchanges() vérifie de lui-même
      // qu'une clé existe, et ne fait rien sinon.
      return !last || Date.now() - new Date(last).getTime() > AUTO_SYNC_AFTER_MS;
    });
    if (!stale) return;

    const results = await repo.syncExchanges();
    if (results.some((r) => r.ok)) refresh();
  } catch (error) {
    console.warn('[wallet] synchronisation automatique impossible', error);
  }
}

/* Pas de zoom au pincement
   iOS ignore « user-scalable=no » dans Safari : seuls ces événements
   propriétaires permettent de bloquer le pincement, qui déréglait la mise
   en page des écrans Marchés et Opportunités. */
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

/* Montants masqués : toucher pour révéler, retoucher pour masquer */

document.addEventListener('click', (event) => {
  if (document.body.dataset.blur !== 'on') return;
  const amount = event.target.closest?.('.sensitive');
  if (!amount) return;
  // Le toucher sert à révéler : il ne doit pas aussi ouvrir la ligne.
  event.preventDefault();
  event.stopPropagation();
  amount.classList.toggle('revealed');
}, true);

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
  const home = () => import('./screens/home.js');
  const markets = () => import('./screens/markets.js');
  const portfolio = () => import('./screens/portfolio.js');
  const opportunities = () => import('./screens/opportunities.js');
  const banking = () => import('./screens/banking.js');
  const profile = () => import('./screens/profile.js');
  const accounts = () => import('./screens/accounts.js');
  const alerts = () => import('./screens/alerts.js');

  defineRoute('/', lazy(home, 'homeScreen'));

  defineRoute('/marches', lazy(markets, 'marketsScreen'));
  defineRoute('/marches/:id', lazy(markets, 'assetScreen'));

  defineRoute('/portefeuille', lazy(portfolio, 'portfolioScreen'));
  defineRoute('/opportunites', lazy(opportunities, 'opportunitiesScreen'));

  defineRoute('/banque', lazy(banking, 'bankingScreen'));
  defineRoute('/banque/a-classer', lazy(banking, 'toClassifyScreen'));
  defineRoute('/banque/recurrent', lazy(banking, 'recurringScreen'));
  defineRoute('/banque/regles', lazy(banking, 'rulesScreen'));

  defineRoute('/profil', lazy(profile, 'profileScreen'));
  defineRoute('/profil/comptes', lazy(accounts, 'accountsScreen'));
  defineRoute('/profil/categories', lazy(profile, 'categoriesScreen'));
  defineRoute('/profil/moteur', lazy(profile, 'engineScreen'));
  defineRoute('/profil/alertes', lazy(alerts, 'alertsScreen'));
  defineRoute('/profil/objectifs', lazy(alerts, 'goalsScreen'));

  // Les écrans voisins sont préchargés une fois l'accueil affiché : la
  // navigation reste instantanée, sans peser sur le premier rendu.
  window.addEventListener('wallet:navigated', function preload() {
    window.removeEventListener('wallet:navigated', preload);
    requestIdleCallbackShim(() => { markets(); portfolio(); banking(); });
  });
}

const requestIdleCallbackShim = (fn) =>
  (window.requestIdleCallback ?? ((cb) => setTimeout(cb, 800)))(fn);

/* — Service worker ————————————————————————————————— */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;

  // L'enregistrement est repoussé après le chargement pour ne pas concurrencer
  // le premier rendu. Mais `boot()` est asynchrone : le temps qu'il choisisse
  // le backend et vérifie la session, l'événement `load` est souvent DÉJÀ
  // passé — et un écouteur ajouté après coup ne se déclenche jamais. Sans ce
  // test, le service worker n'était plus enregistré du tout : ni mode hors
  // connexion, ni installation sur l'écran d'accueil.
  if (document.readyState === 'complete') queueMicrotask(register);
  else window.addEventListener('load', register, { once: true });

  function register() {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' })
      .then((registration) => {
        // Sur iPhone, une app installée reste ouverte en arrière-plan des
        // jours entiers : sans ces vérifications, une correction publiée
        // n'arrivait jamais, l'ancienne version restait en cache.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });

        const apply = (worker) => {
          // La nouvelle version s'installe d'elle-même, sans attendre que
          // l'utilisateur touche un bandeau qu'il ne voyait pas.
          worker.postMessage({ type: 'SKIP_WAITING' });
        };
        if (registration.waiting && navigator.serviceWorker.controller) apply(registration.waiting);

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) apply(installing);
          });
        });

        // Nouvelle version active : on recharge aussitôt (le hash garde
        // l'écran en cours), pour ne jamais mélanger des fichiers de deux
        // versions. Seule exception, une saisie en cours : on attend qu'elle
        // se termine ou que l'app passe en arrière-plan.
        let reloading = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          const reload = () => { if (!reloading) { reloading = true; window.location.reload(); } };
          const typing = () => document.activeElement?.matches?.('input, textarea, select');
          if (!typing() || document.visibilityState === 'hidden') { reload(); return; }
          document.addEventListener('focusout', () => setTimeout(() => { if (!typing()) reload(); }, 300));
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') reload();
          });
        });
      })
      .catch((error) => console.warn('[wallet] service worker non enregistré', error));
  }
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
