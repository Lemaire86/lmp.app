/* ==============================================================
   mobile-shim.js
   Ranplase pon Electron an (preload.js / window.lmp) ak yon vèsyon
   ki mache nan yon navigatè mobil (pa gen aksè Node.js/fs/IPC).
   renderer.js pa modifye pou anyen ki pa gen rapò ak sa — li kontinye
   rele window.lmp.xxx() menm jan an, se sèlman enplemantasyon an
   anba a ki chanje pou l sèvi ak API navigatè yo (File, Blob,
   localStorage, fetch...).
   ============================================================== */
(function () {
  'use strict';

  // Fichye lokal yo pa gen yon "chemen" reyèl sou mobil (yo se objè
  // File/Blob soti nan yon <input type=file>). Nou envante yon
  // "pseudo-chemen" ki gen non fichye a ladan l (pou ekstansyon an
  // ka rekonèt), e nou kenbe File reyèl la nan yon Map.
  const fileRegistry = new Map();
  let fileCounter = 0;
  function registerFile(file) {
    const id = 'local-blob://' + (fileCounter++) + '/' + encodeURIComponent(file.name);
    fileRegistry.set(id, file);
    return id;
  }

  function pickFiles({ multiple = true, directory = false, accept = '' } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (multiple) input.multiple = true;
      if (directory) { input.webkitdirectory = true; input.directory = true; }
      if (accept) input.accept = accept;
      input.style.position = 'fixed';
      input.style.top = '-1000px';
      input.style.opacity = '0';
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        resolve(files);
      }, { once: true });
      // Si moun nan anile pikè a san chwazi anyen, kèk navigatè pa
      // deklanche 'change' — ranmase input lan apre yon ti tan pou
      // pa kite yo trennen nan DOM la san rezon.
      document.body.appendChild(input);
      input.click();
    });
  }

  const CONFIG_KEY = 'lmp-mobile:config';
  function readConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch (e) { return {}; }
  }
  function writeConfig(cfg) {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* quota/private mode — ignore */ }
  }

  // Menm lis playlist ki vin avèk app la sou desktop la — sou mobil
  // yo chaje via fetch() (isRemote:true) paske pa gen aksè fs reyèl.
  const BUNDLED_PLAYLISTS = [
    { file: 'lmtv-live.m3u',   section: 'livetv', category: 'LMTV', pinned: true },
    { file: 'haiti.m3u',       section: 'livetv', category: 'Haiti' },
    { file: 'france.m3u',      section: 'livetv', category: 'France' },
    { file: 'usa.m3u',         section: 'livetv', category: 'USA' },
    { file: 'News.m3u',        section: 'livetv', category: 'News' },
    { file: 'Sports.m3u',      section: 'livetv', category: 'Sports' },
    { file: 'Movies.m3u',      section: 'livetv', category: 'Movies' },
    { file: 'Series.m3u',      section: 'livetv', category: 'Series' },
    { file: 'Kids.m3u',        section: 'livetv', category: 'Kids' },
    { file: 'Music.m3u',       section: 'livetv', category: 'Music' },
    { file: 'trace-music.m3u', section: 'livetv', category: 'Trace Music' },
    { file: 'Documentary.m3u', section: 'livetv', category: 'Documentary' },
    { file: 'Science.m3u',     section: 'livetv', category: 'Science' },
    { file: 'radio.m3u',       section: 'radio',  category: 'Radio' }
  ];

  function detectBrowserInfo() {
    const ua = navigator.userAgent || '';
    const m = ua.match(/Chrome\/([\d.]+)/) || ua.match(/Version\/([\d.]+).*Safari/) || ua.match(/Firefox\/([\d.]+)/);
    return m ? m[0] : 'Mobil';
  }

  window.lmp = {
    // Window controls: pa gen fenèt OS sou yon app mobil/navigatè — yo pa fè anyen.
    minimize: () => {},
    maximize: () => {},
    close: () => {},
    setAlwaysOnTop: async () => {},
    setOpacity: async () => {},
    enterMiniPlayer: async () => {},
    exitMiniPlayer: async () => {},

    getAppInfo: async () => ({ electron: 'N/A (Web)', chrome: detectBrowserInfo() }),
    getConfig: async () => readConfig(),
    setConfig: async (partial) => { const cfg = Object.assign(readConfig(), partial); writeConfig(cfg); return cfg; },
    relaunch: async () => { location.reload(); },
    clearCache: async () => {
      try {
        if (window.caches && caches.keys) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (e) { /* ignore */ }
    },

    openFiles: async () => {
      const files = await pickFiles({ multiple: true, accept: 'video/*,audio/*,.m3u,.m3u8,.mpd' });
      return files.map(registerFile);
    },
    openFolder: async () => {
      // Chwazi yon dosye antye sipòte sou Android Chrome, men PA disponib
      // sou iOS Safari (limit platfòm mobil, pa yon bug nan app la).
      const files = await pickFiles({ multiple: true, directory: true });
      return files.map(registerFile);
    },
    openSubtitle: async () => {
      const files = await pickFiles({ multiple: false, accept: '.srt,.vtt' });
      return files.length ? registerFile(files[0]) : null;
    },
    savePlaylist: async (defaultName) => defaultName || 'LMP-playlist.m3u8',

    writeFile: async (pseudoPath, content) => {
      // Pa gen "Save As" sou mobil — nou deklanche yon telechajman reyèl.
      const blob = new Blob([content], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pseudoPath || 'LMP-playlist.m3u8';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    },
    readFile: async (p) => {
      const file = fileRegistry.get(p);
      if (!file) throw new Error('Fichye a pa disponib ankò — chwazi l ankò.');
      return await file.text();
    },
    exists: async (p) => fileRegistry.has(p),
    dirname: async () => null, // pa gen dosye paran ki disponib pou yon File ki soti nan yon <input>
    resolvePath: async (base, rel) => rel, // pa gen rezolisyon chemen relatif reyèl sou mobil
    basename: async (p) => {
      try { return decodeURIComponent(String(p).split('/').pop()); } catch (e) { return String(p); }
    },
    toFileUrl: async (p) => {
      const file = fileRegistry.get(p);
      if (!file) return p; // deja yon URL (blob:/http(s):) — voye l tankou li ye a
      return URL.createObjectURL(file);
    },
    showInFolder: async () => {},
    openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return true; },
    getDefaultChannelsPath: async () => '../assets/playlists/lmtv-live.m3u',
    getBundledPlaylists: async () =>
      BUNDLED_PLAYLISTS.map((entry) => ({ ...entry, path: '../assets/playlists/' + entry.file })),

    // "Open with" OS-level pa aplikab menm jan an sou yon app/paj web mobil.
    onOpenMediaFiles: () => {},
    onOpenPlaylistFile: () => {},

    platform: 'mobile-web'
  };
})();
