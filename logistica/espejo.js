/**
 * MANO APP — Espejo IA v2.2 (Video desacoplado de la IA)
 *
 * Arquitectura de 3 capas independientes:
 *   1. VIDEO: el elemento <video> corre a FPS nativo (60fps) — siempre fluido
 *   2. RENDER LOOP (RAF): dibuja el esqueleto cacheado a 60fps sobre el canvas
 *   3. AI LOOP: procesa frames a ~13fps con MediaPipe en segundo plano
 *
 * El video nunca espera a la IA → cámara completamente fluida.
 */

/* ══════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════ */
const CFG = {
  stabilityFrames:  6,
  movHistoryLen:    28,
  commitCooldownMs: 1400,
  minSwingX:        0.055,
  minSwingY:        0.04,
  minDirChanges:    3,
  aiIntervalMs:     75,   // IA procesa a ~13fps (video sigue a 60fps independiente)
};

/* ══════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════ */
let espejoHands      = null;
let espejoCamera     = null;
let espejoActivo     = false;
let espejoModoActual = 'letras';
let espejoFacingMode = 'user';

// Canvas cacheado (solo se obtiene una vez)
let _canvas = null;
let _ctx    = null;

// RAF para el render loop (independiente de la IA)
let _rafId  = null;

// Últimos landmarks detectados por la IA (cacheados para el render loop)
let _cachedLandmarks = [];

// Throttle de la IA
let _lastAITime = 0;

// Buffers de estabilidad por mano [mano0, mano1]
let stabBuffers  = [[], []];

// Historial de muñeca por mano [{x,y}]
let wristHistory = [[], []];

// Cache del último estado mostrado (evita reescribir DOM)
let _lastLetter  = ['', ''];
let _lastGesture = '';

// Modo palabras
let textoAcumulado = [];
let lastCommitted  = [null, null];
let inCooldown     = [false, false];

/* ══════════════════════════════════════
   INFORMACIÓN DE LETRAS Y PALABRAS
══════════════════════════════════════ */
const LETRAS_INFO = {
  'A':'Puño, pulgar al lado',      'B':'Cuatro dedos arriba',
  'C':'Forma de C',                'D':'Índice arriba, pulgar al medio',
  'E':'Dedos curvados a la palma', 'F':'Pulgar e índice se tocan',
  'G':'Índice y pulgar laterales', 'H':'Índice y medio horizontales',
  'I':'Solo meñique arriba',       'K':'Índice, medio y pulgar',
  'L':'Pulgar e índice en L',      'M':'Pulgar bajo tres dedos',
  'N':'Pulgar bajo dos dedos',     'O':'Todos forman una O',
  'R':'Índice y medio cruzados',   'S':'Puño, pulgar encima',
  'T':'Pulgar entre dedos',        'U':'Índice y medio juntos',
  'V':'Índice y medio en V',       'W':'Tres dedos separados',
  'Y':'Pulgar y meñique',
};

const PALABRAS_INFO = {
  'hola':      { texto:'Hola',           emoji:'👋' },
  'adios':     { texto:'Adiós',          emoji:'🤚' },
  'si':        { texto:'Sí',             emoji:'✅' },
  'no':        { texto:'No',             emoji:'❌' },
  'gracias':   { texto:'Gracias',        emoji:'🙏' },
  'bien':      { texto:'Bien',           emoji:'👍' },
  'mal':       { texto:'Mal',            emoji:'👎' },
  'tequiero':  { texto:'Te quiero',      emoji:'🤟' },
  'paz':       { texto:'Paz',            emoji:'✌️' },
  'llamar':    { texto:'Llamar',         emoji:'🤙' },
  'ok':        { texto:'OK / Todo bien', emoji:'👌' },
  'usted':     { texto:'Usted / Tú',     emoji:'👉' },
  'comoestas': { texto:'¿Cómo estás?',   emoji:'🤔' },
};

/* ══════════════════════════════════════
   COLORES POR MANO
══════════════════════════════════════ */
const HAND_COLORS = ['#22d3ee', '#f472b6'];

