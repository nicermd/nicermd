// Service worker — keeps the app shell working offline and makes repeat
// loads instant. Two strategies:
//
//   - Navigation requests (HTML): network-first. The cached HTML
//     references hashed bundle names that change every build, so a
//     stale HTML would point at bundles the new deploy no longer
//     serves. Network-first keeps users on the latest HTML when
//     online; cache is the offline fallback only.
//   - Everything else same-origin (JS, CSS, images): stale-while-
//     revalidate. Hashed assets are immutable so cache-first is
//     correct; the background refresh handles overwriting on rare
//     content changes (favicons, manifest).
//
// Cross-origin requests (raw.githubusercontent.com, fonts, etc.) pass
// straight through — those handle their own caching and we don't want
// to widen the attack surface by mediating them.
//
// Bump CACHE_VERSION on each release so old caches are evicted. The
// SW lifecycle handles the rest: install → activate → claim → start
// serving from the new cache, then drop the old one.

const CACHE_VERSION = 'v0.1.15-alpha'
const CACHE_NAME = `nicermd-${CACHE_VERSION}`

// Boot-time assets we know by name. The hashed JS/CSS bundles aren't
// in this list — they get cached on first runtime fetch via the
// stale-while-revalidate handler below. Trade-off: a brand-new
// offline visit won't have the bundles, but any prior online visit
// populates the cache.
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico',
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
      // Navigation requests (HTML) — network-first. Stale HTML
      // would reference hashed bundle names the new deploy no
      // longer serves, so we always try fresh first; cache is
      // the offline fallback. SW shipped before alpha-4 used
      // stale-while-revalidate here, which gave users an
      // hours-old HTML in PWA installs after every deploy.
      if (req.mode === 'navigate') {
        try {
          const fresh = await fetch(req)
          if (fresh.ok && fresh.type === 'basic') {
            cache.put(req, fresh.clone()).catch(() => {})
          }
          return fresh
        } catch {
          const cached = await cache.match(req)
          if (cached) return cached
          const shell = await cache.match('/')
          if (shell) return shell
          return new Response('Offline and not cached', { status: 503, statusText: 'Offline' })
        }
      }

      // Everything else — stale-while-revalidate. Hashed bundles
      // are immutable so cache-first is correct.
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
        network.catch(() => {})
        return cached
      }

      const fresh = await network
      if (fresh) return fresh
      return new Response('Offline and not cached', { status: 503, statusText: 'Offline' })
    })
  )
})
