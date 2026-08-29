# LMP Media Player — LE MAIRE Media Player

Yon lekteur medya desktop (Windows / macOS / Linux) ki jwe:

- **Videyo**: MP4, WebM, OGV, MOV, M4V, ak lòt fòma navigatè Chromium sipòte
- **Odyo**: MP3, WAV, FLAC, AAC, M4A, OGA
- **Playlist**: fichye `.m3u` ak `.m3u8` (chaje ak sove)
- **Stream HLS**: lyen `.m3u8` dirèk (live TV, radyo online) grasa `hls.js`
- Fichye lokal (Ouvri fichye / Ouvri dosye antye) ak drag-and-drop
- Kontwòl konplè: play/poz, next/prev, seek, volim, vitès (0.5x–2x), shuffle, repete (tout / youn), soutit (.srt/.vtt), plen ekran, vizualizè odyo

## ⚠️ Limit teknik enpòtan

Sa a se yon aplikasyon Electron (Chromium + Node.js) — se sa k fè li ka enstale tankou yon vrè app desktop. Men, tankou nenpòt navigatè, li itilize dekodè (codecs) natif Chromium bay:

- **MKV/AVI ak kèk codec spesyal** (DivX, XviD ansyen, kèk odyo AC3/DTS) **pa ka jwe san yo pa konvèti**, paske Chromium pa gen dekodè sa yo entegre pou rezon lisans. VLC ka fè sa paske li mare ak pwòp lib FFmpeg li ki gen tout codec yo — pou LMP Media Player rive menm nivo a nèt, ta dwe entegre yon moteur natif tankou `mpv`/`libmpv` oswa FFmpeg konplè, sa se yon pwochen etap posib si ou vle.
- Pou kounye a, MP4 (H.264/AAC), WebM (VP8/VP9/Opus), ak tout fòma odyo estanda yo ap mache san pwoblèm.

## Enstalasyon (pou devlope / teste)

```bash
cd LMP-Player
npm install
npm start
```

## Kreye yon enstalasyon (.exe / .dmg / .AppImage)

```bash
# Sou Windows (kreye .exe/NSIS installer):
npm run dist:win

# Sou macOS (kreye .dmg):
npm run dist:mac

# Sou Linux (kreye .AppImage + .deb):
npm run dist:linux
```

> **Enpòtan:** ou dwe lanse `npm run dist:win` sou yon machin Windows (oswa `dist:mac` sou macOS) pou jenere enstalasyon ki fonksyone byen pou platfòm sa a. `electron-builder` telechaje eleman li bezwen sou entènèt pandan premye build la.

Fichye enstalasyon final yo ap parèt nan dosye `release/`.

## Rakousi klavye

| Touch | Aksyon |
|---|---|
| `Espas` | Play / Poz |
| `←` `→` | Retounen / Avanse 5s |
| `↑` `↓` | Volim |
| `F` | Plen ekran |
| `M` | Mize son |

## Estrikti pwojè a

```
LMP-Player/
├── main.js          → pwosesis prensipal Electron (fenèt, dyalòg fichye)
├── preload.js        → pon sekirite ant Electron ak entèfas la
├── package.json       → konfigirasyon + script pou kreye enstalatè
├── src/
│   ├── index.html      → estrikti entèfas la
│   ├── styles.css      → tèm ble/glass ki matche logo a
│   └── renderer.js     → tout lojik: playlist, m3u/m3u8, HLS, kontwòl
└── assets/
    ├── icon.png         → icon aplikasyon an (glyph la, san background)
    └── logo.png         → logo ki parèt anndan app la (vèsyon kare a)
    └── vendor/hls.min.js → librairi HLS
```
