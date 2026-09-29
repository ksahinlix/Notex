// Offline shell for the installed app (PWA).
//
// Rules, in order of how much trouble they can cause:
// - /api/** is never touched. Notes must never come from a cache.
// - /assets/** carries a content hash in its name, so it can be cached
//   forever and served cache-first.
// - everything else (index.html and friends) is network-first, falling back
//   to the cache only when the network fails, so a deploy is picked up on the
//   next load instead of being pinned to an old build.
const CACHE = 'notex-shell-v2'

// The fonts are taken at install time, not on first use: the ones in the
// page's <head> are requested before this worker is running, so they would
// otherwise be missing exactly when the network is. Keep in step with
// src/fonts.css.
const FONTS = [
  'fraunces-600-latin.woff2',
  'fraunces-600-latin-ext.woff2',
  'instrument-sans-400-latin.woff2',
  'instrument-sans-400-latin-ext.woff2',
  'instrument-sans-500-latin.woff2',
  'instrument-sans-500-latin-ext.woff2',
  'instrument-sans-600-latin.woff2',
  'instrument-sans-600-latin-ext.woff2',
].map((f) => `/fonts/${f}`)

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', ...FONTS]))
      .then(() => self.skipWaiting()),
  )
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

  // /fonts/** is named per family, weight and subset and only changes when we
  // regenerate it, so it is cached like /assets/**.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
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

// ---- reminder notifications (D21) ----
// The server sends {title, body, noteId, at}; anything unreadable still shows
// something rather than nothing.
self.addEventListener('push', (e) => {
  let data = {}
  try {
    data = e.data ? e.data.json() : {}
  } catch {
    data = { body: e.data?.text?.() }
  }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Notex', {
      body: data.body || 'Hatırlatman var.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.noteId ? `reminder-${data.noteId}` : undefined, // one per reminder, not a pile
      renotify: !!data.noteId,
      data: { url: '/#hatirlatmalar', noteId: data.noteId ?? null },
      lang: 'tr',
    }),
  )
})

// Tapping it opens the reminders page, reusing a tab that is already open.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin)) return c.focus().then((w) => w.navigate?.(url) ?? w)
      }
      return self.clients.openWindow(url)
    }),
  )
})
