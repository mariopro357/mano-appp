/**
 * MANO APP — Espejo IA v2.4
 *
 * VIDEO  → elemento <video> a 60fps nativo
 * RENDER → RAF a 60fps con LERP entre frames de IA
 * AI     → MediaPipe a ~30fps (interval 30ms)
 *
 * Sin puntos en el esqueleto → aspecto limpio y profesional
 * Clasificador de letras mejorado → menos confusiones
 */

/* ══════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════ */
const CFG = {
  stabilityFrames:  2,      
  movHistoryLen:    15,      
  commitCooldownMs: 800,     
  minSwingX:        0.035,  
  minSwingY:        0.025,
  minDirChanges:    1,      
  aiIntervalMs:     0,       
  lerpMs:           20,      
  minHandSize:      0.020,  
  boneColor:        '#000000', // Negro para las líneas
  jointColor:       '#FFFFFF', // Blanco para los puntos
};

/* ══════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════ */
let espejoHands      = null;
let espejoCamera     = null;
let espejoActivo     = false;
let espejoModoActual = 'letras';
let espejoFacingMode = 'environment'; 
let espejoMirrored   = false; // Estado manual del espejo

let _canvas = null;
let _ctx    = null;
let _rafId  = null;

// Lerp
let _prevLandmarks   = [];
let _targetLandmarks = [];
let _lerpT           = 0;
let _rafLastTime     = 0;

// Throttle IA
let _lastAITime = 0;

// Estabilidad y movimiento
let stabBuffers  = [[], []];
let wristHistory = [[], []];

// Cache DOM
let _lastLetter  = ['', ''];
let _lastGesture = '';

// Palabras
let textoAcumulado = [];
let lastCommitted  = [null, null];
let inCooldown     = [false, false];

/* ══════════════════════════════════════
   DATOS
══════════════════════════════════════ */
const LETRAS_INFO = {
  'A':'Puño, pulgar al lado',      'B':'Cuatro dedos arriba',
  'C':'Mano en arco (C)',          'D':'Índice arriba, pulgar al medio',
  'E':'Dedos curvados a la palma', 'F':'Pulgar e índice se tocan',
  'G':'Índice y pulgar laterales', 'H':'Índice y medio horizontales',
  'I':'Solo meñique arriba',       'L':'Pulgar e índice en L',
  'M':'Pulgar bajo tres dedos',    'N':'Pulgar bajo dos dedos',
  'O':'Todos forman una O',        'R':'Índice y medio cruzados',
  'S':'Puño, pulgar encima',       'T':'Pulgar entre dedos',
  'U':'Índice y medio juntos',     'V':'Índice y medio en V',
  'W':'Tres dedos separados',      'Y':'Pulgar y meñique',
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
  'comer':     { texto:'Comer',          emoji:'🍔' },
  'jugar':     { texto:'Jugar',          emoji:'🎮' },
  'calma':     { texto:'Calma / Espera', emoji:'🖐' },
  'nose':      { texto:'No sé',          emoji:'🤷‍♂️' },
};

// Eliminado HAND_COLORS ya que ahora se usa CFG.boneColor/jointColor

/* ══════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════ */
function initEspejo() {
  if (espejoActivo) return;
  showEspejoMode('letras');

  if (typeof Hands === 'undefined') {
    _setStatus('⚠️ Abre la app desde un servidor HTTP (Live Server)');
    return;
  }

  _canvas = document.getElementById('espejo-canvas');
  _ctx    = _canvas ? _canvas.getContext('2d', { willReadFrequently: false }) : null;

  const video = document.getElementById('espejo-video');
  if (!video || !_ctx) return;

  video.style.opacity   = '1';
  // El transform ahora se gestiona manualmente con espejoToggleMirror
  _canvas.style.display = 'block';
  if (_canvas) {
    _canvas.width = video.videoWidth || 320;
    _canvas.height = video.videoHeight || 240;
  }

  espejoHands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  espejoHands.setOptions({
    maxNumHands:            1, // Solo una mano para evitar ruidos
    modelComplexity:        0,
    minDetectionConfidence: 0.5, 
    minTrackingConfidence:  0.5, 
  });
  espejoHands.onResults(onEspejoResults);

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
  espejoActivo = true;
  _startRenderLoop();
}

