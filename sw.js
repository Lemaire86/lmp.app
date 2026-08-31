/* ==============================================================
   sw.js — Service worker minimal.
   Li sèlman mete "koki" app la (HTML/CSS/JS/logo) nan cache pou
   enstalasyon/demaraj rapid ak yon ti sipò offline pou entèfas la.
   Li PA janm entèsepte stream videyo/odyo (m3u8, mpd, segman
   .ts/.mp4, elt.) — sa ta ka kraze lekti anliy/live la.
   ============================================================== */
const CACHE_NAME = 'lmp-mobile-shell-v8';
const SHELL_FILES = [
  './src/index.html',
  './src/styles.css',
  './src/mobile.css',
  './src/renderer.js',
  './src/mobile-shim.js',
  './src/mobile-enhancements.js',
  './assets/vendor/hls.min.js',
  './assets/vendor/dash.all.min.js',
  './assets/icon.png',
  './assets/logo.png',
  './manifest.json'
];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const isShellFile = SHELL_FILES.some((f) => req.url.endsWith(f.replace('./', '/')));
  if (!isShellFile) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' }).then((res) => {
      if (res && res.ok) {
        const resToCache = res.clone(); // clone IMEDYATMAN, anvan okenn lòt "await"
        caches.open(CACHE_NAME).then((c) => c.put(req, resToCache));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});

/* ==============================================================
   sw.js — Service worker minimal.
   Li sèlman mete "koki" app la (HTML/CSS/JS/logo) nan cache pou
   enstalasyon/demaraj rapid ak yon ti sipò offline pou entèfas la.
   Li PA janm entèsepte stream videyo/odyo (m3u8, mpd, segman
   .ts/.mp4, elt.) — sa ta ka kraze lekti anliy/live la.
   ============================================================== */
const CACHE_NAME = 'lmp-mobile-shell-v8';
const SHELL_FILES = [
  './src/index.html',
  './src/styles.css',
  './src/mobile.css',
  './src/renderer.js',
  './src/mobile-shim.js',
  './src/mobile-enhancements.js',
  './assets/vendor/hls.min.js',
  './assets/vendor/dash.all.min.js',
  './assets/icon.png',
  './assets/logo.png',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {})
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
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const isShellFile = SHELL_FILES.some((f) => req.url.endsWith(f.replace('./', '/')));
  if (!isShellFile) return;

  event.respondWith(
    fetch(req, { cache: 'no-store' }).then((res) => {
      if (res && res.ok) {
        const resToCache = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, resToCache));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
