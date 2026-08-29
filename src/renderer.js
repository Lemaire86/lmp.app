'use strict';

/* ============================== Constants ============================== */
const VIDEO_EXTS = ['mp4','webm','ogg','ogv','mov','mkv','avi','m4v','flv','3gp'];
const AUDIO_EXTS = ['mp3','wav','flac','aac','m4a','wma','opus','oga'];

const DEFAULT_SETTINGS = {
  // Playback
  autoAdvance: true,
  autoResume: true,
  defaultQuality: 'auto',
  defaultSpeed: 1,
  skipShort: 5,
  skipLong: 10,
  rememberVolume: true,
  autoFullscreen: false,
  // Video
  displayMode: 'fit',
  deinterlace: false,
  hardwareAcceleration: true,
  // Audio
  stereoMode: 'stereo',
  audioBoost: 100,
  audioDelay: 0,
  rememberAudioTrack: true,
  eqBass: 0,
  eqMid: 0,
  eqTreble: 0,
  // Streaming
  reconnectEnabled: true,
  reconnectAttempts: 5,
  bufferSize: 30,
  networkTimeout: 20000,
  lowLatency: false,
  // Subtitles
  subtitlesEnabled: true,
  subFontSize: 100,
  subFontColor: '#ffffff',
  subBackground: '0.6',
  subPosition: 'bottom',
  subDelay: 0,
  subAutoDetect: true,
  // Interface
  theme: 'dark',
  compactMode: false,
  alwaysOnTop: false,
  animations: true,
  accentColor: '#2f6bff',
  transparency: 100,
  // Playlist
  autoLoadLast: false,
  lastPlaylistPath: null,
  lastPlaylistRemote: false,
  // Advanced
  debugMode: false,
  streamHeaders: []
};

const ACCENT_PRESETS = ['#2f6bff', '#7c3aed', '#ec4899', '#22c55e', '#f59e0b', '#06b6d4'];

/* ============================== Persistence ============================== */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore quota */ }
}

let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON('lmp-settings', {}));
function saveSettings() { saveJSON('lmp-settings', settings); }

let favorites = new Set(loadJSON('lmp-favorites', []));
function saveFavorites() { saveJSON('lmp-favorites', Array.from(favorites)); }

let historyLog = loadJSON('lmp-history', []); // [{name,url,rawSource,kind,ext,logo,isRemote,playedAt,completed}]
function saveHistory() { saveJSON('lmp-history', historyLog.slice(0, 200)); }

let resumePositions = loadJSON('lmp-resume', {}); // { rawSource: {time, duration, updatedAt} }
function saveResume() { saveJSON('lmp-resume', resumePositions); }

let playlistSources = loadJSON('lmp-playlist-sources', []); // [{name, path, isRemote, addedAt}]
function saveSources() { saveJSON('lmp-playlist-sources', playlistSources); }

let bundledPlaylistsCache = []; // [{name, path, isRemote, bundled:true}]
let playlistPreview = null; // {name, path, isRemote, bundled, entries} while viewing one playlist's contents
let playlistPreviewBaseDir = null;

let debugLogs = [];
function logEvent(category, message) {
  const line = `[${new Date().toLocaleTimeString()}] ${category}: ${message}`;
  debugLogs.unshift(line);
  if (debugLogs.length > 300) debugLogs.length = 300;
  if (settings.debugMode) console.log(line);
}

/* ============================== State ============================== */
let playlist = [];
let currentIndex = -1;
let idCounter = 1;
let shuffleOn = false;
let repeatMode = 0; // 0 off, 1 all, 2 one
let isSeeking = false;
let hlsInstance = null;
let dashInstance = null;
let reconnectAttemptCount = 0;
let reconnectTimer = null;
let audioCtx = null, analyser = null, sourceNode = null, masterGain = null, vizRAF = null;
let currentTrackIsRemote = false;
let lastVolume = 80;
let activeSection = 'home';
let subtitleOriginalCues = null;
let fsIdleTimer = null;
let hasShownFsHint = false;
let isMiniPlayer = false;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
let speedIdx = SPEEDS.indexOf(settings.defaultSpeed) >= 0 ? SPEEDS.indexOf(settings.defaultSpeed) : 2;

/* ============================== DOM refs ============================== */
const mediaEl = document.getElementById('video-el');
const stageEmpty = document.getElementById('stage-empty');
const audioVisual = document.getElementById('audio-visual');
const disc = document.getElementById('disc');
const vizCanvas = document.getElementById('viz-canvas');
const vizCtx = vizCanvas.getContext('2d');
const fsTarget = document.getElementById('fullscreen-target');
const stageMedia = document.getElementById('stage-media');
const toastEl = document.getElementById('toast');
const fsHintEl = document.getElementById('fs-hint');

const navRail = document.getElementById('nav-rail');
const sidebar = document.getElementById('sidebar');
const sectionTitle = document.getElementById('section-title');
const sectionActions = document.getElementById('section-actions');
const searchBox = document.getElementById('search-box');
const videoHeaderEl = document.getElementById('video-header');
const vhActionsEl = document.querySelector('.vh-actions');
const titlebarSearchWrap = document.querySelector('.titlebar-search');
const resumeBanner = document.getElementById('resume-banner');
const resumeName = document.getElementById('resume-name');

const playlistEl = document.getElementById('playlist');
const playlistEmptyEl = document.getElementById('playlist-empty');
const trackCountEl = document.getElementById('track-count');
const repeatShuffleStatus = document.getElementById('repeat-shuffle-status');

const npTitle = document.getElementById('np-title');
const npSub = document.getElementById('np-sub');
const badgeFormat = document.getElementById('badge-format');
const btnFavoriteCurrent = document.getElementById('btn-favorite-current');

const seekBar = document.getElementById('seek-bar');
const timeCurrent = document.getElementById('time-current');
const timeDuration = document.getElementById('time-duration');
const volumeBar = document.getElementById('volume-bar');

const btnPlay = document.getElementById('btn-play');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const btnMute = document.getElementById('btn-mute');
const iconVol = document.getElementById('icon-vol');
const iconMute = document.getElementById('icon-mute');
const btnSpeed = document.getElementById('btn-speed');
const btnShuffle = document.getElementById('btn-shuffle');
const btnRepeat = document.getElementById('btn-repeat');
const btnSubtitle = document.getElementById('btn-subtitle');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
const btnMiniPlayer = document.getElementById('btn-mini-player');
const btnDisplayMode = document.getElementById('btn-display-mode');

// New UI refs (nav rail, video header, now-playing card, stream info, action toolbar)
const btnNavCollapse = document.getElementById('btn-nav-collapse');
const vhSectionLabel = document.getElementById('vh-section-label');
const vhTitle = document.getElementById('vh-title');
const vhLiveBadge = document.getElementById('vh-live-badge');
const npcLogo = document.getElementById('npc-logo');
const npcLiveBadge = document.getElementById('npc-live-badge');
const npcNowValue = document.getElementById('npc-now-value');
const npcNextValue = document.getElementById('npc-next-value');
const liveDot = document.getElementById('live-dot');
let viewIdleTimer = null;
let mediaRecorderInstance = null;
let recordedChunks = [];
let eqBassNode = null, eqMidNode = null, eqTrebleNode = null;
let prevFpsFrames = 0, prevFpsTime = 0;

const urlModal = document.getElementById('url-modal');
const urlInput = document.getElementById('url-input');

/* ============================== Window controls ============================== */
document.getElementById('btn-min').onclick = () => window.lmp.minimize();
document.getElementById('btn-max').onclick = () => window.lmp.maximize();
document.getElementById('btn-close').onclick = () => window.lmp.close();

/* ============================== Helpers ============================== */
function extOf(nameOrUrl) {
  const clean = nameOrUrl.split('?')[0].split('#')[0];
  const parts = clean.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}
function kindForExt(ext) {
  if (ext === 'mpd') return 'dash';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  return 'video';
}
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function isHlsManifest(text) {
  return /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(text);
}
function isRemoteUrl(s) { return /^https?:\/\//i.test(s); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

let toastTimer = null;
function showToast(msg, ms) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms || 1600);
}

/* ============================== Playlist model ============================== */
function addTrackObject(t) {
  t.id = idCounter++;
  playlist.push(t);
  return t;
}

async function buildLocalTrack(filePath, titleOverride, logo, category, section) {
  const ext = extOf(filePath);
  const name = titleOverride || (await window.lmp.basename(filePath));
  const url = await window.lmp.toFileUrl(filePath);
  return { name, artist: '', url, rawSource: filePath, ext, kind: kindForExt(ext), isRemote: false, logo: logo || null, category: category || null, section: section || null };
}
function buildRemoteTrack(url, titleOverride, logo, category, section) {
  const ext = extOf(url);
  const name = titleOverride || decodeURIComponent(url.split('/').pop().split('?')[0]) || url;
  return { name, artist: '', url, rawSource: url, ext, kind: kindForExt(ext), isRemote: true, logo: logo || null, category: category || null, section: section || null };
}
function buildHlsTrack(url, titleOverride, isRemote, rawSource, logo, category, section) {
  const name = titleOverride || (isRemote ? decodeURIComponent(url.split('/').pop().split('?')[0]) : url);
  return { name, artist: '', url, rawSource: rawSource || url, ext: 'm3u8', kind: 'hls', isRemote, logo: logo || null, category: category || null, section: section || null };
}

function parseM3UContent(text) {
  const lines = text.split(/\r?\n/);
  const entries = [];
  let pendingTitle = null, pendingLogo = null, pendingGroup = null;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      pendingLogo = logoMatch ? logoMatch[1] : null;
      pendingGroup = groupMatch ? groupMatch[1] : null;
      if (groupMatch) {
        // Kèk playlist ekspòte mal: rès tit la parèt apre group-title="...",
        // pafwa avèk yon rès varyab navigatè (user-agent) kole devan l.
        // Ex: #EXTINF:0, ...Safari/537.36" group-title="Music" - B4U Music (576p)
        const afterGroup = line.slice(groupMatch.index + groupMatch[0].length);
        const cleaned = afterGroup.replace(/^[",\s]*-?\s*/, '').trim();
        pendingTitle = cleaned || (comma >= 0 ? line.slice(comma + 1).trim() : null);
      } else {
        pendingTitle = comma >= 0 ? line.slice(comma + 1).trim() : null;
      }
    } else if (line.startsWith('#')) {
      continue;
    } else {
      entries.push({ title: pendingTitle, uri: line, logo: pendingLogo, group: pendingGroup });
      pendingTitle = null; pendingLogo = null; pendingGroup = null;
    }
  }
  return entries;
}

async function loadPlaylistFile(source, remote, autoplay = true, registerSource = true, opts = {}) {
  const { forceCategory = null, forceSection = null } = opts;
  let text;
  try {
    text = remote ? await (await fetch(source)).text() : await window.lmp.readFile(source);
  } catch (e) {
    alert('Mwen pa t kapab louvri playlist la: ' + e.message);
    return;
  }

  if (registerSource) {
    const srcName = remote ? decodeURIComponent(source.split('/').pop().split('?')[0]) : await window.lmp.basename(source);
    if (!playlistSources.find((s) => s.path === source)) {
      playlistSources.unshift({ name: srcName, path: source, isRemote: remote, addedAt: Date.now() });
      saveSources();
    }
    settings.lastPlaylistPath = source;
    settings.lastPlaylistRemote = remote;
    saveSettings();
  }

  if (isHlsManifest(text)) {
    const name = remote ? decodeURIComponent(source.split('/').pop().split('?')[0]) : await window.lmp.basename(source);
    addTrackObject(buildHlsTrack(source, name, remote, source, null, forceCategory, forceSection));
    renderMainPanel();
    if (autoplay && currentIndex === -1) playIndex(playlist.length - 1);
    return;
  }

  const entries = parseM3UContent(text);
  if (entries.length === 0) {
    alert('Playlist la vid oswa fòma li pa rekonèt.');
    return;
  }

  let baseDir = null;
  if (!remote) baseDir = await window.lmp.dirname(source);

  for (const entry of entries) {
    const uri = entry.uri;
    const category = entry.group || forceCategory || null;
    if (isRemoteUrl(uri)) {
      const ext = extOf(uri);
      if (ext === 'm3u8' || ext === 'm3u') {
        addTrackObject(buildHlsTrack(uri, entry.title, true, uri, entry.logo, category, forceSection));
      } else {
        addTrackObject(buildRemoteTrack(uri, entry.title, entry.logo, category, forceSection));
      }
    } else if (remote) {
      const resolved = new URL(uri, source).href;
      addTrackObject(buildRemoteTrack(resolved, entry.title, entry.logo, category, forceSection));
    } else {
      const resolved = await window.lmp.resolvePath(baseDir, uri);
      addTrackObject(await buildLocalTrack(resolved, entry.title, entry.logo, category, forceSection));
    }
  }
  renderMainPanel();
  if (autoplay && currentIndex === -1 && playlist.length) playIndex(0);
}

async function addLocalPaths(paths) {
  for (const p of paths) {
    const ext = extOf(p);
    if (ext === 'm3u' || ext === 'm3u8') {
      await loadPlaylistFile(p, false);
    } else {
      addTrackObject(await buildLocalTrack(p));
    }
  }
  renderMainPanel();
  if (currentIndex === -1 && playlist.length) playIndex(playlist.length - paths.length >= 0 ? playlist.length - paths.length : 0);
}

async function addRemoteUrl(url) {
  const ext = extOf(url);
  if (ext === 'm3u' || ext === 'm3u8') {
    await loadPlaylistFile(url, true);
  } else {
    addTrackObject(buildRemoteTrack(url));
    renderMainPanel();
    if (currentIndex === -1) playIndex(playlist.length - 1);
  }
}

function playByRawSource(entryLike) {
  const existingIdx = playlist.findIndex((t) => t.rawSource === entryLike.rawSource);
  if (existingIdx >= 0) { playIndex(existingIdx); return; }
  const t = addTrackObject({
    name: entryLike.name, artist: '', url: entryLike.url, rawSource: entryLike.rawSource,
    ext: entryLike.ext, kind: entryLike.kind, isRemote: entryLike.isRemote, logo: entryLike.logo || null
  });
  renderMainPanel();
  playIndex(playlist.indexOf(t));
}

