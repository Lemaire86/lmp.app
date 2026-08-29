# Deplwaye LMP Media Player sou entènèt (vèsyon web/PWA)

App la deja pare pou ale sou entènèt — ou pa bezwen chanje okenn kòd, jis swiv
youn nan 3 chemen sa yo. Fichye `index.html`, `netlify.toml` ak `vercel.json`
ki nan rasin dosye a deja konfigire pou sa.

⚠️ **Enpòtan:** toujou deplwaye DOSYE `LMP-Player-Mobile/` AN ANTYE (pa jis
`src/`) — `manifest.json`, `sw.js` ak `assets/` dwe rete nan rasin domèn nan.

---

## Opsyon 1 — Netlify (pi senp, gratis)

1. Ale sou [app.netlify.com](https://app.netlify.com) → konekte/kreye kont.
2. **"Add new site" → "Deploy manually"** (drag & drop).
3. Glise dosye `LMP-Player-Mobile/` an antye (pa zip la) nan zòn nan.
4. Netlify bay ou yon lyen tankou `https://xxxx.netlify.app` — li deja
   konfigire (gras a `netlify.toml`) pou moun ka louvri jis `/` san yo pa
   oblije konnen chemen `/src/index.html` la.
5. (Opsyonèl) Nan **Site settings → Domain management**, mete yon domèn ou
   posede si ou vle youn pèsonalize.
6. Pou mizajou pita: si ou konekte Netlify a yon repo GitHub olye "deploy
   manually", chak `git push` ap re-deplwaye otomatikman.

## Opsyon 2 — Vercel

1. Ale sou [vercel.com](https://vercel.com) → konekte/kreye kont.
2. Pi fasil la se konekte yon repo GitHub (gade Opsyon 3 pi ba pou kreye l),
   epi **"Import Project"** nan Vercel, chwazi repo a.
3. Kite "Root Directory" sou rasin depo a (kote `vercel.json` ye).
4. Deplwaye — Vercel ap itilize `vercel.json` la pou fè `/` mennen dirèkteman
   sou `src/index.html`.

## Opsyon 3 — GitHub Pages (gratis, bon si ou deja itilize GitHub)

1. Kreye yon repo GitHub tou nèf (piblik), pa egzanp `lmp-player`.
2. Sou òdinatè ou (oswa via GitHub web "Upload files"), mete tout kontni
   `LMP-Player-Mobile/` an antye nan rasin repo a:
   ```bash
   cd LMP-Player-Mobile
   git init
   git add .
   git commit -m "LMP Media Player — vèsyon web"
   git branch -M main
   git remote add origin https://github.com/<itilizatè>/lmp-player.git
   git push -u origin main
   ```
3. Nan repo a sou GitHub: **Settings → Pages → Source → Deploy from a
   branch → `main` / `(root)`** → Save.
4. Apre 1-2 minit, sit la ap disponib sou
   `https://<itilizatè>.github.io/lmp-player/`. Paj rasin lan (`index.html`)
   ap otomatikman voye ou sou `/src/index.html` kote app la ye.

---

## Enstale l sou telefòn apre l deplwaye

Yon fwa lyen an ap mache (https), swiv etap "Add to Home Screen" ki deja
eksplike nan **README-MOBIL.md**.

## Verifye tout bagay mache

- Louvri lyen an nan Chrome (Android) oswa Safari (iPhone).
- Peze meni ⋮ (Chrome) oswa pataje 🔗 (Safari) → "Add to Home screen" — ikòn
  LMP la dwe parèt.
- Chwazi yon chèn nan Live TV — videyo a dwe kòmanse jwe san ou pa oblije
  antre nan plen ekran (koreksyon ki fèt dènyèman).