/* ══════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════ */
function initEspejo() {
  if (espejoActivo) return;
  showEspejoMode('letras');

  if (typeof Hands === 'undefined') {
    setEspejoStatus('⚠️ Abre la app desde un servidor HTTP (Live Server)');
    return;
  }

  // Cachear canvas y context
  _canvas = document.getElementById('espejo-canvas');
  _ctx    = _canvas ? _canvas.getContext('2d', { willReadFrequently: false }) : null;

  const video = document.getElementById('espejo-video');
  if (!video || !_ctx) return;

  // ── CLAVE: mostrar el video directamente (ya no lo dibujamos en canvas) ──
  video.style.opacity   = '1';
  video.style.transform = espejoFacingMode === 'user' ? 'scaleX(-1)' : 'none';

  // Canvas solo tiene el esqueleto encima — fondo transparente
  _canvas.style.background = 'transparent';

  // Inicializar MediaPipe Hands
  espejoHands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });

  espejoHands.setOptions({
    maxNumHands:            2,
    modelComplexity:        0,     // Lite model: 2x más rápido
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.55,
  });

  espejoHands.onResults(onEspejoResults);

  // Camera utility solo maneja el stream → no dibuja nada
  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (!espejoActivo || !espejoHands) return;
      // ── Throttle de la IA: solo procesa a ~13fps ──
      const now = performance.now();
      if (now - _lastAITime < CFG.aiIntervalMs) return;
      _lastAITime = now;
      await espejoHands.send({ image: video });
    },
    width: 320, height: 240,
    facingMode: espejoFacingMode,
  });

  espejoCamera.start();
  espejoActivo = true;

  // ── Iniciar render loop independiente (60fps) ──
  _startRenderLoop();
}

/* ══════════════════════════════════════
   RENDER LOOP — independiente de la IA
   Dibuja el esqueleto cacheado a 60fps
══════════════════════════════════════ */
function _startRenderLoop() {
  if (_rafId) cancelAnimationFrame(_rafId);

  function loop() {
    if (!espejoActivo || !_ctx || !_canvas) return;

    // Limpiar solo el canvas (no el video — el video es el elemento <video>)
    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    // Dibujar el esqueleto de cada mano usando los últimos datos de la IA
    _cachedLandmarks.forEach((lm, hi) => {
      if (hi > 1) return;
      drawHand(_ctx, _canvas, lm, HAND_COLORS[hi]);
    });

    _rafId = requestAnimationFrame(loop);
  }

  _rafId = requestAnimationFrame(loop);
}

/* ══════════════════════════════════════
   TOGGLE CÁMARA
══════════════════════════════════════ */
function espejoToggleCamara() {
  espejoFacingMode = espejoFacingMode === 'user' ? 'environment' : 'user';
  if (!espejoActivo || !espejoCamera) return;

  const video = document.getElementById('espejo-video');
  if (video) video.style.transform = espejoFacingMode === 'user' ? 'scaleX(-1)' : 'none';

  espejoCamera.stop();
  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (!espejoActivo || !espejoHands) return;
      const now = performance.now();
      if (now - _lastAITime < CFG.aiIntervalMs) return;
      _lastAITime = now;
      await espejoHands.send({ image: video });
    },
    width: 320, height: 240,
    facingMode: espejoFacingMode,
  });
  espejoCamera.start();
}

/* ══════════════════════════════════════
   STOP ESPEJO
══════════════════════════════════════ */
function stopEspejo() {
  espejoActivo = false;

  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (espejoCamera) { espejoCamera.stop(); espejoCamera = null; }
  if (espejoHands)  { espejoHands.close();  espejoHands  = null; }

  // Ocultar video de nuevo
  const video = document.getElementById('espejo-video');
  if (video) { video.style.opacity = '0'; video.style.transform = 'none'; }

  _cachedLandmarks = [];
  _canvas = null; _ctx = null;
  stabBuffers   = [[], []];
  wristHistory  = [[], []];
  lastCommitted = [null, null];
  inCooldown    = [false, false];
  _lastLetter   = ['', ''];
  _lastGesture  = '';
}