/* ============================== Navigation (sections) ============================== */
const SECTION_TITLES = {
  home: 'Home', livetv: 'Live TV', radio: 'Radio',
  local: 'Local Media', favorites: 'Favorites', history: 'History', playlists: 'Playlists'
};

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const sec = btn.dataset.section;
    if (sec === 'settings') { closeNavOverlay(); openSettingsPanel(); return; }
    playlistPreview = null;
    playlistPreviewBaseDir = null;
    liveCategoryOpen = false;
    activeSection = sec;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
    renderMainPanel();
    openSidebarOverlay();
    // Local Media: klike sou li dwe ouvri yon fenèt pou chèche fichye a dirèkteman.
    if (sec === 'local') {
      window.lmp.openFiles().then((paths) => { if (paths && paths.length) addLocalPaths(paths); });
    }
  });
});

/* ============================== Menu overlay (Nav rail + Sidebar) ============================== */
const navScrimEl = document.getElementById('nav-scrim');
function openNavOverlay() {
  sidebar.classList.remove('open');
  navRail.classList.add('open');
  navScrimEl.classList.add('open');
  document.body.classList.remove('sidebar-panel-open');
  document.body.classList.add('nav-panel-open');
}
function closeNavOverlay() {
  navRail.classList.remove('open');
  navScrimEl.classList.remove('open');
  document.body.classList.remove('nav-panel-open');
}
function openSidebarOverlay() {
  navRail.classList.remove('open');
  sidebar.classList.add('open');
  navScrimEl.classList.add('open');
  document.body.classList.remove('nav-panel-open');
  document.body.classList.add('sidebar-panel-open');
}
function closeSidebarOverlay() {
  sidebar.classList.remove('open');
  navScrimEl.classList.remove('open');
  document.body.classList.remove('sidebar-panel-open');
}
function closeMenuOverlay() { closeNavOverlay(); closeSidebarOverlay(); }
document.getElementById('btn-nav-close').onclick = closeNavOverlay;
document.getElementById('btn-sidebar-close').onclick = closeSidebarOverlay;
// Klike sou fon eskrim ki dèyè meni an (deyò nav-rail/sidebar) fèmen li —
// menm jan playlist la dwe fèmen si ou klike andeyò l.
navScrimEl.addEventListener('click', closeMenuOverlay);

let activeLiveCategory = 'ALL';
let liveCategoryOpen = false; // vre lè yon kategori "louvri" pou montre lis chèn li yo an overlay

function sectionPredicate(section, track) {
  switch (section) {
    case 'livetv': {
      const inLiveTv = track.section === 'livetv' || (!track.section && (track.kind === 'hls' || track.kind === 'dash'));
      if (!inLiveTv) return false;
      if (activeLiveCategory === 'ALL') return true;
      return (track.category || 'Lòt') === activeLiveCategory;
    }
    case 'radio': return track.section === 'radio' || (!track.section && track.kind === 'audio');
    case 'local': return !track.isRemote;
    case 'favorites': return favorites.has(track.rawSource);
    default: return true;
  }
}

// Lòd prefere pou kategori Live TV yo — LMTV toujou apa, an premye.
const CATEGORY_ORDER = ['LMTV', 'Haiti', 'France', 'USA', 'News', 'Sports', 'Movies', 'Series', 'Kids', 'Music', 'Trace Music', 'Documentary', 'Science'];
function isLiveTvTrack(t) {
  return t.section === 'livetv' || (!t.section && (t.kind === 'hls' || t.kind === 'dash'));
}
function liveCategoryList() {
  const set = new Set();
  playlist.forEach((t) => {
    const inLiveTv = t.section === 'livetv' || (!t.section && (t.kind === 'hls' || t.kind === 'dash'));
    if (inLiveTv) set.add(t.category || 'Lòt');
  });
  const cats = Array.from(set);
  cats.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return cats;
}
// Kantite chèn ki genyen anndan chak kategori Live TV — parèt sou bò dwat chak chip.
function liveCategoryCounts() {
  const counts = {};
  let total = 0;
  playlist.forEach((t) => {
    if (!isLiveTvTrack(t)) return;
    const cat = t.category || 'Lòt';
    counts[cat] = (counts[cat] || 0) + 1;
    total += 1;
  });
  counts.__total = total;
  return counts;
}

function renderCategoryChips(liveShowingList) {
  const chipsEl = document.getElementById('category-chips');
  if (activeSection !== 'livetv' || liveShowingList) { chipsEl.style.display = 'none'; return; }
  const cats = liveCategoryList();
  if (cats.length === 0) { chipsEl.style.display = 'none'; return; }
  if (!cats.includes(activeLiveCategory) && activeLiveCategory !== 'ALL') activeLiveCategory = 'ALL';
  const counts = liveCategoryCounts();
  chipsEl.style.display = 'flex';
  chipsEl.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.className = 'category-chip' + (activeLiveCategory === 'ALL' ? ' active' : '');
  allChip.innerHTML = `<span class="chip-label">Tout</span><span class="chip-count">${counts.__total || 0}</span>`;
  allChip.onclick = () => { activeLiveCategory = 'ALL'; liveCategoryOpen = true; renderMainPanel(); };
  chipsEl.appendChild(allChip);
  cats.forEach((cat) => {
    const chip = document.createElement('button');
    chip.className = 'category-chip' + (cat === 'LMTV' ? ' chip-lmtv' : '') + (activeLiveCategory === cat ? ' active' : '');
    chip.innerHTML = `<span class="chip-label">${escapeHtml(cat)}</span><span class="chip-count">${counts[cat] || 0}</span>`;
    chip.onclick = () => { activeLiveCategory = cat; liveCategoryOpen = true; renderMainPanel(); };
    chipsEl.appendChild(chip);
  });
}

const sidebarAddActions = document.getElementById('sidebar-add-actions');
const btnAddUrl = document.getElementById('btn-add-url');
const btnSidebarBack = document.getElementById('btn-sidebar-back');
btnSidebarBack.onclick = () => {
  // Si nou anndan yon sou-vi (yon playlist ki louvri, oswa yon kategori Live TV ki louvri),
  // "back" retounen nan nivo anwo l anndan seksyon an anvan.
  if (playlistPreview) { closePlaylistPreview(); return; }
  if (activeSection === 'livetv' && liveCategoryOpen) { liveCategoryOpen = false; renderMainPanel(); return; }
  // Otreman, "back" retounen nan meni prensipal la (lis seksyon yo) san l pa fèmen tout paj la.
  openNavOverlay();
};

function renderMainPanel() {
  sectionTitle.textContent = SECTION_TITLES[activeSection] || 'Home';
  sectionActions.innerHTML = '';

  const query = document.getElementById('search-input').value.trim();
  // Lè w ap chèche nan Live TV, kite lis chèn ki matche a parèt dirèkteman,
  // menm si ou poko "louvri" yon kategori.
  const liveShowingList = activeSection === 'livetv' && (liveCategoryOpen || query.length > 0);

  renderCategoryChips(liveShowingList);

  // Bouton ＋Fichye / 📁Dosye / 🔗URL yo se sèlman pou Live TV ak Local Media.
  sidebarAddActions.style.display = (activeSection === 'livetv' || activeSection === 'local') ? 'flex' : 'none';
  btnAddUrl.style.display = (activeSection === 'livetv') ? '' : 'none';
  // Bouton "tounen" an parèt toutan bò kote bouton "fèmen" a — pou nou ka tounen
  // (nan meni prensipal la, oswa nan yon nivo pi wo anndan seksyon an) san nou pa
  // oblije fèmen tout paj la.
  btnSidebarBack.style.display = 'flex';

  if (activeSection === 'history') {
    resumeBanner.style.display = 'none';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'ghost-btn';
    clearBtn.textContent = 'Vide Istorik';
    clearBtn.onclick = () => { historyLog = []; saveHistory(); renderMainPanel(); };
    sectionActions.appendChild(clearBtn);
    renderHistoryList();
    return;
  }

  if (activeSection === 'playlists') {
    resumeBanner.style.display = 'none';
    if (playlistPreview) {
      sectionTitle.textContent = playlistPreview.name;
      renderPlaylistPreview();
      return;
    }
    const sortBtn = document.createElement('button');
    sortBtn.className = 'ghost-btn';
    sortBtn.textContent = 'Klase A-Z';
    sortBtn.onclick = sortPlaylistAZ;
    sectionActions.appendChild(sortBtn);
    renderPlaylistSources();
    return;
  }

  if (activeSection === 'home') {
    // Kantite chèn Live TV ki disponib — parèt sou bò dwat, sou menm liy ak tit "Home" la.
    const countBadge = document.createElement('span');
    countBadge.className = 'section-count-badge';
    const chCount = playlist.filter(isLiveTvTrack).length;
    countBadge.textContent = `${chCount} chèn`;
    sectionActions.appendChild(countBadge);
  }

  if (activeSection === 'livetv' && !liveShowingList) {
    // Montre sèlman meni kategori yo (LMTV, Haiti, News, ...) — pa gen lis chèn
    // ki parèt jiskaske ou klike sou yonn ladan yo.
    resumeBanner.style.display = 'none';
    searchBox.style.display = '';
    playlistEl.innerHTML = '';
    playlistEmptyEl.style.display = 'none';
    trackCountEl.textContent = `${liveCategoryList().length} kategori`;
    return;
  }
  if (activeSection === 'livetv' && liveShowingList) {
    sectionTitle.textContent = query ? 'Rezilta rechèch' : (activeLiveCategory === 'ALL' ? 'Tout Chèn' : activeLiveCategory);
  }

  searchBox.style.display = '';
  renderTrackListView();
}

function renderHistoryList() {
  playlistEl.innerHTML = '';
  // Se sèlman chèn TV (20 pi resan) ak estasyon radyo (10 pi resan) ki parèt nan Istorik.
  const isTv = (h) => h.section === 'livetv' || (!h.section && (h.kind === 'hls' || h.kind === 'dash'));
  const isRadio = (h) => h.section === 'radio' || (!h.section && h.kind === 'audio');
  const tvEntries = historyLog.filter(isTv).slice(0, 20);
  const radioFinal = historyLog.filter(isRadio).slice(0, 10);
  const shown = [...tvEntries, ...radioFinal];

  if (shown.length === 0) {
    playlistEmptyEl.style.display = '';
    playlistEmptyEl.innerHTML = 'Ou poko gade oswa koute anyen.';
    playlistEl.appendChild(playlistEmptyEl);
    trackCountEl.textContent = '0 fichye';
    return;
  }
  playlistEmptyEl.style.display = 'none';

  const renderGroup = (label, entries) => {
    if (!entries.length) return;
    const heading = document.createElement('div');
    heading.className = 'history-group-heading';
    heading.textContent = label;
    playlistEl.appendChild(heading);
    entries.forEach((h) => {
      const div = document.createElement('div');
      div.className = 'track-item';
      const icon = h.kind === 'hls' || h.kind === 'dash' ? '📡' : (h.kind === 'audio' ? '🎵' : '🎬');
      div.innerHTML = `
        <span class="track-icon">${icon}</span>
        <div class="track-info">
          <div class="track-name">${escapeHtml(h.name)}</div>
          <div class="track-meta">${new Date(h.playedAt).toLocaleString()} ${h.completed ? '· fini' : ''}</div>
        </div>
      `;
      div.onclick = () => playByRawSource(h);
      playlistEl.appendChild(div);
    });
  };
  renderGroup('Chèn TV', tvEntries);
  renderGroup('Estasyon Radyo', radioFinal);
  trackCountEl.textContent = `${shown.length} antre`;
}

function renderPlaylistSources() {
  playlistEl.innerHTML = '';
  // Tout playlist ki vin avèk app la (bundled) + tout sa itilizatè a chaje pa li menm,
  // pou "tout" opsyon yo ka parèt nan lis la, pa sèlman sa itilizatè a te enpòte.
  const bundledItems = bundledPlaylistsCache.filter(
    (b) => !playlistSources.find((s) => s.path === b.path)
  );
  const allItems = [...bundledItems, ...playlistSources];

  if (allItems.length === 0) {
    playlistEmptyEl.style.display = '';
    playlistEmptyEl.innerHTML = 'Ou poko chaje okenn fichye playlist (.m3u/.m3u8).';
    playlistEl.appendChild(playlistEmptyEl);
    trackCountEl.textContent = '0 playlist';
    return;
  }
  playlistEmptyEl.style.display = 'none';
  allItems.forEach((s) => {
    const div = document.createElement('div');
    div.className = 'playlist-source-item';
    div.innerHTML = `
      <div class="playlist-source-name" title="${escapeHtml(s.path)}">
        ${s.bundled ? '<span class="playlist-source-badge">LMP</span>' : ''}
        <span>${escapeHtml(s.name)}</span>
      </div>
      <div class="playlist-source-actions">
        <button class="btn-reload" title="Rechaje">↻</button>
        ${s.bundled ? '' : '<button class="btn-remove" title="Retire nan lis sous yo">✕</button>'}
      </div>
    `;
    div.addEventListener('click', () => openPlaylistPreview(s));
    div.querySelector('.btn-reload').onclick = (e) => {
      e.stopPropagation();
      loadPlaylistFile(s.path, s.isRemote, true, !s.bundled);
    };
    const removeBtn = div.querySelector('.btn-remove');
    if (removeBtn) {
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        const idx = playlistSources.findIndex((p) => p.path === s.path);
        if (idx >= 0) playlistSources.splice(idx, 1);
        saveSources();
        renderPlaylistSources();
      };
    }
    playlistEl.appendChild(div);
  });
  trackCountEl.textContent = `${allItems.length} playlist`;
}

/* ---- Playlist preview: open a playlist's contents inline with a back button,
   without touching the main playlist / adding duplicates until a track is
   actually clicked to play. ---- */
