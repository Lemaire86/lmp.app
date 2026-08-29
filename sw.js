/* ==============================================================
   sw.js — Service worker minimal.
   Li sèlman mete "koki" app la (HTML/CSS/JS/logo) nan cache pou
   enstalasyon/demaraj rapid ak yon ti sipò offline pou entèfas la.
   Li PA janm entèsepte stream videyo/odyo (m3u8, mpd, segman
   .ts/.mp4, elt.) — sa ta ka kraze lekti anliy/live la.
   ============================================================== */
const CACHE_NAME = 'lmp-mobile-shell-v6';
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
      .catch(() => {}) // pa bloke enstalasyon an si youn nan fichye yo pa jwenn
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

/* ⚠️ REZOUD BOUG KACH: anvan, estrateji a te "cached || network" — sa te fè
   navigatè a montre KOUNYE A yon vèsyon KI DEJA DEPASE pou fichye "koki" yo
   (HTML/CSS/JS), e li te SÈLMAN mete jou an background POU PWOCHEN vizit la.
   Rezilta: chak fwa mwen korije yon bagay, itilizatè a te wè vèsyon an RETA
   yon vizit, e kèk fichye (tankou mobile-enhancements.js, ki pa t nan lis
   SHELL_FILES anvan) pa t janm pase nan kach la — sa te lakòz konpòtman
   melanje/enkoyeran ant ansyen ak nouvo kòd. Kounye a estrateji a se
   "NETWORK FIRST": eseye chaje dènye vèsyon an sou entènèt an premye, e
   sèlman sèvi ak kopi an kach la si aparèy la OFFLINE (san entènèt). Konsa
   itilizatè a toujou wè dènye chanjman yo depi li gen konneksyon. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Sèlman jere demand GET ki fèt sou menm orijin ak app la.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const isShellFile = SHELL_FILES.some((f) => req.url.endsWith(f.replace('./', '/')));
  if (!isShellFile) return; // kite tout rès la (stream, playlist m3u dinamik, elt.) pase dirèkteman

  event.respondWith(
    fetch(req, { cache: 'no-store' }).then((res) => {
      if (res && res.ok) caches.open(CACHE_NAME).then((c) => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req))
  );
});