function setEspejoStatus(msg) {
  ['espejo-live-desc-0', 'espejo-live-desc-1'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  });
}

/* ══════════════════════════════════════
   CALLBACK DE LA IA (no dibuja al canvas)
   Solo actualiza los datos y el DOM
══════════════════════════════════════ */
function onEspejoResults(results) {
  // Cachear landmarks para que el render loop los dibuje
  _cachedLandmarks = results.multiHandLandmarks || [];

  const handsLM = _cachedLandmarks;

  if (handsLM.length === 0) {
    stabBuffers = [[], []];
    _trimHistory();
    _showNoHands();
    return;
  }

  // Recolectar el mejor gesto entre todas las manos (modo palabras)
  let bestGesto = null;

  handsLM.forEach((lm, hi) => {
    if (hi > 1) return;

    // Actualizar historial de muñeca
    wristHistory[hi].push({ x: lm[0].x, y: lm[0].y });

    const mov = _analyzeMovement(wristHistory[hi]);

    if (espejoModoActual === 'letras') {
      _processLetraMode(lm, hi);
    } else {
      const g = clasificarPalabra(lm, mov);
      if (g) bestGesto = { gesto: g, hi };
    }
  });

  // Trim historial UNA vez por frame de IA
  _trimHistory();

  // Actualizar display de palabras
  if (espejoModoActual === 'palabras') {
    if (bestGesto) {
      _commitGesto(bestGesto.gesto, bestGesto.hi);
    } else {
      handsLM.forEach((_, hi) => {
        if (hi > 1) return;
        if (!inCooldown[hi]) lastCommitted[hi] = null;
      });
      _updateInstantDisplay(null);
    }
  }

  // Resetear panel de la mano que no está detectada
  if (handsLM.length < 2) {
    _resetHandPanel(1);
    stabBuffers[1] = [];
  }
}

/* ══════════════════════════════════════
   MODO LETRAS
══════════════════════════════════════ */
function _processLetraMode(lm, hi) {
  const letra    = clasificarLetra(lm);
  const letterEl = document.getElementById(`espejo-live-letter-${hi}`);
  const descEl   = document.getElementById(`espejo-live-desc-${hi}`);
  if (!letterEl || !descEl) return;

  if (letra) {
    stabBuffers[hi].push(letra);
    if (stabBuffers[hi].length > CFG.stabilityFrames) stabBuffers[hi].shift();

    const buf    = stabBuffers[hi];
    const stable = buf.length >= 4 && buf.every(l => l === letra);

    if (stable && _lastLetter[hi] !== letra) {
      _lastLetter[hi]      = letra;
      letterEl.textContent = letra;
      letterEl.className   = 'espejo-live-letter detected';
      descEl.textContent   = LETRAS_INFO[letra] || '';
    }
  } else {
    stabBuffers[hi] = [];
    if (_lastLetter[hi] !== '') {
      _lastLetter[hi]      = '';
      letterEl.textContent = '—';
      letterEl.className   = 'espejo-live-letter';
      descEl.textContent   = 'Muestra tu mano';
    }
  }
}

/* ══════════════════════════════════════
   MODO PALABRAS
══════════════════════════════════════ */
function _commitGesto(gesto, hi) {
  const info = PALABRAS_INFO[gesto];
  if (!info) return;

  _updateInstantDisplay(gesto);

  if (!inCooldown[hi] && gesto !== lastCommitted[hi]) {
    textoAcumulado.push(info.texto);
    lastCommitted[hi] = gesto;
    renderTextoAcumulado();
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    inCooldown[hi] = true;
    setTimeout(() => {
      inCooldown[hi]    = false;
      lastCommitted[hi] = null;
    }, CFG.commitCooldownMs);
  }
}

function _updateInstantDisplay(gesto) {
  if (gesto === _lastGesture) return;
  _lastGesture = gesto;

  const el = document.getElementById('espejo-instant-detect');
  if (!el) return;

  if (gesto) {
    const info = PALABRAS_INFO[gesto];
    if (info) {
      el.innerHTML = `<span class="instant-emoji">${info.emoji}</span><span class="instant-label">${info.texto}</span>`;
      el.className = 'espejo-instant-detect active';
    }
  } else {
    el.innerHTML = '<span class="instant-label">Muestra una seña…</span>';
    el.className = 'espejo-instant-detect';
  }
}