async function openPlaylistPreview(source) {
  let text;
  try {
    text = source.isRemote ? await (await fetch(source.path)).text() : await window.lmp.readFile(source.path);
  } catch (e) {
    alert('Mwen pa t kapab louvri playlist la: ' + e.message);
    return;
  }
  const entries = parseM3UContent(text);
  playlistPreview = { ...source, entries };
  playlistPreviewBaseDir = source.isRemote ? null : await window.lmp.dirname(source.path);
  renderMainPanel();
}
function closePlaylistPreview() {
  playlistPreview = null;
  playlistPreviewBaseDir = null;
  renderMainPanel();
}
function renderPlaylistPreview() {
  playlistEl.innerHTML = '';
  if (!playlistPreview.entries.length) {
    playlistEmptyEl.style.display = '';
    playlistEmptyEl.innerHTML = 'Playlist sa a vid oswa fòma li pa rekonèt.';
    playlistEl.appendChild(playlistEmptyEl);
    trackCountEl.textContent = '0 fichye';
    return;
  }
  playlistEmptyEl.style.display = 'none';
  playlistPreview.entries.forEach((entry) => {
    const div = document.createElement('div');
    div.className = 'track-item';
    const ext = extOf(entry.uri);
    const icon = (ext === 'm3u8' || ext === 'm3u') ? '📡' : '🎬';
    div.innerHTML = `
      <span class="track-icon">${icon}</span>
      <div class="track-info">
        <div class="track-name">${escapeHtml(entry.title || entry.uri)}</div>
        <div class="track-meta">${entry.group ? escapeHtml(entry.group) : ''}</div>
      </div>
    `;
    div.onclick = () => playPreviewEntry(entry);
    playlistEl.appendChild(div);
  });
  trackCountEl.textContent = `${playlistPreview.entries.length} fichye`;
}
async function playPreviewEntry(entry) {
  const uri = entry.uri;
  let track;
  if (isRemoteUrl(uri)) {
    const ext = extOf(uri);
    track = (ext === 'm3u8' || ext === 'm3u')
      ? buildHlsTrack(uri, entry.title, true, uri, entry.logo)
      : buildRemoteTrack(uri, entry.title, entry.logo);
  } else if (playlistPreview.isRemote) {
    const resolved = new URL(uri, playlistPreview.path).href;
    track = buildRemoteTrack(resolved, entry.title, entry.logo);
  } else {
    const resolved = await window.lmp.resolvePath(playlistPreviewBaseDir, uri);
    track = await buildLocalTrack(resolved, entry.title, entry.logo);
  }
  playByRawSource(track);
}

function sortPlaylistAZ() {
  const currentTrack = playlist[currentIndex];
  playlist.sort((a, b) => a.name.localeCompare(b.name));
  if (currentTrack) currentIndex = playlist.indexOf(currentTrack);
  renderMainPanel();
}

function renderTrackListView() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  playlistEl.innerHTML = '';

  // resume banner only on Home
  if (activeSection === 'home') {
    const entries = Object.entries(resumePositions).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    if (settings.autoResume && entries.length) {
      const [rawSource, pos] = entries[0];
      const knownTrack = playlist.find((t) => t.rawSource === rawSource) ||
        historyLog.find((h) => h.rawSource === rawSource);
      if (knownTrack && pos.duration && pos.time > 5 && pos.time < pos.duration - 8) {
        resumeName.textContent = knownTrack.name;
        resumeBanner.style.display = 'flex';
        document.getElementById('btn-resume-play').onclick = () => playByRawSource(knownTrack);
      } else {
        resumeBanner.style.display = 'none';
      }
    } else {
      resumeBanner.style.display = 'none';
    }
  } else {
    resumeBanner.style.display = 'none';
  }

  const isLiveTvTrack = (t) => t.section === 'livetv' || (!t.section && (t.kind === 'hls' || t.kind === 'dash'));

  const visible = [];
  playlist.forEach((t, idx) => {
    if (activeSection === 'livetv' && query) {
      // Ap chèche: montre tout chèn ki matche, san restriksyon kategori.
      if (!isLiveTvTrack(t)) return;
    } else if (!sectionPredicate(activeSection, t)) {
      return;
    }
    if (query && !t.name.toLowerCase().includes(query)) return;
    visible.push({ t, idx });
  });

  // Home: Live TV toujou an premye, tout rès la vin apre.
  if (activeSection === 'home') {
    visible.sort((a, b) => (isLiveTvTrack(a.t) === isLiveTvTrack(b.t)) ? 0 : (isLiveTvTrack(a.t) ? -1 : 1));
  }

  if (playlist.length === 0 || visible.length === 0) {
    playlistEmptyEl.style.display = '';
    playlistEmptyEl.innerHTML = playlist.length === 0
      ? 'Lis ou vid. Klike <b>＋ Fichye</b>, <b>📁 Dosye</b>, oswa <b>🔗 URL</b> pou kòmanse.'
      : 'Anyen pa matche seksyon oswa rechèch sa a.';
    playlistEl.appendChild(playlistEmptyEl);
  } else {
    playlistEmptyEl.style.display = 'none';
  }

  visible.forEach(({ t, idx }) => {
    const div = document.createElement('div');
    div.className = 'track-item' + (idx === currentIndex ? ' active' : '');
    div.dataset.idx = idx;

    const icon = t.section === 'radio' ? '🎵' : ((t.kind === 'hls' || t.kind === 'dash') ? '📡' : (t.kind === 'audio' ? '🎵' : '🎬'));
    const isPlayingThis = idx === currentIndex && !mediaEl.paused;
    const isFav = favorites.has(t.rawSource);
    const iconHtml = t.logo ? `<img class="track-logo-img" src="${escapeHtml(t.logo)}" alt="" />` : `<span>${icon}</span>`;

    div.innerHTML = `
      <span class="track-num">${isPlayingThis ? '' : idx + 1}</span>
      ${isPlayingThis ? '<span class="playing-eq"><span></span><span></span><span></span></span>' : ''}
      <span class="track-icon">${iconHtml}</span>
      <div class="track-info">
        <div class="track-name">${escapeHtml(t.name)}</div>
        <div class="track-meta">${(t.ext || t.kind).toUpperCase()}${t.isRemote ? ' · online' : ''}${(activeSection === 'livetv' && activeLiveCategory === 'ALL' && t.category) ? ' · ' + escapeHtml(t.category) : ''}</div>
      </div>
      <button class="track-star ${isFav ? 'is-fav' : ''}" title="Favori">${isFav ? '★' : '☆'}</button>
      <button class="track-remove" title="Retire">✕</button>
    `;

    const logoImg = div.querySelector('.track-logo-img');
    if (logoImg) logoImg.addEventListener('error', () => { logoImg.outerHTML = `<span>${icon}</span>`; }, { once: true });

    div.querySelector('.track-star').onclick = (e) => { e.stopPropagation(); toggleFavorite(t.rawSource); };
    div.querySelector('.track-remove').onclick = (e) => { e.stopPropagation(); removeTrack(idx); };
    div.onclick = () => playIndex(idx);
    playlistEl.appendChild(div);
  });

  trackCountEl.textContent = `${playlist.length} fichye`;
  repeatShuffleStatus.textContent = [
    shuffleOn ? 'Mize' : null,
    repeatMode === 1 ? 'Repete tout' : (repeatMode === 2 ? 'Repete 1' : null)
  ].filter(Boolean).join(' · ');
}

function renderPlaylist() { renderMainPanel(); }

document.getElementById('search-input').addEventListener('input', () => {
  const q = document.getElementById('search-input').value.trim();
  // Bar search la nan tèt fenèt la; louvri lis la (sidebar) otomatikman
  // depi ou kòmanse tape pou ou ka wè rezilta yo dirèkteman.
  if (q && !sidebar.classList.contains('open')) openSidebarOverlay();
  // An plen ekran, kenbe bar anlè a (kote bar chèche a ye) vizib pandan
  // moun nan ap tape, olye pou l disparèt nan mitan l ap ekri.
  if (fsIsActive()) resetFsIdleTimer();
  renderMainPanel();
});
document.getElementById('search-input').addEventListener('focus', () => {
  if (!sidebar.classList.contains('open') && !navRail.classList.contains('open')) openSidebarOverlay();
  if (fsIsActive()) resetFsIdleTimer();
});

function toggleFavorite(rawSource) {
  if (favorites.has(rawSource)) favorites.delete(rawSource);
  else favorites.add(rawSource);
  saveFavorites();
  renderMainPanel();
  updateFavoriteBadge();
}
function updateFavoriteBadge() {
  if (currentIndex === -1) { btnFavoriteCurrent.classList.remove('is-fav'); btnFavoriteCurrent.textContent = '☆'; return; }
  const t = playlist[currentIndex];
  const fav = favorites.has(t.rawSource);
  btnFavoriteCurrent.classList.toggle('is-fav', fav);
  btnFavoriteCurrent.textContent = fav ? '★' : '☆';
}
btnFavoriteCurrent.onclick = () => { if (currentIndex !== -1) toggleFavorite(playlist[currentIndex].rawSource); };

function removeTrack(idx) {
  playlist.splice(idx, 1);
  if (idx === currentIndex) { stopPlayback(); currentIndex = -1; }
  else if (idx < currentIndex) currentIndex--;
  renderMainPanel();
}

/* ============================== History & resume ============================== */
function pushHistory(track, completed) {
  const entry = {
    name: track.name, url: track.url, rawSource: track.rawSource, ext: track.ext,
    kind: track.kind, section: track.section || null, isRemote: track.isRemote, logo: track.logo || null,
    playedAt: Date.now(), completed: !!completed
  };
  historyLog = historyLog.filter((h) => h.rawSource !== track.rawSource);
  historyLog.unshift(entry);
  saveHistory();
}
function markHistoryCompleted(track) {
  const found = historyLog.find((h) => h.rawSource === track.rawSource);
  if (found) { found.completed = true; found.playedAt = Date.now(); saveHistory(); }
}
function saveResumePosition(track, time, duration) {
  if (!duration || time < 5 || time > duration - 8) {
    delete resumePositions[track.rawSource];
  } else {
    resumePositions[track.rawSource] = { time, duration, updatedAt: Date.now() };
  }
  saveResume();
}
function clearResumePosition(track) {
  delete resumePositions[track.rawSource];
  saveResume();
}

/* ============================== Playback engine ============================== */
function destroyEngines() {
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  if (dashInstance) { dashInstance.reset(); dashInstance = null; }
  clearTimeout(reconnectTimer);
  reconnectAttemptCount = 0;
}

function stopPlayback() {
  destroyEngines();
  mediaEl.pause();
  mediaEl.removeAttribute('src');
  mediaEl.load();
  clearSubtitleTracks();
  updatePlayIcon(false);
  disc.classList.remove('spinning');
  stopViz();
  stageEmpty.style.display = 'flex';
  mediaEl.style.display = 'none';
  audioVisual.style.display = 'none';
  npTitle.textContent = 'Pa gen fichye k ap jwe';
  npSub.textContent = '—';
  badgeFormat.textContent = '—';
  updateFavoriteBadge();
  vhTitle.textContent = 'LMP Media Player';
  vhLiveBadge.style.display = 'none';
  npcLiveBadge.style.display = 'none';
  npcLogo.textContent = '📡';
  npcNowValue.textContent = '—';
  npcNextValue.textContent = '—';
  liveDot.style.display = 'none';
  resetStreamInfo();
}

function clearSubtitleTracks() {
  Array.from(mediaEl.querySelectorAll('track')).forEach((t) => t.remove());
  subtitleOriginalCues = null;
}

function playIndex(idx) {
  if (idx < 0 || idx >= playlist.length) return;
  currentIndex = idx;
  const track = playlist[idx];
  loadTrackIntoPlayer(track);
  renderMainPanel();
}

function applyHlsTuning(hls) {
  try {
    hls.config.maxBufferLength = settings.bufferSize || 30;
    hls.config.manifestLoadingTimeOut = settings.networkTimeout || 20000;
    hls.config.fragLoadingTimeOut = settings.networkTimeout || 20000;
  } catch (e) { /* ignore */ }
}

