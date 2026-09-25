// Offline shell for the installed app (PWA).
//
// Rules, in order of how much trouble they can cause:
// - /api/** is never touched. Notes must never come from a cache.
// - /assets/** carries a content hash in its name, so it can be cached
//   forever and served cache-first.
// - everything else (index.html and friends) is network-first, falling back
//   to the cache only when the network fails, so a deploy is picked up on the
//   next load instead of being pinned to an old build.
const CACHE = 'notex-shell-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ??
          fetch(e.request).then((res) => {
            const copy = res.clone()
            if (res.ok) void caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          }),
      ),
    )
    return
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone()
        if (res.ok) void caches.open(CACHE).then((c) => c.put(e.request, copy))
        return res
      })
      .catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('/'))),
  )
})
