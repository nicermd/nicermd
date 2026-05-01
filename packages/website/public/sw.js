// Service worker — keeps the app shell working offline and makes repeat
// loads instant. Strategy is deliberately small: precache the static
// boot-time assets, stale-while-revalidate for everything else
// same-origin, and stay out of the way for cross-origin requests
// (raw.githubusercontent.com, fonts, etc. — those stay network-only,
// matching the strict-CSP posture).
//
// Bump CACHE_VERSION on each release so old caches are evicted. The
// SW lifecycle handles the rest: install → activate → claim → start
// serving from the new cache, then drop the old one.

const CACHE_VERSION = 'v0.1-alpha-3'
const CACHE_NAME = `nicermd-${CACHE_VERSION}`

// Boot-time assets we know by name. The hashed JS/CSS bundles aren't
// in this list — they get cached on first runtime fetch via the
// stale-while-revalidate handler below. Trade-off: a brand-new
// offline visit won't have the bundles, but any prior online visit
// populates the cache.
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/favicon-32.png',
  '/favicon-192.png',
  '/favicon-256.png',
  '/favicon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('nicermd-') && k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Cross-origin: stay out of the way. raw.githubusercontent.com,
  // fonts.googleapis.com, etc. handle their own caching and we don't
  // want to widen the attack surface by mediating them.
  if (url.origin !== self.location.origin) return

  // Don't try to cache opaque/streamed responses or range requests.
  if (req.headers.has('range')) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            cache.put(req, res.clone()).catch(() => {})
          }
          return res
        })
        .catch(() => undefined)

      if (cached) {
        // Background-refresh; don't await.
        network.catch(() => {})
        return cached
      }

      const fresh = await network
      if (fresh) return fresh

      // Last-resort: serve the cached shell for navigations so the
      // app at least boots offline.
      if (req.mode === 'navigate') {
        const shell = await cache.match('/')
        if (shell) return shell
      }
      return new Response('Offline and not cached', { status: 503, statusText: 'Offline' })
    })
  )
})