function loadTrackIntoPlayer(track) {
  destroyEngines();
  clearSubtitleTracks();
  stageEmpty.style.display = 'none';

  const showVideo = track.kind !== 'audio' && track.section !== 'radio';
  mediaEl.style.display = showVideo ? 'block' : 'none';
  audioVisual.style.display = showVideo ? 'none' : 'flex';

  npTitle.textContent = track.name;
  npSub.textContent = track.artist || (track.kind === 'hls' ? 'Stream / HLS' : (track.kind === 'dash' ? 'Stream / DASH' : (track.isRemote ? 'Online' : 'Lokal')));
  badgeFormat.textContent = (track.ext || track.kind).toUpperCase();
  updateFavoriteBadge();

  // Video header + now-playing card + live indicator
  const isLive = track.kind === 'hls';
  vhSectionLabel.textContent = SECTION_TITLES[activeSection] ? SECTION_TITLES[activeSection].toUpperCase() : 'NOW PLAYING';
  vhTitle.textContent = track.name;
  vhLiveBadge.style.display = isLive ? 'inline-block' : 'none';
  npcLiveBadge.style.display = isLive ? 'inline-block' : 'none';
  liveDot.style.display = isLive ? 'inline-block' : 'none';
  npcLogo.innerHTML = track.logo ? `<img src="${escapeHtml(track.logo)}" alt="" />` : (isLive ? '📡' : (track.kind === 'audio' ? '🎵' : '🎬'));
  npcNowValue.textContent = track.name;
  if (shuffleOn) {
    npcNextValue.textContent = 'Mize aktif (owaza)';
  } else {
    const nextIdx = currentIndex + 1 < playlist.length ? currentIndex + 1 : (repeatMode === 1 && playlist.length ? 0 : -1);
    npcNextValue.textContent = nextIdx >= 0 ? playlist[nextIdx].name : 'Pa gen apre';
  }
  resetStreamInfo();

  if (track.kind === 'hls') {
    const nativeHls = mediaEl.canPlayType('application/vnd.apple.mpegurl') || mediaEl.canPlayType('application/x-mpegURL');
    if (nativeHls) {
      // Safari (iOS/iPadOS/macOS) gen sipò HLS natif entegre nan <video>.
      // Nou toujou prefere l anvan hls.js sou aparèy sa yo: li pi solid,
      // e li PA mande antèt CORS sou sèvè a (dekodaj la fèt anndan
      // navigatè a, JS pa manyen okenn done vrè — kontrèman ak hls.js
      // ki fèt ak fetch/XHR e ki BEZWEN CORS pou l ka li manifès/segman
      // yo). Se sa ki fè kèk chèn (tankou Le Maire TV) te ka jwe sou
      // desktop (Chromium/hls.js sou yon sèvè ki gen CORS OK) men pa
      // jwe sou Safari mobil si lojik la te eseye hls.js an premye.
      mediaEl.src = track.url;
      mediaEl.play().catch(() => {});
      logEvent('HLS', 'Lekti natif (Safari) pou ' + track.name);
    } else if (window.Hls && window.Hls.isSupported()) {
      hlsInstance = new window.Hls({
        enableWorker: true,
        maxBufferLength: settings.bufferSize || 30,
        manifestLoadingTimeOut: settings.networkTimeout || 20000,
        fragLoadingTimeOut: settings.networkTimeout || 20000,
        lowLatencyMode: !!settings.lowLatency,
        xhrSetup: (xhr) => {
          (settings.streamHeaders || []).forEach((h) => {
            try { xhr.setRequestHeader(h.key, h.value); } catch (e) { /* forbidden header, ignore */ }
          });
        }
      });
      hlsInstance.loadSource(track.url);
      hlsInstance.attachMedia(mediaEl);
      hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        populateQualityFromHls();
        mediaEl.play().catch(() => {});
        logEvent('HLS', 'Manifest chaje pou ' + track.name);
      });
      hlsInstance.on(window.Hls.Events.FRAG_BUFFERED, () => { reconnectAttemptCount = 0; });
      hlsInstance.on(window.Hls.Events.ERROR, (evt, data) => {
        logEvent('HLS', (data.fatal ? 'ERÈ FATAL: ' : 'erè: ') + data.type + ' ' + (data.details || ''));
        if (data.fatal) attemptReconnect();
      });
    } else {
      showToast('Navigatè sa a pa ka jwe stream HLS sa a.');
    }
  } else if (track.kind === 'dash') {
    if (window.dashjs) {
      dashInstance = window.dashjs.MediaPlayer().create();
      try {
        dashInstance.updateSettings({
          streaming: {
            lowLatencyEnabled: !!settings.lowLatency,
            buffer: { bufferTimeAtTopQuality: settings.bufferSize || 30 }
          }
        });
      } catch (e) { /* ignore config errors on older dashjs */ }
      dashInstance.initialize(mediaEl, track.url, true);
      dashInstance.on('error', (e) => { logEvent('DASH', 'erè: ' + JSON.stringify(e).slice(0, 200)); attemptReconnect(); });
      dashInstance.on('streamInitialized', () => populateQualityFromDash());
      logEvent('DASH', 'Chaje manifest MPD pou ' + track.name);
    } else {
      showToast('Pa gen sipò DASH disponib.');
    }
  } else {
    mediaEl.src = track.url;
    mediaEl.play().catch(() => {});
  }

  mediaEl.playbackRate = SPEEDS[speedIdx];
  currentTrackIsRemote = !!track.isRemote;
  // ⚠️ Pa itilize Web Audio (EQ/vizyalizè) pou stream ki soti nan yon lòt sit/domèn
  // (tout Live TV, Radio, ak lyen URL — sa vle di prèske tout kontni app la).
  // Depi w konekte yon <video>/<audio> distan (san antèt CORS) nan Web Audio,
  // navigatè a MIZE SON AN AN SILANS pou rezon sekirite — san okenn erè — e sa
  // rete konsa pou tout tan pou eleman videyo/odyo sa a. Se poutèt sa son an pa
  // t janm soti. Nou sèlman itilize Web Audio pou fichye LOKAL (ki pa gen pwoblèm
  // CORS), kote itilizatè a aktive EQ/Mono/Boost oswa vizyalizè odyo a.
  if (!currentTrackIsRemote) {
    ensureAudioGraph();
    resumeAudioGraph();
    if (!showVideo) startViz(); else stopViz();
  } else {
    stopViz();
  }

  if (settings.subAutoDetect && !track.isRemote) autoDetectSubtitle(track);

  // resume position
  if (settings.autoResume) {
    const saved = resumePositions[track.rawSource];
    if (saved && saved.time > 5) {
      const onMeta = () => {
        if (saved.duration && saved.time < saved.duration - 8) mediaEl.currentTime = saved.time;
        mediaEl.removeEventListener('loadedmetadata', onMeta);
      };
      mediaEl.addEventListener('loadedmetadata', onMeta);
    }
  }

  if (settings.autoFullscreen && showVideo && !document.fullscreenElement) {
    setTimeout(() => toggleFullscreen(true), 300);
  }

  pushHistory(track, false);
  populateAudioTracks();
}

function attemptReconnect() {
  if (!settings.reconnectEnabled || currentIndex === -1) return;
  if (reconnectAttemptCount >= (settings.reconnectAttempts || 5)) {
    logEvent('Rekonekte', 'Kantite tantativ maksimòm rive, sispann eseye.');
    showToast('Pa t kapab rekonekte ak stream lan.');
    return;
  }
  reconnectAttemptCount++;
  logEvent('Rekonekte', `Tantativ #${reconnectAttemptCount}...`);
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    const track = playlist[currentIndex];
    if (track) loadTrackIntoPlayer(track);
  }, Math.min(1500 * reconnectAttemptCount, 8000));
}

function togglePlay() {
  if (currentIndex === -1) { if (playlist.length) playIndex(0); return; }
  if (!currentTrackIsRemote) {
    ensureAudioGraph();
    resumeAudioGraph();
  }
  if (mediaEl.paused) mediaEl.play().catch(() => {});
  else mediaEl.pause();
}
function updatePlayIcon(playing) {
  iconPlay.style.display = playing ? 'none' : 'block';
  iconPause.style.display = playing ? 'block' : 'none';
}

/* ============================== Rezoud son ki pa soti (iPhone Safari) ==============================
   Depi n ap itilize Web Audio (createMediaElementSource pou egalizè/vizyalizè a), TOUT son an dwe
   pase pa audioCtx — si audioCtx la rete "suspended", pa gen okenn son ki soti menm si volim/mize
   videyo a bon. Safari sou iPhone se pi strik pase Safari sou iPad pou "dezenkle" yon AudioContext:
   li egzije yon resume() ki fèt DWAT anndan yon jès itilizatè (tap/klik), e li ka re-sispann
   AudioContext lan chak fwa app la ale background/lock ekran. Fonksyon sa a eseye "reveye" l
   nan chak pwen kritik yo pou son an pa janm rete koupe. */
function resumeAudioGraph() {
  if (audioCtx && audioCtx.state !== 'running') {
    audioCtx.resume().catch(() => {});
  }
}
// Nenpòt tap/klik nenpòt kote nan app la — filè sekirite pou dezenkle AudioContext
// la sou iOS Safari menm si premye tantativ (nan togglePlay) pa t rive nan lè.
['touchend', 'mousedown', 'keydown'].forEach((evt) => {
  document.addEventListener(evt, resumeAudioGraph, { passive: true });
});
// App la ale background (ekran lock, chanje app) ka re-sispann AudioContext lan san
// avèti — reveye l ankò lè app la retounen anlè, e lè videyo a eseye jwe/kontinye.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) resumeAudioGraph();
});
mediaEl.addEventListener('playing', resumeAudioGraph);

mediaEl.addEventListener('play', () => { updatePlayIcon(true); disc.classList.add('spinning'); renderMainPanel(); resumeAudioGraph(); });
mediaEl.addEventListener('pause', () => { updatePlayIcon(false); disc.classList.remove('spinning'); renderMainPanel(); });
mediaEl.addEventListener('loadedmetadata', () => { timeDuration.textContent = fmtTime(mediaEl.duration); });
mediaEl.addEventListener('timeupdate', () => {
  if (isSeeking) return;
  timeCurrent.textContent = fmtTime(mediaEl.currentTime);
  if (mediaEl.duration) seekBar.value = Math.floor((mediaEl.currentTime / mediaEl.duration) * 1000);
  if (currentIndex !== -1 && Math.floor(mediaEl.currentTime) % 5 === 0) {
    saveResumePosition(playlist[currentIndex], mediaEl.currentTime, mediaEl.duration);
  }
});
mediaEl.addEventListener('ended', handleEnded);
mediaEl.addEventListener('error', () => {
  if (currentIndex === -1) return;
  const track = playlist[currentIndex];
  logEvent('Videyo', 'Erè lekti pou ' + track.name);
  // Stream HLS k ap jwe an mòd natif (Safari) pa gen hls.js pou detekte
  // erè — se <video> a menm ki deklanche 'error'. Nou re-eseye menm jan
  // ak hls.js/dash.js a, pou konpòtman konsistan/pwofesyonèl kèlkeswa
  // aparèy la.
  if (track.kind === 'hls' && !hlsInstance) { attemptReconnect(); return; }
  if (track.kind !== 'hls' && track.kind !== 'dash') {
    // Fòma fichye lokal/direk sa a pa ka dekode pa mòtè videyo entegre
    // navigatè a (limit platfòm — pa gen "codec inivèsèl" tankou VLC
    // nan yon navigatè web san yon dekodè adisyonèl volumine).
    const code = mediaEl.error && mediaEl.error.code;
    if (code === 4 || code === 3) {
      showToast(`"${track.name}" itilize yon fòma/codec navigatè a pa sipòte.`);
    }
  }
});

function handleEnded() {
  if (currentIndex !== -1) { markHistoryCompleted(playlist[currentIndex]); clearResumePosition(playlist[currentIndex]); }

  if (repeatMode === 2) { mediaEl.currentTime = 0; mediaEl.play().catch(() => {}); return; }

  if (!settings.autoAdvance && repeatMode === 0 && !shuffleOn) {
    updatePlayIcon(false); disc.classList.remove('spinning'); return;
  }

  if (shuffleOn && playlist.length > 1) {
    let next; do { next = Math.floor(Math.random() * playlist.length); } while (next === currentIndex);
    playIndex(next); return;
  }
  if (currentIndex + 1 < playlist.length) playIndex(currentIndex + 1);
  else if (repeatMode === 1 && playlist.length) playIndex(0);
  else { updatePlayIcon(false); disc.classList.remove('spinning'); }
}

btnPlay.onclick = togglePlay;
document.getElementById('btn-next').onclick = () => {
  if (!playlist.length) return;
  if (shuffleOn && playlist.length > 1) {
    let next; do { next = Math.floor(Math.random() * playlist.length); } while (next === currentIndex);
    playIndex(next);
  } else playIndex((currentIndex + 1) % playlist.length);
};
document.getElementById('btn-prev').onclick = () => {
  if (!playlist.length) return;
  if (mediaEl.currentTime > 3) { mediaEl.currentTime = 0; return; }
  playIndex((currentIndex - 1 + playlist.length) % playlist.length);
};

btnShuffle.onclick = () => { shuffleOn = !shuffleOn; btnShuffle.classList.toggle('active', shuffleOn); renderMainPanel(); };
btnRepeat.onclick = () => {
  repeatMode = (repeatMode + 1) % 3;
  btnRepeat.classList.toggle('active', repeatMode !== 0);
  btnRepeat.classList.toggle('repeat-one', repeatMode === 2);
  renderMainPanel();
};

/* seek */
seekBar.addEventListener('input', () => { isSeeking = true; });
seekBar.addEventListener('change', () => {
  if (mediaEl.duration) mediaEl.currentTime = (seekBar.value / 1000) * mediaEl.duration;
  isSeeking = false;
});

/* volume */
volumeBar.addEventListener('input', () => {
  const v = Number(volumeBar.value);
  mediaEl.volume = v / 100;
  mediaEl.muted = v === 0;
  lastVolume = v || lastVolume;
  updateVolIcon();
  if (settings.rememberVolume) { settings.__lastVolume = v; saveSettings(); }
  const qsVol = document.getElementById('qs-volume');
  if (qsVol) qsVol.value = v;
});
btnMute.onclick = () => {
  mediaEl.muted = !mediaEl.muted;
  if (!mediaEl.muted && Number(volumeBar.value) === 0) { volumeBar.value = lastVolume; mediaEl.volume = lastVolume / 100; }
  updateVolIcon();
};
function updateVolIcon() {
  const muted = mediaEl.muted || Number(volumeBar.value) === 0;
  iconVol.style.display = muted ? 'none' : 'block';
  iconMute.style.display = muted ? 'block' : 'none';
}
if (settings.rememberVolume && typeof settings.__lastVolume === 'number') {
  volumeBar.value = settings.__lastVolume;
  mediaEl.volume = settings.__lastVolume / 100;
} else {
  mediaEl.volume = 0.8;
}

/* speed */
btnSpeed.textContent = SPEEDS[speedIdx] + 'x';
btnSpeed.onclick = () => {
  speedIdx = (speedIdx + 1) % SPEEDS.length;
  mediaEl.playbackRate = SPEEDS[speedIdx];
  btnSpeed.textContent = SPEEDS[speedIdx] + 'x';
};

/* ============================== Display mode (aspect ratio) ============================== */
const DISPLAY_MODES = ['fit', 'stretch', 'original', 'crop'];
function applyDisplayMode(mode) {
  mediaEl.classList.remove('mode-fit', 'mode-stretch', 'mode-original', 'mode-crop');
  mediaEl.classList.add('mode-' + mode);
  settings.displayMode = mode;
  saveSettings();
  document.querySelectorAll('.qs-mini-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
}
applyDisplayMode(settings.displayMode || 'fit');
btnDisplayMode.onclick = () => {
  const idx = DISPLAY_MODES.indexOf(settings.displayMode);
  const next = DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length];
  applyDisplayMode(next);
  showToast('Mòd ekran: ' + next.toUpperCase());
};
document.querySelectorAll('.qs-mini-btn').forEach((btn) => {
  btn.onclick = () => { applyDisplayMode(btn.dataset.mode); showToast('Mòd ekran: ' + btn.dataset.mode.toUpperCase()); };
});

/* ============================== Fullscreen ============================== */
// Nou mande Fullscreen la sou .app-shell (ki gen nav-rail + sidebar + stage
// ladan l) — pa sèlman sou #fullscreen-target — otreman, lè API Fullscreen
// reyèl la aktive, navigatè a monte sèlman eleman sa a (ak "pitit" li yo) nan
// yon "top layer" ki kouvri tout rès paj la; nav-rail/sidebar (ki se frè,
// pa pitit, #fullscreen-target) pa ka parèt ankò pa-dèsi li, kèlkeswa
// z-index yo. Sa fè bouton "playlist" pa t ka montre anlè videyo an fullscreen.
let fsFallbackActive = false;
function fsIsActive() { return !!document.fullscreenElement || fsFallbackActive; }
function toggleFullscreen(forceEnter) {
  if (forceEnter && fsIsActive()) return;
  if (!fsIsActive()) {
    const fsRoot = document.querySelector('.app-shell') || fsTarget;
    let req;
    try { req = fsRoot.requestFullscreen ? fsRoot.requestFullscreen() : null; } catch (e) { req = null; }
    if (req && typeof req.catch === 'function') req.catch(() => enterFallbackFullscreen());
    else if (!req) enterFallbackFullscreen();
  } else if (fsFallbackActive) {
    exitFallbackFullscreen();
  } else if (document.fullscreenElement) {
    document.exitFullscreen();
  }
}
btnFullscreen.onclick = () => toggleFullscreen();
stageMedia.addEventListener('dblclick', (e) => { e.preventDefault(); toggleFullscreen(); });