/* ══════════════════════════════════════
   RENDER LOOP con LERP — 60fps
══════════════════════════════════════ */
function _startRenderLoop() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafLastTime = performance.now();

  function loop(ts) {
    if (!espejoActivo || !_ctx || !_canvas) return;

    const dt = ts - _rafLastTime;
    _rafLastTime = ts;
    _lerpT = Math.min(_lerpT + dt, CFG.lerpMs);
    const t = _lerpT / CFG.lerpMs;

    _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

    const display = _lerpLandmarks(_prevLandmarks, _targetLandmarks, t);
    display.forEach((lm, hi) => {
      if (hi < 2) drawHand(_ctx, _canvas, lm);
    });

    _rafId = requestAnimationFrame(loop);
  }

  _rafId = requestAnimationFrame(loop);
}

/* ── Interpolación lineal de landmarks ── */
function _lerpLandmarks(prev, target, t) {
  if (!target || target.length === 0) return [];
  if (!prev || prev.length === 0 || prev.length !== target.length) return target;
  if (t >= 1) return target;

  return target.map((tHand, hi) => {
    const pHand = prev[hi];
    if (!pHand || pHand.length !== tHand.length) return tHand;
    return tHand.map((tp, j) => {
      const pp = pHand[j];
      if (!pp) return tp;
      return {
        x: pp.x + (tp.x - pp.x) * t,
        y: pp.y + (tp.y - pp.y) * t,
        z: (pp.z||0) + ((tp.z||0) - (pp.z||0)) * t,
      };
    });
  });
}

/* ══════════════════════════════════════
   TOGGLE CÁMARA
══════════════════════════════════════ */
function espejoToggleCamara() {
  espejoFacingMode = espejoFacingMode === 'user' ? 'environment' : 'user';
  if (!espejoActivo || !espejoCamera) return;
  const video = document.getElementById('espejo-video');
  const canvas = document.getElementById('espejo-canvas');
  // Mantener el mirror actual al cambiar de cámara
  const transform = espejoMirrored ? 'scaleX(-1)' : 'none';
  if (video) video.style.transform = transform;
  if (canvas) canvas.style.transform = transform;
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
   STOP
══════════════════════════════════════ */
function stopEspejo() {
  espejoActivo = false;
  if (_rafId)       { cancelAnimationFrame(_rafId); _rafId = null; }
  if (espejoCamera) { espejoCamera.stop(); espejoCamera = null; }
  if (espejoHands)  { espejoHands.close(); espejoHands  = null; }
  const video = document.getElementById('espejo-video');
  if (video) { video.style.opacity = '0'; video.style.transform = 'none'; }
  _prevLandmarks = []; _targetLandmarks = []; _lerpT = 0;
  _canvas = null; _ctx = null;
  stabBuffers = [[], []]; wristHistory = [[], []];
  lastCommitted = [null, null]; inCooldown = [false, false];
  _lastLetter = ['', '']; _lastGesture = '';
}

function _setStatus(msg) {
  ['espejo-live-desc-0','espejo-live-desc-1'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  });
}

