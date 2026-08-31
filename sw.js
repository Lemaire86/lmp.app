const CACHE_NAME = 'lmp-mobile-shell-v9';
const SHELL_FILES = [
  '/src/index.html',
  '/src/styles.css',
  '/src/mobile.css',
  '/src/renderer.js',
  '/src/mobile-shim.js',
  '/src/mobile-enhancements.js',
  '/assets/icon.png',
  '/assets/logo.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const pathname = url.pathname;
  const isShellFile = SHELL_FILES.some((f) => pathname.endsWith(f.replace('./', '/')));

  if (!isShellFile) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then((res) => {
        if (res && res.ok) {
          caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