// Bar chèche a (bar anlè a, ak enpi tou bouton lyen brand la) rete nan
// titlebar la lè nou PA an plen ekran. Pandan plen ekran (vrè oswa
// "fallback"), #titlebar la disparèt nèt (li se yon frè .app-shell, pa yon
// pitit — API Fullscreen reyèl la sèlman rann .app-shell ak pitit li yo
// vizib, gade kòmantè "Fullscreen" pi ba a). Nou deplase eleman #search-box
// la (san detwi l — mèm nòd, mèm evènman yo rete atache) anndan
// #video-header, ki se yon PITIT #fullscreen-target/.app-shell, kidonk li
// rete vizib e li swiv menm règ parèt/disparèt (fs-idle) ak bouton play la.
function moveSearchBoxForFullscreen(intoFs) {
  if (!searchBox || !videoHeaderEl || !titlebarSearchWrap) return;
  if (intoFs) {
    if (searchBox.parentElement !== videoHeaderEl) {
      if (vhActionsEl) videoHeaderEl.insertBefore(searchBox, vhActionsEl);
      else videoHeaderEl.appendChild(searchBox);
    }
  } else if (searchBox.parentElement !== titlebarSearchWrap) {
    titlebarSearchWrap.appendChild(searchBox);
  }
}

function enterFsVisuals() {
  fsTarget.classList.add('is-fs');
  document.body.classList.add('is-fs-active');
  moveSearchBoxForFullscreen(true);
  if (!hasShownFsHint) { fsHintEl.classList.add('show'); setTimeout(() => fsHintEl.classList.remove('show'), 3000); hasShownFsHint = true; }
  resetFsIdleTimer();
  lockLandscapeOrientation();
  // Reafime mòd ekran (fit/stretch/original/crop) itilizatè a te chwazi a —
  // sa evite videyo a parèt "detire" pa aksidan si gwosè kontenè fullscreen
  // lan chanje (bar navigatè k ap parèt/disparèt) anvan CSS la fin re-kalkile.
  applyDisplayMode(settings.displayMode || 'fit');
}
function exitFsVisuals() {
  fsTarget.classList.remove('is-fs', 'fs-idle');
  document.body.classList.remove('is-fs-active');
  moveSearchBoxForFullscreen(false);
  clearTimeout(fsIdleTimer);
  unlockOrientation();
  applyDisplayMode(settings.displayMode || 'fit');
}
// Sekou pou aparèy (kèk tablèt Android, oswa navigatè ki anba yon politik
// ki bloke) ki refize/pa gen API Fullscreen — nou "simile" plen ekran an
// avèk CSS sèlman (menm klas .is-fs / .is-fs-active a) pou fonksyonalite a
// mache kanmenm, menm si se pa yon vrè Fullscreen OS.
function enterFallbackFullscreen() { fsFallbackActive = true; document.body.classList.add('fs-fallback'); enterFsVisuals(); }
function exitFallbackFullscreen() { fsFallbackActive = false; document.body.classList.remove('fs-fallback'); exitFsVisuals(); }
function exitAnyFullscreen() {
  if (fsFallbackActive) exitFallbackFullscreen();
  else if (document.fullscreenElement) document.exitFullscreen();
}

document.addEventListener('fullscreenchange', () => {
  const active = !!document.fullscreenElement;
  if (active) enterFsVisuals();
  else exitFsVisuals();
});
function lockLandscapeOrientation() {
  // Android Chrome: fè aparèy la reyèlman vire an peyizaj san moun nan
  // pa oblije vire telefòn l. Safari (iOS/iPadOS) pa sipòte API sa a —
  // nan ka sa a, sekou CSS ki nan mobile.css la pran responsablite a
  // ("fo-vire" kontni an) pandan aparèy la rete fizikman an pòtrè.
  try {
    if (screen.orientation && typeof screen.orientation.lock === 'function') {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) { /* API pa disponib sou aparèy/navigatè sa a */ }
}
function unlockOrientation() {
  try {
    if (screen.orientation && typeof screen.orientation.unlock === 'function') screen.orientation.unlock();
  } catch (e) { /* ignore */ }
}
function resetFsIdleTimer() {
  fsTarget.classList.remove('fs-idle');
  clearTimeout(fsIdleTimer);
  if (fsIsActive()) {
    fsIdleTimer = setTimeout(() => fsTarget.classList.add('fs-idle'), 2800);
  }
}
fsTarget.addEventListener('mousemove', resetFsIdleTimer);
fsTarget.addEventListener('mousedown', resetFsIdleTimer);
fsTarget.addEventListener('touchstart', resetFsIdleTimer, { passive: true });
document.getElementById('btn-exit-fs').onclick = () => exitAnyFullscreen();

/* ============================== Mini player ============================== */
btnMiniPlayer.onclick = async () => {
  if (!isMiniPlayer) {
    exitAnyFullscreen();
    closeMenuOverlay();
    await window.lmp.enterMiniPlayer();
    document.body.classList.add('mini-mode');
    isMiniPlayer = true;
  } else {
    await window.lmp.exitMiniPlayer();
    document.body.classList.remove('mini-mode');
    isMiniPlayer = false;
  }
};

/* sidebar toggle — reopen (or close) the current section's overlay */
btnToggleSidebar.onclick = () => {
  if (sidebar.classList.contains('open')) closeSidebarOverlay();
  else openSidebarOverlay();
};

/* ============================== Audio graph (visualizer + mono/boost) ============================== */
function ensureAudioGraph() {
  if (audioCtx) { connectAudioGraph(); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaElementSource(mediaEl);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    connectAudioGraph();
    if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  } catch (e) {
    console.warn('Web Audio graph pa t kapab kreye:', e.message);
  }
}
function connectAudioGraph() {
  if (!audioCtx || !sourceNode || !analyser) return;
  try { sourceNode.disconnect(); } catch (e) {}
  try { analyser.disconnect(); } catch (e) {}

  let node = sourceNode;
  if (settings.stereoMode === 'mono') {
    const splitter = audioCtx.createChannelSplitter(2);
    const gl = audioCtx.createGain(); gl.gain.value = 0.5;
    const gr = audioCtx.createGain(); gr.gain.value = 0.5;
    const mix = audioCtx.createGain();
    mix.channelCount = 1; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers';
    node.connect(splitter);
    splitter.connect(gl, 0); splitter.connect(gr, 1);
    gl.connect(mix); gr.connect(mix);
    node = mix;
  }

  eqBassNode = audioCtx.createBiquadFilter(); eqBassNode.type = 'lowshelf'; eqBassNode.frequency.value = 200; eqBassNode.gain.value = settings.eqBass || 0;
  eqMidNode = audioCtx.createBiquadFilter(); eqMidNode.type = 'peaking'; eqMidNode.frequency.value = 1000; eqMidNode.Q.value = 1; eqMidNode.gain.value = settings.eqMid || 0;
  eqTrebleNode = audioCtx.createBiquadFilter(); eqTrebleNode.type = 'highshelf'; eqTrebleNode.frequency.value = 3000; eqTrebleNode.gain.value = settings.eqTreble || 0;
  node.connect(eqBassNode); eqBassNode.connect(eqMidNode); eqMidNode.connect(eqTrebleNode);
  node = eqTrebleNode;

  masterGain = audioCtx.createGain();
  masterGain.gain.value = (settings.audioBoost || 100) / 100;
  node.connect(masterGain);
  masterGain.connect(analyser);
  analyser.connect(audioCtx.destination);
}
function populateAudioTracks() {
  const select = document.getElementById('qs-audio-track');
  if (!select) return;
  select.innerHTML = '';
  const tracks = mediaEl.audioTracks;
  if (!tracks || tracks.length <= 1) {
    select.innerHTML = '<option value="">—</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (let i = 0; i < tracks.length; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = tracks[i].label || tracks[i].language || `Track ${i + 1}`;
    opt.selected = tracks[i].enabled;
    select.appendChild(opt);
  }
  select.onchange = () => {
    const chosen = Number(select.value);
    for (let i = 0; i < tracks.length; i++) tracks[i].enabled = (i === chosen);
  };
}

function startViz() {
  if (!analyser) return;
  stopViz();
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  function draw() {
    vizRAF = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    const w = vizCanvas.width, h = vizCanvas.height;
    vizCtx.clearRect(0, 0, w, h);
    const barCount = 64;
    const step = Math.floor(bufferLength / barCount);
    const barWidth = w / barCount;
    for (let i = 0; i < barCount; i++) {
      const v = dataArray[i * step] / 255;
      const barH = Math.max(3, v * h);
      const x = i * barWidth;
      const grad = vizCtx.createLinearGradient(0, h - barH, 0, h);
      grad.addColorStop(0, 'var(--blue-3)'.includes('var') ? '#7fb2ff' : '#7fb2ff');
      grad.addColorStop(1, '#1747c9');
      vizCtx.fillStyle = grad;
      vizCtx.fillRect(x + 1, h - barH, barWidth - 2, barH);
    }
  }
  draw();
}
function stopViz() {
  if (vizRAF) cancelAnimationFrame(vizRAF);
  vizRAF = null;
  vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
}

/* ============================== Quality (HLS/DASH) ============================== */
function populateQualityFromHls() {
  const select = document.getElementById('qs-quality');
  if (!select || !hlsInstance) return;
  select.innerHTML = '<option value="auto">Auto</option>';
  hlsInstance.levels.forEach((lvl, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${lvl.height ? lvl.height + 'p' : ''} ${Math.round(lvl.bitrate / 1000)}kbps`.trim();
    select.appendChild(opt);
  });
  select.onchange = () => { hlsInstance.currentLevel = select.value === 'auto' ? -1 : Number(select.value); };
}
function populateQualityFromDash() {
  const select = document.getElementById('qs-quality');
  if (!select || !dashInstance) return;
  select.innerHTML = '<option value="auto">Auto</option>';
  try {
    const list = dashInstance.getBitrateInfoListFor('video') || [];
    list.forEach((b, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${b.height ? b.height + 'p' : ''} ${Math.round(b.bitrate / 1000)}kbps`.trim();
      select.appendChild(opt);
    });
    select.onchange = () => {
      if (select.value === 'auto') dashInstance.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
      else { dashInstance.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } }); dashInstance.setQualityFor('video', Number(select.value)); }
    };
  } catch (e) { /* ignore */ }
}

/* ============================== Subtitles ============================== */
function srtToVtt(srt) {
  let text = srt.replace(/\r+/g, '');
  if (!/^WEBVTT/.test(text.trim())) {
    text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    text = 'WEBVTT\n\n' + text;
  }
  return text;
}

let subtitleStyleTag = document.createElement('style');
document.head.appendChild(subtitleStyleTag);
function applySubtitleStyle() {
  const size = Math.round(16 * (settings.subFontSize || 100) / 100);
  subtitleStyleTag.textContent = `
    video::cue {
      font-size: ${size}px;
      color: ${settings.subFontColor || '#ffffff'};
      background-color: rgba(0,0,0,${settings.subBackground});
    }
  `;
}
applySubtitleStyle();

function applySubtitlePositionAndDelay() {
  const tt = mediaEl.textTracks[0];
  if (!tt) return;
  const cues = tt.cues;
  if (!cues) return;
  if (!subtitleOriginalCues) {
    subtitleOriginalCues = Array.from(cues).map((c) => ({ start: c.startTime, end: c.endTime }));
  }
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const orig = subtitleOriginalCues[i] || { start: c.startTime, end: c.endTime };
    c.startTime = orig.start + (settings.subDelay || 0);
    c.endTime = orig.end + (settings.subDelay || 0);
    try { c.line = settings.subPosition === 'top' ? 2 : -2; } catch (e) {}
  }
}

function attachSubtitleTrack(vttText) {
  const blob = new Blob([vttText], { type: 'text/vtt' });
  const url = URL.createObjectURL(blob);
  clearSubtitleTracks();
  const trackEl = document.createElement('track');
  trackEl.kind = 'subtitles';
  trackEl.label = 'Soutit';
  trackEl.srclang = 'ht';
  trackEl.src = url;
  trackEl.default = true;
  mediaEl.appendChild(trackEl);
  trackEl.addEventListener('load', () => {
    if (mediaEl.textTracks[0]) {
      mediaEl.textTracks[0].mode = settings.subtitlesEnabled ? 'showing' : 'hidden';
      applySubtitlePositionAndDelay();
    }
  });
}

async function autoDetectSubtitle(track) {
  try {
    const dir = await window.lmp.dirname(track.rawSource);
    const base = (await window.lmp.basename(track.rawSource)).replace(/\.[^.]+$/, '');
    for (const ext of ['srt', 'vtt']) {
      const candidate = await window.lmp.resolvePath(dir, base + '.' + ext);
      if (await window.lmp.exists(candidate)) {
        const raw = await window.lmp.readFile(candidate);
        attachSubtitleTrack(ext === 'srt' ? srtToVtt(raw) : raw);
        logEvent('Soutit', 'Detekte otomatikman: ' + candidate);
        return;
      }
    }
  } catch (e) { /* silent */ }
}

btnSubtitle.onclick = async () => {
  const path = await window.lmp.openSubtitle();
  if (!path) return;
  const raw = await window.lmp.readFile(path);
  const ext = extOf(path);
  attachSubtitleTrack(ext === 'srt' ? srtToVtt(raw) : raw);
};

/* ============================== Sidebar quick-add actions ============================== */
document.getElementById('btn-add-files').onclick = async () => {
  const paths = await window.lmp.openFiles();
  if (paths.length) addLocalPaths(paths);
};
document.getElementById('btn-empty-add-files').onclick = () => document.getElementById('btn-add-files').click();

document.getElementById('btn-add-folder').onclick = async () => {
  const paths = await window.lmp.openFolder();
  if (paths.length) addLocalPaths(paths);
};