/* ══════════════════════════════════════
   ANÁLISIS DE MOVIMIENTO
══════════════════════════════════════ */
function _analyzeMovement(history) {
  const len = history.length;
  if (len < 10) return { isWaving:false, isNodding:false, isShaking:false, movingDown:false };

  const start = Math.max(0, len - CFG.movHistoryLen);
  let xChanges = 0, lastXDir = 0;
  let yChanges = 0, lastYDir = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let firstY = null, lastY = null;

  for (let i = start; i < len; i++) {
    const h = history[i];
    if (!h) continue;
    if (h.x < minX) minX = h.x;
    if (h.x > maxX) maxX = h.x;
    if (h.y < minY) minY = h.y;
    if (h.y > maxY) maxY = h.y;
    if (firstY === null) firstY = h.y;
    lastY = h.y;

    if (i > start) {
      const prev = history[i - 1];
      if (!prev) continue;
      const dx = h.x - prev.x;
      const dy = h.y - prev.y;
      if (Math.abs(dx) > 0.007) {
        const d = dx > 0 ? 1 : -1;
        if (lastXDir && d !== lastXDir) xChanges++;
        lastXDir = d;
      }
      if (Math.abs(dy) > 0.007) {
        const d = dy > 0 ? 1 : -1;
        if (lastYDir && d !== lastYDir) yChanges++;
        lastYDir = d;
      }
    }
  }

  const rangeX = maxX - minX;
  const rangeY = maxY - minY;
  const netY   = (lastY !== null && firstY !== null) ? lastY - firstY : 0;

  return {
    isWaving:   xChanges >= CFG.minDirChanges && rangeX > CFG.minSwingX,
    isNodding:  yChanges >= CFG.minDirChanges && rangeY > CFG.minSwingY,
    isShaking:  xChanges >= CFG.minDirChanges && rangeX > CFG.minSwingX,
    movingDown: netY > 0.07 && yChanges <= 2,
  };
}

function _trimHistory() {
  const max = CFG.movHistoryLen + 5;
  for (let i = 0; i < 2; i++) {
    if (wristHistory[i].length > max)
      wristHistory[i] = wristHistory[i].slice(-max);
  }
}

/* ══════════════════════════════════════
   GEOMETRÍA
══════════════════════════════════════ */
function dist(a, b) {
  const dx = a.x-b.x, dy = a.y-b.y, dz = (a.z||0)-(b.z||0);
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}
function hsize(lm) { return dist(lm[0], lm[9]); }

function fingers(lm) {
  const hs = hsize(lm);
  return {
    P:  dist(lm[4], lm[0]) > dist(lm[2], lm[0]) * 1.12,
    I:  lm[8].y  < lm[6].y,
    Me: lm[12].y < lm[10].y,
    A:  lm[16].y < lm[14].y,
    Mi: lm[20].y < lm[18].y,
    hs,
  };
}

function touchPI(lm, hs)  { return dist(lm[4], lm[8])  < hs * 0.30; }
function touchPMe(lm, hs) { return dist(lm[4], lm[12]) < hs * 0.30; }
function spreadIM(lm, hs) { return dist(lm[8], lm[12]) / hs; }

function esFormaL(lm) {
  const pv = { x: lm[4].x-lm[2].x, y: lm[4].y-lm[2].y };
  const iv = { x: lm[8].x-lm[5].x, y: lm[8].y-lm[5].y };
  const dot = pv.x*iv.x + pv.y*iv.y;
  const mag = Math.sqrt(pv.x*pv.x+pv.y*pv.y) * Math.sqrt(iv.x*iv.x+iv.y*iv.y);
  if (!mag) return false;
  const a = Math.acos(Math.max(-1, Math.min(1, dot/mag))) * 180/Math.PI;
  return a > 55 && a < 130;
}

function esFormaC(lm, hs) {
  hs = hs || hsize(lm);
  const r = dist(lm[4], lm[8]) / dist(lm[5], lm[17]);
  return r > 0.28 && r < 0.85;
}