/* ══════════════════════════════════════
   CALLBACK IA — actualiza datos, NO dibuja
══════════════════════════════════════ */
function onEspejoResults(results) {
  const newLMs = results.multiHandLandmarks || [];

  // Capturar posición visual actual como origen del nuevo lerp
  const curT = Math.min(_lerpT / CFG.lerpMs, 1);
  _prevLandmarks   = _lerpLandmarks(_prevLandmarks, _targetLandmarks, curT);
  _targetLandmarks = newLMs;
  _lerpT           = 0;

  if (newLMs.length === 0) {
    stabBuffers = [[], []];
    _trimHistory();
    _showNoHands();
    return;
  }

  let bestGesto = null;

  newLMs.forEach((lm, hi) => {
    if (hi > 1) return;
    wristHistory[hi].push({ x: lm[0].x, y: lm[0].y });
    const mov = _analyzeMovement(wristHistory[hi]);

    if (espejoModoActual === 'letras') {
      _processLetraMode(lm, hi);
    } else {
      const g = clasificarPalabra(lm, mov);
      if (g) bestGesto = { gesto: g, hi };
    }
  });

  _trimHistory();

  if (espejoModoActual === 'palabras') {
    if (bestGesto) {
      _commitGesto(bestGesto.gesto, bestGesto.hi);
    } else {
      newLMs.forEach((_, hi) => {
        if (hi > 1) return;
        if (!inCooldown[hi]) lastCommitted[hi] = null;
      });
      _updateInstantDisplay(null);
    }
  }

  if (newLMs.length < 2) {
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
    // Respuesta inmediata: basta con 2 frames iguales
    const stable = buf.length >= CFG.stabilityFrames && buf.every(l => l === letra);
    if (stable && _lastLetter[hi] !== letra) {
      _lastLetter[hi]      = letra;
      letterEl.textContent = letra;
      letterEl.className   = 'espejo-live-letter detected';
      
      // Lógica específica por lenguaje
      let desc = LETRAS_INFO[letra] || '';
      
      // Mejora: Detectar Ñ en LSV si hay movimiento sobre la N
      const mov = _analyzeMovement(wristHistory[hi]);
      if (letra === 'N' && mov.isWaving) {
          letra = 'Ñ';
          desc = 'Letra Ñ (N con movimiento)';
          letterEl.textContent = 'Ñ';
      }

      descEl.textContent = desc;
      
      // Consultar a Boni si hay confusión o para más info
      if (Math.random() > 0.8) {
        Boni.analizarGesto('lsv', letra).then(res => {
          if (res && res !== letra) {
            console.log("Boni sugiere corrección:", res);
          }
        });
      }
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
      _updateGuiaVisual(gesto); // Sincronizar guía visual
    }
  } else {
    el.innerHTML = '<span class="instant-label">Muestra una seña…</span>';
    el.className = 'espejo-instant-detect';
    _updateGuiaVisual(null); // Ocultar guía visual
  }
}

/**
 * Muestra la guía visual de Boni en la izquierda
 */
function _updateGuiaVisual(gesto) {
  const guia = document.getElementById('espejo-guia-visual');
  const icon = document.getElementById('espejo-guia-icon');
  const label = document.getElementById('espejo-guia-label');
  if (!guia || !icon || !label) return;

  if (gesto) {
    const info = PALABRAS_INFO[gesto];
    if (info) {
        icon.textContent = info.emoji;
        label.textContent = info.texto;
        guia.classList.add('active');
    }
  } else {
    guia.classList.remove('active');
  }
}