/* ============================== URL / stream modal ============================== */
function openUrlModal() { urlModal.classList.add('open'); urlInput.value = ''; urlInput.focus(); }
function closeUrlModal() { urlModal.classList.remove('open'); }
document.getElementById('btn-add-url').onclick = openUrlModal;
document.getElementById('btn-empty-add-url').onclick = openUrlModal;
document.getElementById('url-cancel').onclick = closeUrlModal;
document.getElementById('url-confirm').onclick = async () => {
  const val = urlInput.value.trim();
  if (!val) return;
  closeUrlModal();
  await addRemoteUrl(val);
};
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('url-confirm').click();
  if (e.key === 'Escape') closeUrlModal();
});
urlModal.addEventListener('click', (e) => { if (e.target === urlModal) closeUrlModal(); });

/* ============================== Drag & drop ============================== */
window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragover'); });
window.addEventListener('dragleave', (e) => {
  if (e.target === document.body || e.target === document.documentElement) document.body.classList.remove('dragover');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files || []);
  const paths = files.map((f) => f.path).filter(Boolean);
  if (paths.length) await addLocalPaths(paths);
});

/* ============================== Connection status ============================== */
function updateConnectionStatus() {
  const online = navigator.onLine;
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.classList.toggle('offline', !online);
  text.textContent = online ? 'Connected' : 'Offline';
  const qsConn = document.getElementById('qs-connection');
  if (qsConn) qsConn.innerHTML = online ? '●&nbsp;Online' : '●&nbsp;Offline';
}
window.addEventListener('online', updateConnectionStatus);
window.addEventListener('offline', updateConnectionStatus);

/* ============================== Interface: theme / compact / accent / transparency / always-on-top / animations ============================== */
function setTheme(mode) {
  settings.theme = mode;
  saveSettings();
  const effective = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : mode;
  document.body.classList.toggle('theme-light', effective === 'light');
}
function setCompact(on) { settings.compactMode = on; saveSettings(); document.body.classList.toggle('compact', on); }
function setAnimations(on) { settings.animations = on; saveSettings(); document.body.classList.toggle('no-anim', !on); }
function setAccentColor(hex) {
  settings.accentColor = hex; saveSettings();
  document.documentElement.style.setProperty('--blue-2', hex);
  document.documentElement.style.setProperty('--blue-glow', hex);
}
async function setAlwaysOnTop(on) { settings.alwaysOnTop = on; saveSettings(); await window.lmp.setAlwaysOnTop(on); }
async function setTransparency(pct) { settings.transparency = pct; saveSettings(); await window.lmp.setOpacity(pct / 100); }

/* ============================== Settings slide-in panel ============================== */
const settingsPanel = document.getElementById('settings-panel');
const settingsScrim = document.getElementById('settings-scrim');
const settingsDetail = document.getElementById('settings-detail');
let currentCat = 'playback';