function esFormaO(lm, hs) {
  hs = hs || hsize(lm);
  const t = hs * 0.38;
  return dist(lm[4],lm[8]) < t && dist(lm[4],lm[12]) < t*1.3 && dist(lm[4],lm[16]) < t*1.5;
}

function esPoseE(lm, hs) {
  hs = hs || hsize(lm);
  const p = lm[9], lim = hs * 0.82;
  return dist(lm[8],p)<lim && dist(lm[12],p)<lim && dist(lm[16],p)<lim && dist(lm[20],p)<lim;
}

function esPulgarArriba(lm) { return lm[4].y < lm[0].y - 0.05; }
function esPulgarAbajo(lm)  { return lm[4].y > lm[0].y + 0.08; }

/* ══════════════════════════════════════
   CLASIFICADOR LETRAS
══════════════════════════════════════ */
function clasificarLetra(lm) {
  const { P, I, Me, A, Mi, hs } = fingers(lm);
  const ext4 = (I?1:0)+(Me?1:0)+(A?1:0)+(Mi?1:0);
  const tPI  = touchPI(lm, hs);
  const tPMe = touchPMe(lm, hs);
  const sIM  = spreadIM(lm, hs);
  const thumbOverFing = lm[4].y > lm[6].y && lm[4].y > lm[10].y;

  if (tPI && Me && A && Mi && !I)     return 'F';
  if (esFormaO(lm, hs))              return 'O';
  if (I && !Me && !A && !Mi && tPMe) return 'D';

  if (!P && I && Me && !A && !Mi) {
    if (sIM < 0.22) return 'R';
    if (sIM < 0.38) return 'U';
    return 'V';
  }

  if (!P && I && Me && A && Mi)  return 'B';
  if (!P && I && Me && A && !Mi) return 'W';
  if (P && I && !Me && !A && !Mi) return esFormaL(lm) ? 'L' : 'G';
  if (P && !I && !Me && !A && Mi) return 'Y';
  if (!P && I && !Me && !A && !Mi) return 'D';
  if (!P && !I && !Me && !A && Mi) return 'I'; // FIX: estaba inalcanzable antes

  if (ext4 === 0) {
    if (esFormaC(lm, hs))  return 'C'; // FIX: estaba después del return 'A'
    if (esFormaO(lm, hs))  return 'O';
    if (lm[4].y > lm[6].y && lm[4].y > lm[10].y && lm[4].y > lm[14].y) return 'M';
    if (lm[4].y > lm[6].y && lm[4].y > lm[10].y && lm[4].y <= lm[14].y) return 'N';
    if (esPoseE(lm, hs))   return 'E';
    if (thumbOverFing && P) return 'S';
    if (lm[4].y < lm[8].y && lm[4].y > lm[5].y) return 'T';
    return 'A';
  }

  return null;
}

/* ══════════════════════════════════════
   CLASIFICADOR PALABRAS
══════════════════════════════════════ */
function clasificarPalabra(lm, mov) {
  const { P, I, Me, A, Mi, hs } = fingers(lm);
  const allOpen = I && Me && A && Mi;
  const fist    = !I && !Me && !A && !Mi;
  const idxOnly = !P && I && !Me && !A && !Mi;

  if (mov) {
    if (allOpen && mov.isWaving)   return 'hola';
    if (fist    && mov.isNodding)  return 'si';
    if (idxOnly && mov.isShaking)  return 'no';
    if (allOpen && mov.movingDown) return 'gracias';
  }

  if ( P && !I && !Me && !A && !Mi && esPulgarArriba(lm)) return 'bien';
  if ( P && !I && !Me && !A && !Mi && esPulgarAbajo(lm))  return 'mal';
  if ( P && I  && !Me && !A && Mi)                         return 'tequiero';
  if (!P && I  && Me  && !A && !Mi)                        return 'paz';
  if ( P && !I && !Me && !A && Mi)                         return 'llamar';
  if (!I && Me && A   && Mi && touchPI(lm, hs))            return 'ok';
  if (idxOnly)                                             return 'usted';
  if (!I && !Me && !A && !Mi && esFormaC(lm, hs))         return 'comoestas';

  return null;
}

