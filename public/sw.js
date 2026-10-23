// Biirb hors ligne : le planificateur (pages, voyages, dépenses) reste consultable sans réseau.
// Lecture seule : seules les requêtes GET sont mises en cache ; les modifications exigent le réseau.
// Pages et données gardées seulement avec « Se souvenir de moi » (sinon la session finit sans déconnexion qui les efface) ;
// effacées à la déconnexion (src/client/session.ts).

const STATIC_CACHE = "brb-static-v1";
const PAGE_CACHE = "brb-pages";
const DATA_CACHE = "brb-data";
// Cache vide posé par src/client/session.ts tant que la session est « Se souvenir de moi ».
const REMEMBERED_MARKER = "brb-remembered";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("brb-static-") && key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(purgeIfNotRemembered)
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Fichiers versionnés par leur nom : jamais modifiés, le cache suffit.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetchAndStore(request, STATIC_CACHE)));
    return;
  }
  if (request.mode === "navigate" && url.pathname.startsWith("/planner")) {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }
  // Clé = URL seule : l'en-tête Authorization (token en mémoire, perdu hors ligne) n'est pas comparé.
  if (url.pathname.startsWith("/api/v1/trips")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  }
});

async function fetchAndStore(request, cacheName) {
  const response = await fetch(request);
  if (response.ok && (cacheName === STATIC_CACHE || (await caches.has(REMEMBERED_MARKER)))) {
    const cache = await caches.open(cacheName);
    await cache.put(request.url, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    return await fetchAndStore(request, cacheName);
  } catch (error) {
    // Données d'une session non mémorisée (cache d'une version précédente, réponse arrivée après la déconnexion) : jamais servies.
    if (await purgeIfNotRemembered()) throw error;
    const cached = await caches.match(request.url, { cacheName });
    if (cached) return cached;
    throw error;
  }
}

async function purgeIfNotRemembered() {
  if (await caches.has(REMEMBERED_MARKER)) return false;
  await Promise.all([caches.delete(PAGE_CACHE), caches.delete(DATA_CACHE)]);
  return true;
}