/* ══════════════════════════════════════
   ANÁLISIS DE MOVIMIENTO
══════════════════════════════════════ */
function _analyzeMovement(history) {
  const len = history.length;
  if (len < 8) return { isWaving:false, isNodding:false, isShaking:false, movingDown:false };

  const start = Math.max(0, len - CFG.movHistoryLen);
  let xCh = 0, lxd = 0, yCh = 0, lyd = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let firstY = null, lastY = null;

  for (let i = start; i < len; i++) {
    const h = history[i]; if (!h) continue;
    if (h.x < minX) minX = h.x; if (h.x > maxX) maxX = h.x;
    if (h.y < minY) minY = h.y; if (h.y > maxY) maxY = h.y;
    if (firstY === null) firstY = h.y; lastY = h.y;
    if (i > start) {
      const p = history[i-1]; if (!p) continue;
      const dx = h.x - p.x, dy = h.y - p.y;
      if (Math.abs(dx) > 0.007) { const d=dx>0?1:-1; if(lxd&&d!==lxd)xCh++; lxd=d; }
      if (Math.abs(dy) > 0.007) { const d=dy>0?1:-1; if(lyd&&d!==lyd)yCh++; lyd=d; }
    }
  }

  const rx = maxX-minX, ry = maxY-minY;
  const netY = (lastY !== null && firstY !== null) ? lastY - firstY : 0;
  
  // Refinamiento: Eje X debe ser mucho mayor que Y para Waving, y viceversa para Calma
  const dominantX = rx > ry * 1.5;
  const dominantY = ry > rx * 1.2;

  return {
    isWaving:   xCh >= CFG.minDirChanges && rx > CFG.minSwingX && dominantX,
    isNodding:  yCh >= CFG.minDirChanges && ry > CFG.minSwingY && dominantY,
    isShaking:  xCh >= CFG.minDirChanges && rx > CFG.minSwingX && dominantX,
    movingDown: netY > 0.07 && yCh <= 2 && dominantY,
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
  const dx=a.x-b.x, dy=a.y-b.y, dz=(a.z||0)-(b.z||0);
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}
function hsize(lm) { return dist(lm[0], lm[9]); }

function fingers(lm) {
  const hs = hsize(lm);
  const tol = hs * 0.12; // Tolerancia dinámica para lenguaje de señas rápido (TV)
  return {
    P:  dist(lm[4], lm[0]) > dist(lm[2], lm[0]) * 1.05, // Pulgar más indulgente
    I:  lm[8].y  < lm[6].y + tol,
    Me: lm[12].y < lm[10].y + tol,
    A:  lm[16].y < lm[14].y + tol,
    Mi: lm[20].y < lm[18].y + tol,
    hs,
  };
}

function touchPI(lm, hs)  { return dist(lm[4], lm[8])  < hs * 0.28; }
function touchPMe(lm, hs) { return dist(lm[4], lm[12]) < hs * 0.28; }
function spreadIM(lm, hs) { return dist(lm[8], lm[12]) / hs; }

function esFormaL(lm) {
  const pv = { x:lm[4].x-lm[2].x, y:lm[4].y-lm[2].y };
  const iv = { x:lm[8].x-lm[5].x, y:lm[8].y-lm[5].y };
  const dot = pv.x*iv.x + pv.y*iv.y;
  const mag = Math.sqrt(pv.x*pv.x+pv.y*pv.y) * Math.sqrt(iv.x*iv.x+iv.y*iv.y);
  if (!mag) return false;
  const a = Math.acos(Math.max(-1,Math.min(1,dot/mag))) * 180/Math.PI;
  return a > 60 && a < 120;
}

/* C mejorada: dedos semi-curvados, brecha clara entre pulgar e índice,
   puntas de dedos POR ENCIMA de la palma (no es un puño) */
function esFormaC(lm, hs) {
  hs = hs || hsize(lm);
  const hw   = dist(lm[5], lm[17]);          // Ancho de la mano
  const gap  = dist(lm[4], lm[8]) / hw;      // Brecha pulgar-índice relativa
  const palmY = (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4;
  // Puntas de dedos deben estar por encima del ecuador de la palma
  const tipsUp = lm[8].y < palmY && lm[12].y < palmY;
  return gap > 0.40 && gap < 0.95 && tipsUp;
}

/* O: todas las yemas cerca del pulgar (círculo cerrado) */
function esFormaO(lm, hs) {
  hs = hs || hsize(lm);
  const t = hs * 0.35;
  return dist(lm[4],lm[8]) < t && dist(lm[4],lm[12]) < t*1.2 && dist(lm[4],lm[16]) < t*1.4;
}

/* E: yemas dobladas, muy cerca del centro de la palma */
function esPoseE(lm, hs) {
  hs = hs || hsize(lm);
  const p = lm[9], lim = hs * 0.75;  // Más estricto que antes
  return dist(lm[8],p)<lim && dist(lm[12],p)<lim && dist(lm[16],p)<lim && dist(lm[20],p)<lim;
}

/* S: pulgar cruza POR ENCIMA de todos los dedos (pulgar está entre yemas y palma) */
function esPoseS(lm, hs) {
  hs = hs || hsize(lm);
  // El pulgar está por encima de los PIP (articulación media)
  return lm[4].y > lm[6].y  &&   // sobre PIP del índice
         lm[4].y > lm[10].y &&   // sobre PIP del medio
         lm[4].x > lm[5].x - hs; // y está en la zona central
}

/* A: puño básico, pulgar al costado (NO sobre los dedos) */
function esPoseA(lm, hs) {
  hs = hs || hsize(lm);
  // El pulgar NO cruza sobre los dedos
  const thumbOverFist = lm[4].y > lm[6].y && lm[4].y > lm[10].y;
  return !thumbOverFist;
}

function esPulgarArriba(lm) { return lm[4].y < lm[0].y - 0.07; }
function esPulgarAbajo(lm)  { return lm[4].y > lm[0].y + 0.08; }

/* ══════════════════════════════════════
   CLASIFICADOR DE LETRAS (v3 — menos confusiones)
══════════════════════════════════════ */
function clasificarLetra(lm) {
  const hs = hsize(lm);
  // Mano muy pequeña = detectada lejos → no confiable
  if (hs < CFG.minHandSize) return null;

  const { P, I, Me, A, Mi } = fingers(lm);
  const ext4 = (I?1:0)+(Me?1:0)+(A?1:0)+(Mi?1:0);
  const tPI  = touchPI(lm, hs);
  const tPMe = touchPMe(lm, hs);
  const sIM  = spreadIM(lm, hs);

  // ── Contactos especiales (alta prioridad) ──
  if (tPI && Me && A && Mi && !I)     return 'F'; // F: círculo arriba
  if (esFormaO(lm, hs))              return 'O'; // O: dedos forman círculo

  // D: índice arriba + pulgar toca el medio
  if (I && !Me && !A && !Mi && tPMe)  return 'D';

  // ── 2 dedos: R / U / V ──
  if (!P && I && Me && !A && !Mi) {
    if (sIM < 0.20) return 'R'; // muy juntos/cruzados
    if (sIM < 0.36) return 'U'; // juntos
    return 'V';                  // separados
  }

  // ── 4 dedos ──
  if (!P && I && Me && A && Mi)   return 'B';

  // ── 3 dedos ──
  if (!P && I && Me && A && !Mi)  return 'W';

  // ── Pulgar + Índice ──
  if (P && I && !Me && !A && !Mi) return esFormaL(lm) ? 'L' : 'G';

  // ── Pulgar + Meñique ──
  if (P && !I && !Me && !A && Mi) return 'Y';

  // ── Solo índice ──
  if (!P && I && !Me && !A && !Mi) return 'D';

  // ── Solo meñique ──
  if (!P && !I && !Me && !A && Mi) return 'I';

  // ── Puño cerrado (ext4 === 0) ──
  if (ext4 === 0) {
    // C debe ir ANTES de los puños cerrados porque sus dedos no están del todo arriba
    if (esFormaC(lm, hs))   return 'C'; // C: arco con dedos semi-curvados
    if (esFormaO(lm, hs))   return 'O'; // doble check

    // M / N: pulgar debajo de dedos
    const thumbBelowIdx = lm[4].y > lm[6].y;
    const thumbBelowMid = lm[4].y > lm[10].y;
    const thumbBelowRng = lm[4].y > lm[14].y;
    if (thumbBelowIdx && thumbBelowMid && thumbBelowRng) return 'M';
    if (thumbBelowIdx && thumbBelowMid && !thumbBelowRng) return 'N';

    // E / S / A — orden importante
    if (esPoseE(lm, hs))    return 'E'; // E: yemas cerca de la palma
    if (esPoseS(lm, hs))    return 'S'; // S: pulgar sobre todos los dedos
    if (lm[4].y < lm[8].y && lm[4].y > lm[5].y) return 'T'; // T: pulgar asoma

    // A: puño con pulgar lateral (default de puño)
    return 'A';
  }

  return null;
}

/* ══════════════════════════════════════
   CLASIFICADOR DE PALABRAS
══════════════════════════════════════ */
function clasificarPalabra(lm, mov) {
  const hs = hsize(lm);
  if (hs < CFG.minHandSize) return null;

  const { P, I, Me, A, Mi } = fingers(lm);
  const allOpen = I && Me && A && Mi;
  const fist    = !I && !Me && !A && !Mi;
  const idxOnly = !P && I && !Me && !A && !Mi;
  const yShape  = P && !I && !Me && !A && Mi;
  const lShape  = P && I && !Me && !A && !Mi;

  if (mov) {
    // Hola: Mano abierta + Movimiento dominante X (Waving)
    if (allOpen && mov.isWaving)   return 'hola';
    // Si: Puño + Movimiento dominante Y (Nodding)
    if (fist    && mov.isNodding)  return 'si';
    // No: Índice solo + Movimiento lateral (Shaking)
    if (idxOnly && mov.isShaking)  return 'no';
    
    if (yShape  && mov.isShaking)  return 'jugar'; 
    if (lShape  && mov.isWaving)   return 'nose';  

    // Calma/Espera: Mano abierta + Movimiento hacia abajo dominante
    if (allOpen && mov.movingDown) return 'calma'; 
  }
  
  // ── Estáticos ──
  // Bien: Pulgar arriba (exige que los otros 4 dedos estén cerrados)
  const otherFingersClosed = !I && !Me && !A && !Mi;
  if (P && otherFingersClosed && esPulgarArriba(lm)) return 'bien';
  if (P && otherFingersClosed && esPulgarAbajo(lm))  return 'mal';
  if ( P && I  && !Me && !A && Mi)                           return 'tequiero';
  if (!P && I  && Me  && !A && !Mi)                          return 'paz';
  if ( P && !I && !Me && !A && Mi)                           return 'llamar';
  if (!I && Me && A   && Mi && touchPI(lm,hs))               return 'ok';
  if (idxOnly)                                               return 'usted';
  if (!I && !Me && !A && !Mi && esFormaC(lm, hs))            return 'comoestas';
  return null;
}

/* ══════════════════════════════════════
   DIBUJO — Desactivado
   El canvas está oculto. La IA procesa en segundo plano
   y muestra el resultado solo en los paneles de texto.
══════════════════════════════════════ */
function drawHand(ctx, canvas, lm) {
  if (!ctx || !lm) return;
  
  const connections = [
    [0, 1, 2, 3, 4],       // Pulgar
    [0, 5, 6, 7, 8],       // Índice
    [0, 9, 10, 11, 12],    // Medio
    [0, 13, 14, 15, 16],   // Anular
    [0, 17, 18, 19, 20],   // Meñique
    [5, 9, 13, 17]         // Palma
  ];

  ctx.lineWidth = 1.5; // MUCHO MÁS FINO
  ctx.lineCap = 'round';
  ctx.strokeStyle = CFG.boneColor;
  ctx.shadowBlur = 0; // SIN NEÓN

  connections.forEach(conn => {
    ctx.beginPath();
    for (let i = 0; i < conn.length; i++) {
      const pt = lm[conn[i]];
      if (i === 0) ctx.moveTo(pt.x * canvas.width, pt.y * canvas.height);
      else ctx.lineTo(pt.x * canvas.width, pt.y * canvas.height);
    }
    ctx.stroke();
  });

  // Dibujar puntos
  lm.forEach(pt => {
    ctx.fillStyle = CFG.jointColor;
    ctx.beginPath();
    ctx.arc(pt.x * canvas.width, pt.y * canvas.height, 2.5, 0, 2 * Math.PI); // PUNTOS MÁS PEQUEÑOS
    ctx.fill();
    // Borde negro para que resalten
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  });
}

/* ══════════════════════════════════════
   VOLTEAR ESPEJO (MIRROR)
══════════════════════════════════════ */
function espejoToggleMirror() {
  espejoMirrored = !espejoMirrored;
  
  const video = document.getElementById('espejo-video');
  const canvas = document.getElementById('espejo-canvas');
  
  if (video && canvas) {
    const transform = espejoMirrored ? 'scaleX(-1)' : 'none';
    video.style.transform = transform;
    canvas.style.transform = transform;
    _setStatus(espejoMirrored ? 'Modo Espejo: ACTIVADO' : 'Modo Espejo: DESACTIVADO');
  }
}

/* ══════════════════════════════════════
   UI
══════════════════════════════════════ */
function _showNoHands() {
  if (espejoModoActual === 'letras') {
    [0,1].forEach(i => _resetHandPanel(i));
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
  wristHistory = [[], []]; _lastGesture = '';
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
  stabBuffers = [[], []]; wristHistory = [[], []];
  lastCommitted = [null, null]; inCooldown = [false, false];
  _lastLetter = ['', '']; _lastGesture = '';
  _prevLandmarks = []; _targetLandmarks = []; _lerpT = 0;
}
