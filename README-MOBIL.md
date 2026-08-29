# LMP Media Player — Vèsyon Mobil (PWA)

Sa a se yon vèsyon **aplikasyon web mobil (PWA)** — pa yon app Electron.
Li itilize menm mòtè lekti a (HTML5 + hls.js/dash.js) ak menm gabari
vizyèl la, men li adapte pou l mache dirèkteman nan navigatè telefòn
ou (Chrome/Safari), e ou ka **"Enstale l" sou ekran akèy la** pou l
louvri tankou yon app nòmal, san bar adrès navigatè a.

## Kijan pou mete l sou telefòn ou

Yon PWA fòk sèvi via **http(s)** — li pa ka louvri dirèkteman ak
`file://` (double-klike sou index.html) paske Service Worker ak
`fetch()` pou playlist yo pa mache konsa.

1. Mete tout dosye `LMP-Player-Mobile/` sou yon sèvè web (Netlify,
   Vercel, GitHub Pages, oswa nenpòt ti sèvè lokal tankou
   `npx serve .` oswa `python3 -m http.server`).
2. Louvri `https://<domèn-ou>/src/index.html` nan Chrome (Android)
   oswa Safari (iPhone/iPad).
3. **Android (Chrome):** peze meni ⋮ → **"Add to Home screen" / "Enstale app"**.
   **iPhone (Safari):** peze bouton pataje 🔗 → **"Add to Home Screen"**.
4. Ikòn LMP la ap parèt sou ekran akèy la — lè w louvri l, li plen tout
   ekran an san bar navigatè, tankou yon app native.

## Sa ki chanje parapò ak vèsyon desktop (Electron) la

- **Player a ak Player Settings** rete idantik.
- **Kat "K ap Jwe Kounye a" ak "Stream Information"** retire nèt sou
  mobil pou bay videyo a plis espas — ekran an monte otomatikman
  jiska tèt bar kontwòl la (bouton play).
- **Screenshot ak Record** vin bouton ti wonn, ikòn sèlman (san tèks),
  pou yo pran mwens plas sou yon ekran telefòn.
- **Meni yo (Home/Live TV/Radio/… ak lis chèn/videyo yo)** kounye a
  ouvri tankou yon **popup santre** olye yon panno ki kole sou bò
  gòch la — e paj la aksepte **pinch-zoom** (ou ka zoome pou li l pi
  byen).
- Bouton fenèt (minimize/maximize/close) ak **Mini Player** retire,
  paske yo se fonksyon fenèt Windows/Mac ki pa gen sans sou telefòn.

## Limit platfòm mobil (pa yon bug — se jan navigatè yo fèt)

- **"📁 Dosye"** (chwazi yon dosye antye) mache sou **Android
  Chrome**, men **iPhone Safari pa sipòte** chwazi yon dosye — sou
  iPhone, chwazi fichye endividyèlman ak **"＋ Fichye"** pito.
- Fichye lokal ou chwazi sou telefòn (via pikè fichye a) se yon kopi
  tanporè navigatè a jere (blob) — yo **pa gen yon "chemen dosye"
  reyèl**. Sa vle di: si yon playlist `.m3u` lokal gen lyen ki pwente
  sou lòt fichye nan menm dosye a (chemen relatif), sa **p ap mache**
  sou mobil (men lyen dirèk sou entènèt/HTTP nan yon `.m3u` toujou
  mache san pwoblèm).
- "Save Playlist" deklanche yon **telechajman** (tankou lè w
  telechaje nenpòt fichye sou telefòn) olye yon bwat dyalòg "Save As".
- Pa gen "double-klike yon videyo pou louvri app la" tankou sou
  Windows/Mac — sa se yon fonksyon OS desktop.

## Sekirite/orijin

`manifest.json` ak `sw.js` fòk sèvi soti nan **rasin domèn nan**
(https). Si w eseye louvri fichye yo dirèkteman san yon sèvè web,
Service Worker la p ap anrejistre e enstalasyon "Add to Home Screen"
lan ka pa disponib — sa se yon règ sekirite navigatè yo enpoze, li pa
yon erè nan kòd la.