function openSettingsPanel(cat) {
  if (cat) currentCat = cat;
  settingsPanel.classList.add('open');
  settingsScrim.classList.add('open');
  document.querySelectorAll('.cat-btn').forEach((b) => b.classList.toggle('active', b.dataset.cat === currentCat));
  renderSettingsDetail(currentCat);
}
function closeSettingsPanel() { settingsPanel.classList.remove('open'); settingsScrim.classList.remove('open'); }
document.getElementById('settings-close').onclick = closeSettingsPanel;
settingsScrim.onclick = closeSettingsPanel;
document.querySelectorAll('.cat-btn').forEach((btn) => {
  btn.onclick = () => {
    currentCat = btn.dataset.cat;
    document.querySelectorAll('.cat-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderSettingsDetail(currentCat);
  };
});

function row(label, desc, controlHtml) {
  return `<div class="setting-row"><div><div class="setting-label">${label}</div>${desc ? `<div class="setting-desc">${desc}</div>` : ''}</div><div class="setting-control">${controlHtml}</div></div>`;
}
function switchHtml(id, checked) {
  return `<label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}/><span class="switch-track"></span></label>`;
}
function selectHtml(id, options, current) {
  return `<select id="${id}">${options.map((o) => `<option value="${o.value}" ${o.value === current ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
}
function rangeHtml(id, min, max, val, step) {
  return `<input type="range" id="${id}" min="${min}" max="${max}" step="${step || 1}" value="${val}" />`;
}

function renderSettingsDetail(cat) {
  const builders = {
    playback: buildCatPlayback, video: buildCatVideo, audio: buildCatAudio,
    streaming: buildCatStreaming, subtitles: buildCatSubtitles, interface: buildCatInterface,
    shortcuts: buildCatShortcuts, playlist: buildCatPlaylist, advanced: buildCatAdvanced
  };
  settingsDetail.innerHTML = (builders[cat] || buildCatPlayback)();
  bindCatEvents(cat);
}

function buildCatPlayback() {
  return `
    <h3>🎬 Playback</h3>
    <p class="cat-hint">Paramèt jeneral pou fason fichye yo jwe.</p>
    ${row('Auto Play', 'Jwe pwochen fichye a otomatikman lè younn fini.', switchHtml('set-autoAdvance', settings.autoAdvance))}
    ${row('Auto Resume', 'Kontinye kote ou te kite yon fichye lokal/videyo.', switchHtml('set-autoResume', settings.autoResume))}
    ${row('Default Quality', 'Kalite pa defo pou stream HLS ki gen plizyè kalite.', selectHtml('set-defaultQuality', [{value:'auto',label:'Auto'},{value:'highest',label:'Pi wo a'},{value:'lowest',label:'Pi ba a'}], settings.defaultQuality))}
    ${row('Playback Speed', 'Vitès lekti pa defo (0.5x–2x).', selectHtml('set-defaultSpeed', SPEEDS.map((s)=>({value:s,label:s+'x'})), settings.defaultSpeed))}
    ${row('Skip Forward', 'Konbyen segond bouton/rakousi "avanse rapid" la sote.', rangeHtml('set-skipShort', 3, 30, settings.skipShort, 1))}
    ${row('Skip Backward (long)', 'Konbyen segond touch J/L yo sote.', rangeHtml('set-skipLong', 5, 60, settings.skipLong, 1))}
    ${row('Remember Volume', 'Sonje volim ant sesyon.', switchHtml('set-rememberVolume', settings.rememberVolume))}
    ${row('Auto Fullscreen', 'Antre nan plen ekran otomatikman lè yon videyo kòmanse.', switchHtml('set-autoFullscreen', settings.autoFullscreen))}
  `;
}
function buildCatVideo() {
  return `
    <h3>📺 Video</h3>
    <p class="cat-hint">Kontwòl afichaj videyo.</p>
    ${row('Aspect Ratio / Mòd Ekran', 'Fit = ranpli san koupe · Stretch = detire · Original = gwosè orijinal · Crop = ranpli tout ekran.',
      `<div class="btn-group" id="video-mode-group">${DISPLAY_MODES.map((m)=>`<button data-mode="${m}" class="${m===settings.displayMode?'active':''}">${m}</button>`).join('')}</div>`)}
    ${row('Deinterlace', 'Aksè lekti a pa expoze yon vrè kontwòl deentrelase — bouton sa a se yon preferans, li pa chanje rezilta lekti a paske Chromium jere sa otomatikman.', switchHtml('set-deinterlace', settings.deinterlace))}
    ${row('Hardware Acceleration', 'Wè nan Advanced pou aktive/dezaktive (mande relanse aplikasyon an).', `<span class="setting-note">${settings.hardwareAcceleration ? 'ON' : 'OFF'}</span>`)}
    ${row('HDR', 'Deteksyon otomatik selon ekran ou.', `<span class="setting-note" id="hdr-detect">...</span>`)}
    ${row('Frame Rate Info', 'Estimasyon anliy pandan videyo ap jwe.', `<span class="setting-note" id="fps-info">—</span>`)}
    ${row('Video Stats', 'Estatistik reyèl soti nan motè lekti a.', `<span class="setting-note" id="video-stats">—</span>`)}
  `;
}
function buildCatAudio() {
  return `
    <h3>🔊 Audio</h3>
    ${row('Volume', '', rangeHtml('set-volume', 0, 100, volumeBar.value, 1))}
    ${row('Audio Track', 'Disponib sèlman pou fichye ki gen plizyè pis odyo entegre.', selectHtml('set-audioTrack', [{value:'',label:'—'}], ''))}
    ${row('Stereo / Mono', 'Melanje kanal ble & dwat yo an yon sèl (mono).', selectHtml('set-stereoMode', [{value:'stereo',label:'Stereo'},{value:'mono',label:'Mono'}], settings.stereoMode))}
    ${row('Audio Boost', 'Ogmante volim pi lwen pase 100% (jiska 200%).', rangeHtml('set-audioBoost', 100, 200, settings.audioBoost, 5))}
    ${row('Audio Delay', 'Fichye videyo/odyo konbine nan menm kontenè pa kite yo dekale san yo pa dekode apa — chan sa a rete pou konpatibilite men li pa gen efè reyèl kounye a.', rangeHtml('set-audioDelay', -500, 500, settings.audioDelay, 10))}
    ${row('Remember Audio Track', '', switchHtml('set-rememberAudioTrack', settings.rememberAudioTrack))}
  `;
}
function buildCatStreaming() {
  return `
    <h3>🌐 Streaming</h3>
    ${row('HLS / DASH', 'Motè entegre: hls.js + dash.js.', `<span class="setting-note">Aktif</span>`)}
    ${row('Auto Reconnect', 'Eseye rekonekte otomatikman si yon stream live pèdi koneksyon.', switchHtml('set-reconnectEnabled', settings.reconnectEnabled))}
    ${row('Reconnect Attempts', '', rangeHtml('set-reconnectAttempts', 1, 15, settings.reconnectAttempts, 1))}
    ${row('Buffer Size', 'Konbyen segond videyo HLS/DASH kenbe an mémwa alavans.', rangeHtml('set-bufferSize', 5, 90, settings.bufferSize, 5))}
    ${row('Network Timeout', 'An milisegond, pou chajman manifest/fragman.', rangeHtml('set-networkTimeout', 5000, 60000, settings.networkTimeout, 1000))}
    ${row('Low Latency Mode', 'Pou stream live ki sipòte LL-HLS/LL-DASH.', switchHtml('set-lowLatency', settings.lowLatency))}
    ${row('Stream Info', '', `<span class="setting-note" id="stream-info">${currentIndex!==-1?playlist[currentIndex].name:'Pa gen stream'}</span>`)}
    ${row('Connection Status', '', `<span class="setting-note" id="conn-status-detail">${navigator.onLine?'Online':'Offline'}</span>`)}
    ${row('Bandwidth Indicator', 'Estimasyon lajè bann hls.js la bay pandan l ap jwe.', `<span class="setting-note" id="bandwidth-info">—</span>`)}
  `;
}
function buildCatSubtitles() {
  return `
    <h3>📝 Subtitles</h3>
    ${row('Enable', '', switchHtml('set-subtitlesEnabled', settings.subtitlesEnabled))}
    ${row('Auto Detection', 'Chèche otomatikman yon fichye .srt/.vtt ki gen menm non ak videyo a.', switchHtml('set-subAutoDetect', settings.subAutoDetect))}
    ${row('Font Size', '', rangeHtml('set-subFontSize', 60, 200, settings.subFontSize, 5))}
    ${row('Font Color', '', `<input type="color" id="set-subFontColor" value="${settings.subFontColor}" />`)}
    ${row('Background Opacity', '', rangeHtml('set-subBackground', 0, 1, settings.subBackground, 0.1))}
    ${row('Position', '', selectHtml('set-subPosition', [{value:'bottom',label:'Anba'},{value:'top',label:'Anwo'}], settings.subPosition))}
    ${row('Delay', 'Dekale soutit yo an segond (+ retade / - avanse).', rangeHtml('set-subDelay', -10, 10, settings.subDelay, 0.5))}
  `;
}
function buildCatInterface() {
  return `
    <h3>🖥 Interface</h3>
    ${row('Theme', '', selectHtml('set-theme', [{value:'dark',label:'Dark'},{value:'light',label:'Light'},{value:'system',label:'System'}], settings.theme))}
    ${row('Compact Mode', 'Kontwòl ak espas pi piti.', switchHtml('set-compactMode', settings.compactMode))}
    ${row('Mini Player', 'Fè fenèt la vin tou piti epi rete anwo lòt aplikasyon yo.', `<button class="ghost-btn" id="btn-settings-mini">${isMiniPlayer ? 'Sòti Mini Player' : 'Antre Mini Player'}</button>`)}
    ${row('Always on Top', 'Kenbe fenèt la anlè tout lòt fenèt yo.', switchHtml('set-alwaysOnTop', settings.alwaysOnTop))}
    ${row('Animation', '', switchHtml('set-animations', settings.animations))}
    ${row('Accent Color', '', `<div class="color-swatches">${ACCENT_PRESETS.map((c)=>`<div class="color-swatch ${c===settings.accentColor?'active':''}" data-color="${c}" style="background:${c}"></div>`).join('')}</div>`)}
    ${row('Transparency', 'Transparans fenèt aplikasyon an.', rangeHtml('set-transparency', 60, 100, settings.transparency, 5))}
  `;
}
const SHORTCUTS_LIST = [
  ['Espas / K', 'Jwe / Poz'], ['Doub-klik', 'Antre/Sòti plen ekran'], ['F', 'Plen ekran'],
  ['Echap', 'Sòti plen ekran / fèmen fenèt'], ['← / →', 'Reyale/Avanse 5s'], ['J / L', 'Reyale/Avanse 10s'],
  ['↑ / ↓', 'Volim'], ['M', 'Mize son'], ['[ / ]', 'Vitès'], ['N / P', 'Fichye apre/anvan'],
  ['S', 'Shuffle'], ['R', 'Repete'], ['A', 'Chanje mòd ekran'], ['0–9', 'Ale nan % videyo a'],
  ['Home / End', 'Kòmansman / Prèske fen'], ['Ctrl+O', 'Ouvri fichye'], ['Ctrl+U', 'Ouvri URL'],
  ['Ctrl+S', 'Sove playlist'], ['?', 'Rakousi klavye']
];
function buildCatShortcuts() {
  return `
    <h3>⌨️ Keyboard Shortcuts</h3>
    <p class="cat-hint">Lis konplè rakousi klavye yo.</p>
    <div class="shortcuts-grid">${SHORTCUTS_LIST.map(([k,a])=>`<div class="sc-row"><kbd>${k}</kbd><span>${a}</span></div>`).join('')}</div>
  `;
}
function buildCatPlaylist() {
  return `
    <h3>📋 Playlist</h3>
    ${row('Save / Export', 'Sove tout lis aktyèl la kòm yon fichye .m3u8.', `<button class="pill-btn pill-sm" id="btn-set-save">Sove</button>`)}
    ${row('Import / Chaje', 'Chaje yon fichye .m3u/.m3u8 ki egziste.', `<button class="ghost-btn" id="btn-set-import">Enpòte</button>`)}
    ${row('Auto Load Last', 'Rechaje dènye playlist ou te louvri a otomatikman lè app la louvri.', switchHtml('set-autoLoadLast', settings.autoLoadLast))}
    ${row('Sort A-Z', 'Klase lis aktyèl la alfabetikman.', `<button class="ghost-btn" id="btn-set-sort">Klase</button>`)}
    ${row('Favorites', `${favorites.size} fichye favori.`, `<button class="ghost-btn" id="btn-set-goto-fav">Gade Favoris</button>`)}
    ${row('Recently Played', `${historyLog.length} antre nan istorik.`, `<button class="ghost-btn" id="btn-set-goto-hist">Gade Istorik</button>`)}
    ${row('Clear History', '', `<button class="ghost-btn" id="btn-set-clear-hist">Vide Istorik</button>`)}
  `;
}
function buildCatAdvanced() {
  return `
    <h3>🔧 Advanced</h3>
    ${row('Player Engine', '', `<span class="setting-note" id="engine-info">Chaje...</span>`)}
    ${row('Hardware Acceleration', 'Mande relanse aplikasyon an pou chanjman an aplike.', `${switchHtml('set-hwAccel', settings.hardwareAcceleration)}<button class="ghost-btn" id="btn-relaunch" style="margin-left:8px">Relanse</button>`)}
    ${row('Debug Mode', 'Anrejistre evènman detaye pou depanaj.', switchHtml('set-debugMode', settings.debugMode))}
    ${row('Network / Player Logs', '', '')}
    <div class="log-box" id="log-box">${debugLogs.slice(0,50).join('\n') || 'Pa gen anyen ankò.'}</div>
    ${row('Stream Headers', 'Header HTTP pèsonalize pou stream HLS (egz. Referer, Authorization). Navigatè yo bloke chanjman "User-Agent" pou rezon sekirite.', `<button class="ghost-btn" id="btn-add-header">+ Ajoute header</button>`)}
    <div id="headers-list"></div>
    ${row('User Agent', 'Valè reyèl navigatè a — pa ka chanje pou rezon sekirite.', `<span class="setting-note" style="max-width:260px;word-break:break-all">${escapeHtml(navigator.userAgent)}</span>`)}
    ${row('Cache', '', `<button class="ghost-btn" id="btn-clear-cache">Vide Cache</button>`)}
    ${row('Reset Player', 'Retabli tout paramèt yo a valè pa defo.', `<button class="ghost-btn" id="btn-reset-player">Reset</button>`)}
  `;
}

function bindCatEvents(cat) {
  const $ = (id) => document.getElementById(id);
  const bindSwitch = (id, key, cb) => { const el = $(id); if (el) el.onchange = () => { settings[key] = el.checked; saveSettings(); if (cb) cb(el.checked); }; };
  const bindRange = (id, key, cb) => { const el = $(id); if (el) el.oninput = () => { settings[key] = Number(el.value); saveSettings(); if (cb) cb(Number(el.value)); }; };
  const bindSelect = (id, key, cb) => { const el = $(id); if (el) el.onchange = () => { settings[key] = isNaN(el.value) ? el.value : Number(el.value); saveSettings(); if (cb) cb(el.value); }; };

  if (cat === 'playback') {
    bindSwitch('set-autoAdvance', 'autoAdvance');
    bindSwitch('set-autoResume', 'autoResume');
    bindSelect('set-defaultQuality', 'defaultQuality');
    bindSelect('set-defaultSpeed', 'defaultSpeed', (v) => { speedIdx = SPEEDS.indexOf(Number(v)); mediaEl.playbackRate = Number(v); btnSpeed.textContent = v + 'x'; });
    bindRange('set-skipShort', 'skipShort');
    bindRange('set-skipLong', 'skipLong');
    bindSwitch('set-rememberVolume', 'rememberVolume');
    bindSwitch('set-autoFullscreen', 'autoFullscreen');
  } else if (cat === 'video') {
    document.querySelectorAll('#video-mode-group button').forEach((b) => {
      b.onclick = () => {
        applyDisplayMode(b.dataset.mode);
        document.querySelectorAll('#video-mode-group button').forEach((x) => x.classList.toggle('active', x === b));
      };
    });
    bindSwitch('set-deinterlace', 'deinterlace');
    const hdrEl = $('hdr-detect');
    if (hdrEl) hdrEl.textContent = window.matchMedia && window.matchMedia('(dynamic-range: high)').matches ? 'Sipòte (HDR)' : 'Pa detekte / SDR';
    const fpsEl = $('fps-info');
    if (fpsEl && mediaEl.getVideoPlaybackQuality) {
      const q = mediaEl.getVideoPlaybackQuality();
      fpsEl.textContent = mediaEl.duration ? `${q.totalVideoFrames} frams total, ${q.droppedVideoFrames} tonbe` : '—';
    }
    const statsEl = $('video-stats');
    if (statsEl) statsEl.textContent = mediaEl.videoWidth ? `${mediaEl.videoWidth}x${mediaEl.videoHeight}` : '—';
  } else if (cat === 'audio') {
    const volEl = $('set-volume');
    if (volEl) volEl.oninput = () => { volumeBar.value = volEl.value; volumeBar.dispatchEvent(new Event('input')); };
    const trackSel = $('set-audioTrack');
    if (trackSel && mediaEl.audioTracks && mediaEl.audioTracks.length > 1) {
      trackSel.innerHTML = '';
      for (let i = 0; i < mediaEl.audioTracks.length; i++) {
        const opt = document.createElement('option'); opt.value = i;
        opt.textContent = mediaEl.audioTracks[i].label || `Track ${i+1}`;
        trackSel.appendChild(opt);
      }
      trackSel.onchange = () => { for (let i=0;i<mediaEl.audioTracks.length;i++) mediaEl.audioTracks[i].enabled = (i===Number(trackSel.value)); };
    }
    bindSelect('set-stereoMode', 'stereoMode', () => {
      if (currentTrackIsRemote) { showToast('Mono/Stereo pa disponib pou stream anliy (Live TV/Radio/URL) — sèlman pou fichye lokal.'); return; }
      ensureAudioGraph(); resumeAudioGraph(); connectAudioGraph();
    });
    bindRange('set-audioBoost', 'audioBoost', () => {
      if (currentTrackIsRemote) { showToast('Audio Boost pa disponib pou stream anliy (Live TV/Radio/URL) — sèlman pou fichye lokal.'); return; }
      ensureAudioGraph(); resumeAudioGraph(); connectAudioGraph();
    });
    bindRange('set-audioDelay', 'audioDelay');
    bindSwitch('set-rememberAudioTrack', 'rememberAudioTrack');
  } else if (cat === 'streaming') {
    bindSwitch('set-reconnectEnabled', 'reconnectEnabled');
    bindRange('set-reconnectAttempts', 'reconnectAttempts');
    bindRange('set-bufferSize', 'bufferSize');
    bindRange('set-networkTimeout', 'networkTimeout');
    bindSwitch('set-lowLatency', 'lowLatency');
    if (hlsInstance) {
      const bw = $('bandwidth-info');
      if (bw) setInterval(() => { if (hlsInstance && hlsInstance.bandwidthEstimate) bw.textContent = Math.round(hlsInstance.bandwidthEstimate/1000) + ' kbps'; }, 2000);
    }
  } else if (cat === 'subtitles') {
    bindSwitch('set-subtitlesEnabled', 'subtitlesEnabled', (v) => { if (mediaEl.textTracks[0]) mediaEl.textTracks[0].mode = v ? 'showing' : 'hidden'; });
    bindSwitch('set-subAutoDetect', 'subAutoDetect');
    bindRange('set-subFontSize', 'subFontSize', () => applySubtitleStyle());
    const colorEl = $('set-subFontColor'); if (colorEl) colorEl.oninput = () => { settings.subFontColor = colorEl.value; saveSettings(); applySubtitleStyle(); };
    bindRange('set-subBackground', 'subBackground', () => applySubtitleStyle());
    bindSelect('set-subPosition', 'subPosition', () => applySubtitlePositionAndDelay());
    bindRange('set-subDelay', 'subDelay', () => applySubtitlePositionAndDelay());
  } else if (cat === 'interface') {
    bindSelect('set-theme', 'theme', (v) => setTheme(v));
    bindSwitch('set-compactMode', 'compactMode', (v) => setCompact(v));
    const miniBtn = $('btn-settings-mini'); if (miniBtn) miniBtn.onclick = () => btnMiniPlayer.click();
    bindSwitch('set-alwaysOnTop', 'alwaysOnTop', (v) => setAlwaysOnTop(v));
    bindSwitch('set-animations', 'animations', (v) => setAnimations(v));
    document.querySelectorAll('.color-swatch').forEach((sw) => { sw.onclick = () => { setAccentColor(sw.dataset.color); renderSettingsDetail('interface'); }; });
    bindRange('set-transparency', 'transparency', (v) => setTransparency(v));
  } else if (cat === 'playlist') {
    $('btn-set-save').onclick = () => document.getElementById('btn-save-playlist-hidden')?.click() || saveCurrentPlaylist();
    $('btn-set-import').onclick = async () => { const paths = await window.lmp.openFiles(); for (const p of paths) { if (extOf(p)==='m3u'||extOf(p)==='m3u8') await loadPlaylistFile(p, false); } };
    bindSwitch('set-autoLoadLast', 'autoLoadLast');
    $('btn-set-sort').onclick = sortPlaylistAZ;
    $('btn-set-goto-fav').onclick = () => { closeSettingsPanel(); document.querySelector('[data-section="favorites"]').click(); };
    $('btn-set-goto-hist').onclick = () => { closeSettingsPanel(); document.querySelector('[data-section="history"]').click(); };
    $('btn-set-clear-hist').onclick = () => { historyLog = []; saveHistory(); renderSettingsDetail('playlist'); };
  } else if (cat === 'advanced') {
    window.lmp.getAppInfo().then((info) => { const el = $('engine-info'); if (el) el.textContent = `HTML5 + hls.js/dash.js · Electron ${info.electron} · Chromium ${info.chrome}`; });
    const hw = $('set-hwAccel');
    if (hw) hw.onchange = async () => { settings.hardwareAcceleration = hw.checked; saveSettings(); await window.lmp.setConfig({ hardwareAcceleration: hw.checked }); showToast('Relanse aplikasyon an pou chanjman an aplike.'); };
    const relaunchBtn = $('btn-relaunch'); if (relaunchBtn) relaunchBtn.onclick = () => window.lmp.relaunch();
    bindSwitch('set-debugMode', 'debugMode');
    $('btn-add-header').onclick = () => { renderHeadersList(true); };
    renderHeadersList(false);
    $('btn-clear-cache').onclick = async () => { await window.lmp.clearCache(); showToast('Cache vide.'); };
    $('btn-reset-player').onclick = () => {
      if (confirm('Ou sèten ou vle reset tout paramèt LMP Player yo a valè pa defo?')) {
        localStorage.clear();
        location.reload();
      }
    };
  }
}

function renderHeadersList(addBlank) {
  const container = document.getElementById('headers-list');
  if (!container) return;
  if (addBlank) settings.streamHeaders.push({ key: '', value: '' });
  container.innerHTML = settings.streamHeaders.map((h, i) => `
    <div style="display:flex;gap:6px;margin-bottom:6px;">
      <input type="text" placeholder="Header" value="${escapeHtml(h.key)}" data-idx="${i}" data-field="key" style="flex:1;background:rgba(6,12,28,0.7);border:1px solid var(--panel-border);border-radius:6px;padding:6px;color:var(--ink-0);font-size:11px;" />
      <input type="text" placeholder="Valè" value="${escapeHtml(h.value)}" data-idx="${i}" data-field="value" style="flex:1;background:rgba(6,12,28,0.7);border:1px solid var(--panel-border);border-radius:6px;padding:6px;color:var(--ink-0);font-size:11px;" />
      <button data-idx="${i}" class="header-remove ghost-btn" style="padding:4px 8px;">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('input').forEach((inp) => {
    inp.oninput = () => { settings.streamHeaders[Number(inp.dataset.idx)][inp.dataset.field] = inp.value; saveSettings(); };
  });
  container.querySelectorAll('.header-remove').forEach((btn) => {
    btn.onclick = () => { settings.streamHeaders.splice(Number(btn.dataset.idx), 1); saveSettings(); renderHeadersList(false); };
  });
}

async function saveCurrentPlaylist() {
  if (!playlist.length) { alert('Lis la vid.'); return; }
  const filePath = await window.lmp.savePlaylist('LMP-playlist.m3u8');
  if (!filePath) return;
  let content = '#EXTM3U\n';
  for (const t of playlist) content += `#EXTINF:-1,${t.name}\n${t.rawSource}\n`;
  await window.lmp.writeFile(filePath, content);
}

/* ============================== Shortcuts help ============================== */
/* The shortcuts list now lives inside Settings → Shortcuts (buildCatShortcuts),
   so "?" just opens the settings panel straight to that tab. */
function toggleShortcutsModal() { openSettingsPanel('shortcuts'); }

/* ============================== Keyboard shortcuts ============================== */
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'SELECT') return;

  const ctrlOrCmd = e.ctrlKey || e.metaKey;

  if (e.key === 'Escape') {
    if (urlModal.classList.contains('open')) { closeUrlModal(); return; }
    if (settingsPanel.classList.contains('open')) { closeSettingsPanel(); return; }
    if (navRail.classList.contains('open') || sidebar.classList.contains('open')) { closeMenuOverlay(); return; }
    if (fsIsActive()) { exitAnyFullscreen(); return; }
    return;
  }
  if (urlModal.classList.contains('open')) return;

  if (ctrlOrCmd) {
    switch (e.key.toLowerCase()) {
      case 'o': e.preventDefault(); document.getElementById('btn-add-files').click(); return;
      case 'u': e.preventDefault(); openUrlModal(); return;
      case 's': e.preventDefault(); saveCurrentPlaylist(); return;
    }
  }

  const skipShort = settings.skipShort || 5;
  const skipLong = settings.skipLong || 10;

  switch (e.key.toLowerCase()) {
    case ' ': case 'k': e.preventDefault(); togglePlay(); break;
    case 'arrowright': mediaEl.currentTime = Math.min((mediaEl.duration || 0), mediaEl.currentTime + skipShort); break;
    case 'arrowleft': mediaEl.currentTime = Math.max(0, mediaEl.currentTime - skipShort); break;
    case 'l': mediaEl.currentTime = Math.min((mediaEl.duration || 0), mediaEl.currentTime + skipLong); break;
    case 'j': mediaEl.currentTime = Math.max(0, mediaEl.currentTime - skipLong); break;
    case 'arrowup': volumeBar.value = Math.min(100, Number(volumeBar.value) + 5); volumeBar.dispatchEvent(new Event('input')); break;
    case 'arrowdown': volumeBar.value = Math.max(0, Number(volumeBar.value) - 5); volumeBar.dispatchEvent(new Event('input')); break;
    case 'f': toggleFullscreen(); break;
    case 'm': btnMute.click(); break;
    case 'n': document.getElementById('btn-next').click(); break;
    case 'p': document.getElementById('btn-prev').click(); break;
    case 's': btnShuffle.click(); break;
    case 'r': btnRepeat.click(); break;
    case 'a': btnDisplayMode.click(); break;
    case '[': speedIdx = Math.max(0, speedIdx - 1); mediaEl.playbackRate = SPEEDS[speedIdx]; btnSpeed.textContent = SPEEDS[speedIdx] + 'x'; break;
    case ']': speedIdx = Math.min(SPEEDS.length - 1, speedIdx + 1); mediaEl.playbackRate = SPEEDS[speedIdx]; btnSpeed.textContent = SPEEDS[speedIdx] + 'x'; break;
    case 'home': mediaEl.currentTime = 0; break;
    case 'end': if (mediaEl.duration) mediaEl.currentTime = Math.max(0, mediaEl.duration - 2); break;
    case '?': toggleShortcutsModal(); break;
    default:
      if (/^[0-9]$/.test(e.key) && mediaEl.duration) mediaEl.currentTime = (Number(e.key) / 10) * mediaEl.duration;
      break;
  }
});