/* ══════════════════════════════════════
   DIBUJO DEL ESQUELETO
   Batch drawing: 1 stroke() para todas las conexiones
══════════════════════════════════════ */
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],[5,17],
];

function drawHand(ctx, canvas, lm, color) {
  const flip = espejoFacingMode === 'user';
  const W = canvas.width, H = canvas.height;

  // Precomputar todos los puntos
  const pts = new Float32Array(42);
  for (let i = 0; i < 21; i++) {
    pts[i*2]   = (flip ? 1 - lm[i].x : lm[i].x) * W;
    pts[i*2+1] = lm[i].y * H;
  }

  // ── Un único ctx.stroke() para TODAS las conexiones ──
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5;
  ctx.globalAlpha = 0.9;
  for (let k = 0; k < HAND_CONNECTIONS.length; k++) {
    const a = HAND_CONNECTIONS[k][0];
    const b = HAND_CONNECTIONS[k][1];
    ctx.moveTo(pts[a*2], pts[a*2+1]);
    ctx.lineTo(pts[b*2], pts[b*2+1]);
  }
  ctx.stroke();

  // ── Puntos ──
  ctx.fillStyle   = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 1.0;
  for (let i = 0; i < 21; i++) {
    const r = i === 0 ? 6 : i % 4 === 0 ? 5 : 3;
    ctx.beginPath();
    ctx.arc(pts[i*2], pts[i*2+1], r, 0, 6.2832);
    ctx.fill();
    ctx.stroke();
  }
}

/* ══════════════════════════════════════
   UI HELPERS
══════════════════════════════════════ */
function _showNoHands() {
  if (espejoModoActual === 'letras') {
    [0, 1].forEach(i => _resetHandPanel(i));
  } else {
    _updateInstantDisplay(null);
  }
}

function _resetHandPanel(hi) {
  if (_lastLetter[hi] === '') return;
  _lastLetter[hi] = '';
  const l = document.getElementById(`espejo-live-letter-${hi}`);
  const d = document.getElementById(`espejo-live-desc-${hi}`);
  if (l) { l.textContent = '—'; l.className = 'espejo-live-letter'; }
  if (d) d.textContent = 'Muestra tu mano';
}

function renderTextoAcumulado() {
  const box = document.getElementById('espejo-texto-acumulado');
  if (!box) return;
  box.innerHTML = textoAcumulado.length === 0
    ? '<span class="espejo-placeholder">La traducción aparecerá aquí…</span>'
    : textoAcumulado.map(p => `<span class="palabra">${p}</span>`).join(' ');
  box.scrollTop = box.scrollHeight;
}

function espejoBorrarUltima() {
  if (textoAcumulado.length > 0) { textoAcumulado.pop(); renderTextoAcumulado(); }
  lastCommitted = [null, null];
}
function espejoLimpiar() {
  textoAcumulado = []; lastCommitted = [null, null];
  wristHistory   = [[], []]; _lastGesture = '';
  renderTextoAcumulado(); _updateInstantDisplay(null);
}
function espejoHablar() {
  if (!textoAcumulado.length) return;
  const utt = new SpeechSynthesisUtterance(textoAcumulado.join(', '));
  utt.lang = 'es-ES';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utt);
}

/* ══════════════════════════════════════
   SUB-NAVEGACIÓN
══════════════════════════════════════ */
function showEspejoMode(mode) {
  espejoModoActual = mode;
  ['letras','palabras'].forEach(m => {
    const btn = document.getElementById(`espejo-btn-${m}`);
    const sec = document.getElementById(`espejo-${m}-section`);
    if (btn) btn.classList.toggle('active', m === mode);
    if (sec) sec.classList.toggle('hidden', m !== mode);
  });
  stabBuffers   = [[], []];
  wristHistory  = [[], []];
  lastCommitted = [null, null];
  inCooldown    = [false, false];
  _lastLetter   = ['', ''];
  _lastGesture  = '';
}
