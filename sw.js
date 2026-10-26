// Caches the app so it works offline, and receives videos shared from the
// Android share sheet (Web Share Target). Bump VERSION when files change.
const VERSION = 'v1';
const APP_CACHE = `app-${VERSION}`;
const APP_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'plan.js',
  'vendor/mediabunny.min.mjs',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(event.request));
    return;
  }

  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  // Network first so updates show up right away; fall back to cache offline.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(APP_CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});

async function receiveShare(request) {
  const data = await request.formData();
  const video = data.get('video');
  if (video && typeof video !== 'string') {
    const cache = await caches.open('shared-files');
    await cache.put('shared-video', new Response(video, {
      headers: { 'content-type': video.type, 'x-file-name': encodeURIComponent(video.name) },
    }));
  }
  return Response.redirect('./?shared=1', 303);
}