/* ============================== OS "open with" integration ============================== */
window.lmp.onOpenMediaFiles((paths) => addLocalPaths(paths));
window.lmp.onOpenPlaylistFile((path) => loadPlaylistFile(path, false));

/* ============================== Default channels (Le Maire TV) ==============================
   Chak fwa app la louvri, li rechaje tout playlist ki vin ansanm avè l (Live TV pa kategori,
   + Radio) pou LMTV toujou rete apa nan pwòp kategori pa l, e pou tout lòt kategori yo ak
   estasyon radio yo toujou disponib san moun pa oblije re-enpòte yo chak fwa. */
async function loadDefaultChannels() {
  try {
    const bundled = await window.lmp.getBundledPlaylists();
    if (!bundled || !bundled.length) return;
    // LMTV an premye toujou, apre sa rès Live TV yo, epi Radio an dènye.
    const ordered = bundled.slice().sort((a, b) => {
      if (a.category === 'LMTV') return -1;
      if (b.category === 'LMTV') return 1;
      if (a.section !== b.section) return a.section === 'livetv' ? -1 : 1;
      return 0;
    });
    for (const entry of ordered) {
      await loadPlaylistFile(entry.path, true, false, false, {
        forceCategory: entry.category,
        forceSection: entry.section
      });
    }
  } catch (e) { console.warn('Pa t kapab chaje chèn ki vin avèk app la:', e.message); }
}
async function loadBundledPlaylistsCache() {
  try {
    const bundled = await window.lmp.getBundledPlaylists();
    if (!bundled) return;
    bundledPlaylistsCache = bundled.map((b) => ({
      name: b.category || b.file.replace(/\.[^.]+$/, ''),
      path: b.path,
      isRemote: true,
      bundled: true
    }));
    if (activeSection === 'playlists' && !playlistPreview) renderPlaylistSources();
  } catch (e) { /* ignore */ }
}
async function loadLastPlaylistIfEnabled() {
  if (settings.autoLoadLast && settings.lastPlaylistPath) {
    try { await loadPlaylistFile(settings.lastPlaylistPath, settings.lastPlaylistRemote, false, false); }
    catch (e) { /* ignore missing file */ }
  }
}

/* ============================== Stream Info panel (real data) ============================== */
function resetStreamInfo() {
  ['si-resolution','si-codec','si-fps','si-bitrate','si-connection','si-buffer','si-speed','si-network'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  prevFpsFrames = 0; prevFpsTime = 0;
}
function updateStreamInfo() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  if (currentIndex === -1) return;

  set('si-resolution', mediaEl.videoWidth ? `${mediaEl.videoWidth}x${mediaEl.videoHeight}` : 'Odyo sèlman');

  let codec = 'Pa disponib';
  try {
    if (hlsInstance && hlsInstance.levels && hlsInstance.levels[hlsInstance.currentLevel]) {
      const lvl = hlsInstance.levels[hlsInstance.currentLevel];
      codec = [lvl.videoCodec, lvl.audioCodec].filter(Boolean).join(' / ') || codec;
    } else if (dashInstance) {
      const vt = dashInstance.getCurrentTrackFor && dashInstance.getCurrentTrackFor('video');
      if (vt && vt.codec) codec = vt.codec;
    }
  } catch (e) { /* ignore */ }
  set('si-codec', codec);

  if (mediaEl.getVideoPlaybackQuality && mediaEl.videoWidth) {
    const q = mediaEl.getVideoPlaybackQuality();
    const now = performance.now();
    if (prevFpsTime) {
      const dFrames = q.totalVideoFrames - prevFpsFrames;
      const dTime = (now - prevFpsTime) / 1000;
      if (dTime > 0 && dFrames >= 0) set('si-fps', Math.round(dFrames / dTime) + ' fps');
    }
    prevFpsFrames = q.totalVideoFrames; prevFpsTime = now;
  } else {
    set('si-fps', '—');
  }

  let bitrate = '—';
  try {
    if (hlsInstance && hlsInstance.levels && hlsInstance.levels[hlsInstance.currentLevel]) {
      bitrate = Math.round(hlsInstance.levels[hlsInstance.currentLevel].bitrate / 1000) + ' kbps';
    } else if (dashInstance) {
      const list = dashInstance.getBitrateInfoListFor('video') || [];
      const idx = dashInstance.getQualityFor ? dashInstance.getQualityFor('video') : 0;
      if (list[idx]) bitrate = Math.round(list[idx].bitrate / 1000) + ' kbps';
    }
  } catch (e) { /* ignore */ }
  set('si-bitrate', bitrate);

  const online = navigator.onLine;
  const conn = navigator.connection;
  set('si-connection', online ? (conn && conn.effectiveType ? `Excellent (${conn.effectiveType})` : 'Excellent') : 'Offline');

  let bufferSec = '—';
  try {
    if (mediaEl.buffered.length) {
      bufferSec = Math.max(0, mediaEl.buffered.end(mediaEl.buffered.length - 1) - mediaEl.currentTime).toFixed(1) + 's';
    }
  } catch (e) { /* ignore */ }
  set('si-buffer', bufferSec);

  let speed = '—';
  try {
    if (hlsInstance && hlsInstance.bandwidthEstimate) speed = Math.round(hlsInstance.bandwidthEstimate / 1000) + ' kbps';
    else if (conn && conn.downlink) speed = conn.downlink + ' Mbps';
  } catch (e) { /* ignore */ }
  set('si-speed', speed);

  set('si-network', conn && conn.type ? conn.type : (online ? 'WiFi/LAN' : 'Offline'));
}
setInterval(updateStreamInfo, 2000);

/* ============================== Nav rail collapse ============================== */
btnNavCollapse.onclick = () => {
  navRail.classList.toggle('collapsed');
  document.body.classList.toggle('nav-panel-collapsed', navRail.classList.contains('collapsed'));
  btnNavCollapse.textContent = navRail.classList.contains('collapsed') ? '»' : '«';
};

/* ============================== Notifications bell ============================== */
document.getElementById('btn-notifications').onclick = () => showToast('Pa gen nouvo notifikasyon pou kounye a.');

/* ============================== Action toolbar: volume sync ============================== */
/* ============================== Action toolbar: Screenshot ============================== */
document.getElementById('btn-screenshot').onclick = () => {
  if (!mediaEl.videoWidth) { showToast('Pa gen imaj videyo pou kaptire kounye a.'); return; }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = mediaEl.videoWidth; canvas.height = mediaEl.videoHeight;
    canvas.getContext('2d').drawImage(mediaEl, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { showToast('Pa t kapab kaptire imaj la.'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'LMP-screenshot-' + Date.now() + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      showToast('Screenshot sove nan Downloads.');
    });
  } catch (e) {
    showToast('Stream sa a pa pèmèt kaptire imaj (restriksyon sekirite/CORS).');
  }
};

/* ============================== Action toolbar: Record ============================== */
let isRecording = false;
document.getElementById('btn-record').onclick = () => {
  const btn = document.getElementById('btn-record');
  if (!isRecording) {
    if (!mediaEl.videoWidth && mediaEl.style.display === 'block') { showToast('Pa gen videyo k ap jwe.'); return; }
    try {
      const stream = mediaEl.captureStream ? mediaEl.captureStream() : mediaEl.mozCaptureStream();
      recordedChunks = [];
      mediaRecorderInstance = new MediaRecorder(stream);
      mediaRecorderInstance.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorderInstance.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'LMP-record-' + Date.now() + '.webm';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast('Anrejistreman sove nan Downloads.');
      };
      mediaRecorderInstance.start();
      isRecording = true;
      btn.classList.add('recording', 'active');
      document.getElementById('record-title').textContent = 'Recording…';
      document.getElementById('record-sub').textContent = 'Klike pou sispann';
      logEvent('Record', 'Kòmanse anrejistreman.');
    } catch (e) {
      showToast('Pa t kapab kòmanse anrejistreman (restriksyon sekirite/CORS pou stream sa a).');
    }
  } else {
    if (mediaRecorderInstance) mediaRecorderInstance.stop();
    isRecording = false;
    btn.classList.remove('recording', 'active');
    document.getElementById('record-title').textContent = 'Record';
    document.getElementById('record-sub').textContent = 'Start Recording';
  }
};

/* ============================== Action toolbar: View toggle (expand video, hide info panels) ============================== */
function resetViewIdleTimer() {
  fsTarget.classList.remove('view-idle');
  clearTimeout(viewIdleTimer);
  if (fsTarget.classList.contains('view-off') && !document.fullscreenElement) {
    viewIdleTimer = setTimeout(() => fsTarget.classList.add('view-idle'), 2800);
  }
}
fsTarget.addEventListener('mousemove', resetViewIdleTimer);
fsTarget.addEventListener('mousedown', resetViewIdleTimer);
fsTarget.addEventListener('touchstart', resetViewIdleTimer, { passive: true });

document.getElementById('btn-view-toggle').onclick = function () {
  const isOff = fsTarget.classList.toggle('view-off');
  const title = document.getElementById('view-toggle-title');
  const sub = document.getElementById('view-toggle-sub');
  if (isOff) {
    this.classList.add('active');
    sub.textContent = 'Retabli Enfo';
    resetViewIdleTimer();
    showToast('Ekran videyo elaji — tape ekran an pou wè kontwòl yo.');
  } else {
    this.classList.remove('active');
    sub.textContent = 'Elaji Ekran';
    fsTarget.classList.remove('view-idle');
    clearTimeout(viewIdleTimer);
    showToast('Tout enfo yo parèt ankò.');
  }
};

/* ============================== Extra transport buttons: skip / stop ============================== */
document.getElementById('btn-skip-back').onclick = () => { mediaEl.currentTime = Math.max(0, mediaEl.currentTime - (settings.skipLong || 10)); };
document.getElementById('btn-skip-fwd').onclick = () => { mediaEl.currentTime = Math.min(mediaEl.duration || 0, mediaEl.currentTime + (settings.skipLong || 10)); };
document.getElementById('btn-stop').onclick = () => { if (currentIndex !== -1) stopPlayback(); currentIndex = -1; renderMainPanel(); };

/* ============================== Video header quick actions ============================== */
document.getElementById('btn-vh-menu').onclick = () => {
  if (navRail.classList.contains('open')) closeNavOverlay();
  else openNavOverlay();
};
document.getElementById('btn-player-settings').onclick = () => openSettingsPanel();

/* Logo/mak nan bar anlè a sèvi tou kòm yon bouton meni — menm konpòtman ak
   bouton ☰ ki nan antèt videyo a (louvri/fèmen nav-rail la). */
const titlebarBrand = document.getElementById('titlebar-brand');
if (titlebarBrand) {
  const toggleNavFromBrand = () => {
    if (navRail.classList.contains('open')) closeNavOverlay();
    else openNavOverlay();
  };
  titlebarBrand.addEventListener('click', toggleNavFromBrand);
  titlebarBrand.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleNavFromBrand(); }
  });
}

/* ============================== Settings panel footer ============================== */
document.getElementById('btn-settings-save').onclick = () => { saveSettings(); showToast('Chanjman anrejistre.'); closeSettingsPanel(); };
document.getElementById('btn-settings-reset').onclick = () => {
  if (confirm('Ou sèten ou vle reset tout paramèt LMP Media Player yo a valè pa defo?')) {
    localStorage.removeItem('lmp-settings');
    location.reload();
  }
};

/* ============================== Init ============================== */
stopPlayback();
setTheme(settings.theme || 'dark');
setCompact(!!settings.compactMode);
setAnimations(settings.animations !== false);
setAccentColor(settings.accentColor || '#2f6bff');
if (settings.alwaysOnTop) window.lmp.setAlwaysOnTop(true);
if (settings.transparency && settings.transparency < 100) window.lmp.setOpacity(settings.transparency / 100);
updateVolIcon();
updateConnectionStatus();
renderMainPanel();

window.lmp.getConfig().then((cfg) => {
  const state = cfg.hardwareAcceleration === false ? 'OFF' : 'ON';
  document.getElementById('hwaccel-state').textContent = state;
});
window.lmp.getAppInfo().then((info) => {
  document.getElementById('nav-version').textContent = 'v' + info.version;
});

loadDefaultChannels();
loadLastPlaylistIfEnabled();
loadBundledPlaylistsCache();
