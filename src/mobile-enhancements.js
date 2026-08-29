/* ==============================================================
   mobile-enhancements.js
   Konpòtman TAKTIL adisyonèl pou vèsyon mobil la sèlman:
     - Glise sou mwatye dwat ekran videyo a  -> volim monte/desann
     - Glise sou mwatye goch ekran videyo a   -> limnozite monte/desann
     - Bouton volim (#btn-mute)              -> rete APA, mize/demize sèlman;
       bar volim (#volume-bar) rete toujou vizib akote l, pa gen popup
     - Rekiperasyon lekti (play() rejte)     -> videyo pa rete "kole" lè l
       pa an plen ekran (gade blòk pi ba a pou detay)
     - Bouton "flèch monte"                  -> montre/kache pano
       "k ap jwe kounye a" (info-row) san kite fullscreen; kache l pandan
       app la an plen ekran (gade mobile.css)
   Chaje APRE renderer.js — li itilize varyab/fonksyon renderer.js la
   deja defini (mediaEl, volumeBar, elatriye), san li menm modifye
   renderer.js pou anyen ki apèn gen rapò ak mobil.
   ============================================================== */
(function () {
  'use strict';

  var stage = document.getElementById('stage-media');
  var video = document.getElementById('video-el');
  var volumeBarEl = document.getElementById('volume-bar');
  var btnMuteEl = document.getElementById('btn-mute');
  if (!stage || !video || !volumeBarEl) return;

  /* ============================== HUD (volim/limnozite) ============================== */
  var hud = document.createElement('div');
  hud.className = 'gesture-hud';
  hud.innerHTML =
    '<span class="gesture-hud-ic">🔊</span>' +
    '<span class="gesture-hud-track"><span class="gesture-hud-fill"></span></span>' +
    '<span class="gesture-hud-val">100%</span>';
  stage.appendChild(hud);
  var hudIc = hud.querySelector('.gesture-hud-ic');
  var hudFill = hud.querySelector('.gesture-hud-fill');
  var hudVal = hud.querySelector('.gesture-hud-val');
  var hudTimer = null;
  function showHud(kind, pct) {
    pct = Math.max(0, Math.min(100, pct));
    hudIc.textContent = kind === 'volume' ? (pct <= 0 ? '🔇' : pct < 50 ? '🔉' : '🔊') : '☀️';
    hudFill.style.width = Math.round(pct) + '%';
    hudVal.textContent = Math.round(pct) + '%';
    hud.classList.add('show');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () { hud.classList.remove('show'); }, 650);
  }

  /* ============================== Limnozite ==============================
     Yon paj web pa ka chanje limnozite reyèl ekran aparèy la — nou senmile
     efè a ak yon filtè CSS sou videyo a, ki se teknik estanda pou sa nan
     lektè videyo mobil sou navigatè. */
  var BRIGHT_KEY = 'lmp-mobile:brightness';
  var brightness = 100;
  try {
    var saved = parseFloat(localStorage.getItem(BRIGHT_KEY));
    if (!isNaN(saved) && saved > 0) brightness = saved;
  } catch (e) { /* ignore */ }
  function applyBrightness() { video.style.filter = 'brightness(' + (brightness / 100) + ')'; }
  applyBrightness();

  /* ============================== Jesti glise (touch) ============================== */
  function isInteractiveTarget(el) {
    return !!(el.closest && el.closest(
      'button, input, a, .transport, .action-toolbar, .video-header, .exit-fs-btn, .fs-hint, .gesture-hud'
    ));
  }

  var drag = null; // { side: 'volume'|'brightness', startY, startVal, moved }
  var DRAG_THRESHOLD = 10;

  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { drag = null; return; }
    var t = e.touches[0];
    if (isInteractiveTarget(t.target)) { drag = null; return; }
    var rect = stage.getBoundingClientRect();
    var isRight = (t.clientX - rect.left) > rect.width / 2;
    drag = {
      side: isRight ? 'volume' : 'brightness',
      startY: t.clientY,
      startVal: isRight ? Number(volumeBarEl.value) : brightness,
      moved: false
    };
  }, { passive: true });

  stage.addEventListener('touchmove', function (e) {
    if (!drag) return;
    var t = e.touches[0];
    var rect = stage.getBoundingClientRect();
    var dy = drag.startY - t.clientY; // pozitif = dwèt la monte
    if (!drag.moved && Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    if (e.cancelable) e.preventDefault();
    var deltaPct = (dy / rect.height) * 130; // glise tout wotè ekran an ~ 130%
    var val = Math.max(0, Math.min(100, drag.startVal + deltaPct));
    if (drag.side === 'volume') {
      volumeBarEl.value = Math.round(val);
      volumeBarEl.dispatchEvent(new Event('input'));
      showHud('volume', val);
    } else {
      brightness = val;
      applyBrightness();
      try { localStorage.setItem(BRIGHT_KEY, String(brightness)); } catch (e2) { /* ignore */ }
      showHud('brightness', val);
    }
  }, { passive: false });

  function endDrag() { drag = null; }
  stage.addEventListener('touchend', endDrag);
  stage.addEventListener('touchcancel', endDrag);

  /* ============================== Rekiperasyon lekti otomatik (play() rejte) ==============================
     Sou anpil navigatè mobil (sitou Safari iOS), yon apèl videoEl.play() ki fèt AN DEYÒ
     yon jès itilizatè SENKRÒN — egzanp: apre yon manifès HLS fin chaje de fason
     asenkwòn, kèk santyèm segond apre tap orijinal la — ka rejte san okenn erè
     vizib. Videyo a rete "kole" sou premye imaj la, san jwe, e sa rive sitou lè
     app la PA an plen ekran (an plen ekran, yon lòt jès — antre nan fullscreen —
     souvan fè rive gen yon dezyèm tap ki "dezenkle" l san moun nan reyalize poukisa).
     Nou entèsepte TOUT apèl .play() (san n pa modifye renderer.js), e si youn
     rejte, nou re-eseye play() DIRÈKteman nan pwochen tap itilizatè a fè nenpòt
     kote nan app la — yon jès reyèl ki toujou akseptab pou navigatè yo — e nou
     montre yon ti bouton "▶" santral pandan n ap tann pou sa sèvi kòm endikasyon. */
  var nativePlay = video.play.bind(video);
  var resumeArmed = false;
  var tapHint = document.createElement('button');
  tapHint.type = 'button';
  tapHint.className = 'tap-resume-hint';
  tapHint.setAttribute('aria-label', 'Tape pou jwe');
  tapHint.innerHTML = '<span>\u25B6</span>';
  stage.appendChild(tapHint);

  function onResumeTap() {
    if (!resumeArmed) return;
    resumeArmed = false;
    tapHint.classList.remove('show');
    var p = nativePlay();
    if (p && typeof p.catch === 'function') p.catch(function () { /* rete an poz, itilizatè a ka tape play ankò */ });
  }
  function armResume() {
    if (resumeArmed) return;
    resumeArmed = true;
    tapHint.classList.add('show');
    document.addEventListener('touchend', onResumeTap, { once: true, passive: true });
    document.addEventListener('mousedown', onResumeTap, { once: true });
  }
  function disarmResume() {
    if (!resumeArmed) { tapHint.classList.remove('show'); return; }
    resumeArmed = false;
    tapHint.classList.remove('show');
    document.removeEventListener('touchend', onResumeTap);
    document.removeEventListener('mousedown', onResumeTap);
  }
  video.play = function () {
    var p = nativePlay();
    if (p && typeof p.catch === 'function') p.catch(function () { armResume(); });
    return p;
  };
  video.addEventListener('playing', disarmResume);
  video.addEventListener('play', disarmResume);
  tapHint.addEventListener('click', onResumeTap);

  /* ============================== Bouton volim ==============================
     Bouton mize/demize a (#btn-mute) rete yon bouton APA ki fè sèlman yon sèl
     travay — mize/demize (jan renderer.js deja jere l) — e bar volim lan
     (#volume-bar) se yon bar òdinè, orizontal, toujou vizib akote l (jan mobile.css
     defini l), egzakteman tankou sou vèsyon òdinatè a. Pa gen popup ki ka "bare". */

  /* ============================== Bouton "flèch monte": pano k ap jwe ============================== */
  var toolbar = document.getElementById('action-toolbar');
  var infoRow = document.getElementById('info-row');
  var expandBtn = null;
  if (toolbar && infoRow) {
    expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.id = 'btn-mobile-info-toggle';
    expandBtn.className = 'action-btn mobile-expand-btn';
    expandBtn.title = 'Montre/kache enfo k ap jwe kounye a';
    expandBtn.innerHTML = '<span class="action-ic">▲</span>';
    toolbar.insertBefore(expandBtn, toolbar.firstChild);

    function setInfoOpen(open) {
      infoRow.classList.toggle('mobile-open', open);
      expandBtn.classList.toggle('open', open);
      expandBtn.querySelector('.action-ic').textContent = open ? '▼' : '▲';
    }
    expandBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setInfoOpen(!infoRow.classList.contains('mobile-open'));
    });
    document.addEventListener('click', function (e) {
      if (infoRow.classList.contains('mobile-open') &&
          !infoRow.contains(e.target) && e.target !== expandBtn && !expandBtn.contains(e.target)) {
        setInfoOpen(false);
      }
    });
  }

  /* ============================== Deplase bouton yo bò kot bouton volim la ==============================
     Player Settings, Record, Screenshot ak flèch monte a — retire yo nan ranje aksyon
     apa a (anwo), mete yo nan menm ranje ak bouton volim lan (anba nèt, nan transport la),
     tout ak menm gwosè ak lòt bouton kontwòl yo (ctl-btn). */
  var volWrapEl = document.querySelector('.volume-wrap');
  var controlsRight = document.querySelector('.controls-right');
  if (controlsRight && volWrapEl) {
    var toMove = [
      document.getElementById('btn-player-settings'),
      document.getElementById('btn-record'),
      document.getElementById('btn-screenshot'),
      expandBtn
    ];
    toMove.forEach(function (btn) {
      if (!btn) return;
      btn.classList.add('mobile-inline-ctl');
      controlsRight.insertBefore(btn, volWrapEl);
    });
  }
})();
