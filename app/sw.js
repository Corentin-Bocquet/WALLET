/**
 * WALLET · Service worker
 *
 * Stratégie assumée, différente selon la nature de la ressource :
 *
 *   · coquille de l'app (HTML, CSS, JS, icônes, sons) → cache d'abord,
 *     mise à jour en arrière-plan. L'application s'ouvre instantanément et
 *     fonctionne hors connexion.
 *
 *   · appels à Supabase → réseau UNIQUEMENT. Jamais de cache : afficher un
 *     solde périmé sans le dire violerait la règle de fraîcheur (§45), et
 *     mettre en cache des données financières personnelles dans le stockage
 *     du navigateur est un risque inutile.
 *
 * Rien n'est mis en cache pour les requêtes authentifiées, même en lecture.
 */

const VERSION = 'wallet-v1.0.6';
const SHELL = `${VERSION}-shell`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/main.js',
  './js/config.js',
  './js/lib/currency.js',
  // Les écrans sont chargés à la demande par le routeur ; on les met malgré
  // tout dans la coquille, sinon un premier lancement hors connexion
  // n'afficherait que l'accueil.
  './js/screens/home.js',
  './js/screens/markets.js',
  './js/screens/portfolio.js',
  './js/screens/opportunities.js',
  './js/screens/profile.js',
  './js/screens/banking.js',
  './js/screens/accounts.js',
  './js/screens/alerts.js',
  './js/screens/assistant.js',
  './js/data/repo.js',
  './js/data/glossary.js',
  './icons/icon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll échoue en bloc si une seule ressource manque : on tolère les
    // absences pour ne jamais empêcher l'installation.
    await Promise.all(SHELL_ASSETS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('wallet-') && !name.startsWith(VERSION))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Données personnelles et API externes : jamais de cache.
  if (isDataRequest(url)) return;

  // Même origine seulement : on ne s'interpose pas sur des tiers.
  if (url.origin !== self.location.origin) return;

  // Navigation : on sert la coquille, l'application gère ses propres états
  // d'erreur et de fraîcheur une fois démarrée.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', response.clone());
        return response;
      } catch {
        return (await caches.match('./index.html'))
          ?? new Response('Hors connexion', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

function isDataRequest(url) {
  return url.hostname.endsWith('.supabase.co')
      || url.hostname.endsWith('.supabase.in')
      || url.pathname.includes('/rest/v1/')
      || url.pathname.includes('/auth/v1/')
      || url.pathname.includes('/functions/v1/')
      || url.pathname.includes('/storage/v1/');
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Le cache répond tout de suite ; le réseau met à jour pour la prochaine fois.
  if (cached) { network.catch(() => {}); return cached; }

  const response = await network;
  return response ?? new Response('', { status: 504 });
}
