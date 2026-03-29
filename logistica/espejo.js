/**
 * MANO APP — Espejo IA v2.1 (Optimizado)
 * ✅ 2 manos simultáneas
 * ✅ Gestos dinámicos con historial de movimiento
 * ✅ Reconocimiento instantáneo — sin barra de carga
 * ✅ Clasificador de letras corregido (bugs solucionados)
 * ✅ Canvas sin shadowBlur por elemento → sin lag
 * ✅ modelComplexity: 0 (modelo lite = 2x más velocidad)
 * ✅ Context 2D cacheado, frame throttle a ~33fps
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
  targetFPS:        33,       // Throttle: ~30fps es suficiente para IA
};

/* ══════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════ */
let espejoHands      = null;
let espejoCamera     = null;
let espejoActivo     = false;
let espejoModoActual = 'letras';
let espejoFacingMode = 'user';

// Cache del canvas context (evita getContext en cada frame)
let _ctx    = null;
let _canvas = null;

// Throttle de frames
let _lastFrameTime = 0;
const _frameInterval = 1000 / CFG.targetFPS;

// Buffers de estabilidad por mano [mano0, mano1]
let stabBuffers  = [[], []];

// Historial de muñeca por mano [{x,y}]
let wristHistory = [[], []];

// Cache del último estado mostrado (evita reescribir DOM sin cambios)
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
  'hola':      { texto:'Hola',           emoji:'👋', dinamico:true  },
  'adios':     { texto:'Adiós',          emoji:'🤚', dinamico:true  },
  'si':        { texto:'Sí',             emoji:'✅', dinamico:true  },
  'no':        { texto:'No',             emoji:'❌', dinamico:true  },
  'gracias':   { texto:'Gracias',        emoji:'🙏', dinamico:true  },
  'bien':      { texto:'Bien',           emoji:'👍', dinamico:false },
  'mal':       { texto:'Mal',            emoji:'👎', dinamico:false },
  'tequiero':  { texto:'Te quiero',      emoji:'🤟', dinamico:false },
  'paz':       { texto:'Paz',            emoji:'✌️', dinamico:false },
  'llamar':    { texto:'Llamar',         emoji:'🤙', dinamico:false },
  'ok':        { texto:'OK / Todo bien', emoji:'👌', dinamico:false },
  'usted':     { texto:'Usted / Tú',     emoji:'👉', dinamico:false },
  'comoestas': { texto:'¿Cómo estás?',   emoji:'🤔', dinamico:false },
};

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

  // Cachear canvas y context UNA SOLA VEZ
  _canvas = document.getElementById('espejo-canvas');
  _ctx    = _canvas ? _canvas.getContext('2d', { willReadFrequently: false }) : null;

  espejoHands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });

  espejoHands.setOptions({
    maxNumHands:            2,
    modelComplexity:        0,    // ← LITE model: 2x más rápido que complexity:1
    minDetectionConfidence: 0.7,
    minTrackingConfidence:  0.55,
  });

  espejoHands.onResults(onEspejoResults);

  const video = document.getElementById('espejo-video');
  if (!video) return;

  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (!espejoActivo || !espejoHands) return;
      // ── Throttle: saltar frames si el modelo aún no terminó ──
      const now = performance.now();
      if (now - _lastFrameTime < _frameInterval) return;
      _lastFrameTime = now;
      await espejoHands.send({ image: video });
    },
    width: 320, height: 240,       // ← Resolución optimizada (era 340×255)
    facingMode: espejoFacingMode,
  });

  espejoCamera.start();
  espejoActivo = true;
}

function espejoToggleCamara() {
  espejoFacingMode = espejoFacingMode === 'user' ? 'environment' : 'user';
  if (!espejoActivo || !espejoCamera) return;
  espejoCamera.stop();
  const video = document.getElementById('espejo-video');
  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (!espejoActivo || !espejoHands) return;
      const now = performance.now();
      if (now - _lastFrameTime < _frameInterval) return;
      _lastFrameTime = now;
      await espejoHands.send({ image: video });
    },
    width: 320, height: 240,
    facingMode: espejoFacingMode,
  });
  espejoCamera.start();
}

function stopEspejo() {
  espejoActivo = false;
  if (espejoCamera) { espejoCamera.stop(); espejoCamera = null; }
  if (espejoHands)  { espejoHands.close();  espejoHands  = null; }
  _ctx = null; _canvas = null;
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
   COLORES POR MANO
══════════════════════════════════════ */
const HAND_COLORS = ['#22d3ee', '#f472b6'];

/* ══════════════════════════════════════
   PROCESAMIENTO PRINCIPAL
══════════════════════════════════════ */
function onEspejoResults(results) {
  if (!_ctx || !_canvas) return;

  const W = _canvas.width;
  const H = _canvas.height;

  _ctx.clearRect(0, 0, W, H);

  // Dibujar video (espejado en cámara frontal)
  _ctx.save();
  if (espejoFacingMode === 'user') {
    _ctx.scale(-1, 1);
    _ctx.drawImage(results.image, -W, 0, W, H);
  } else {
    _ctx.drawImage(results.image, 0, 0, W, H);
  }
  _ctx.restore();

  const handsLM = results.multiHandLandmarks || [];

  if (handsLM.length === 0) {
    // Resetear buffers pero no limpiar historial de golpe
    stabBuffers = [[], []];
    // No empujar null en cada frame — solo limitar historial
    _trimHistory();
    _showNoHands();
    return;
  }

  // ── Recolectar gestos de todas las manos, actualizar display al final ──
  let bestGesto = null;

  handsLM.forEach((lm, hi) => {
    if (hi > 1) return;

    // Dibujar esqueleto
    drawHand(_ctx, _canvas, lm, HAND_COLORS[hi]);

    // Historial de muñeca (solo cuando hay mano real)
    wristHistory[hi].push({ x: lm[0].x, y: lm[0].y });

    // Analizar movimiento
    const mov = analyzeMovement(wristHistory[hi]);

    if (espejoModoActual === 'letras') {
      processLetraMode(lm, hi);
    } else {
      // Recolectar el gesto más relevante entre todas las manos
      const g = _detectGesto(lm, mov, hi);
      if (g) bestGesto = { gesto: g, hi };
    }
  });

  // Trim historial UNA sola vez por frame (no por mano)
  _trimHistory();

  // Actualizar display de palabras con el mejor gesto detectado
  if (espejoModoActual === 'palabras') {
    if (bestGesto) {
      _commitGesto(bestGesto.gesto, bestGesto.hi);
    } else {
      // No hay gesto: limpiar cooldowns de manos ausentes
      handsLM.forEach((_, hi) => {
        if (hi > 1) return;
        if (!inCooldown[hi]) lastCommitted[hi] = null;
      });
      _updateInstantDisplay(null);
    }
  }

  // Si solo hay 1 mano, resetear el panel de la 2ª
  if (handsLM.length < 2) {
    _resetHandPanel(1);
    stabBuffers[1] = [];
  }
}

/* ══════════════════════════════════════
   MODO LETRAS
══════════════════════════════════════ */
function processLetraMode(lm, hi) {
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
   MODO PALABRAS — detectar gesto
══════════════════════════════════════ */
function _detectGesto(lm, mov, hi) {
  return clasificarPalabra(lm, mov);
}

function _commitGesto(gesto, hi) {
  const info = PALABRAS_INFO[gesto];
  if (!info) return;

  // Actualizar display instantáneo
  _updateInstantDisplay(gesto);

  // Acumular con cooldown
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
  if (gesto === _lastGesture) return; // No reescribir DOM si no cambió
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
   ANÁLISIS DE MOVIMIENTO (sin array spread)
══════════════════════════════════════ */
function analyzeMovement(history) {
  const len = history.length;
  if (len < 10) return { isWaving:false, isNodding:false, isShaking:false, movingDown:false };

  // Trabajar sobre los últimos N puntos válidos directamente
  const start = Math.max(0, len - CFG.movHistoryLen);

  let xChanges = 0, lastXDir = 0;
  let yChanges = 0, lastYDir = 0;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (let i = start; i < len; i++) {
    const h = history[i];
    if (!h) continue;

    if (h.x < minX) minX = h.x;
    if (h.x > maxX) maxX = h.x;
    if (h.y < minY) minY = h.y;
    if (h.y > maxY) maxY = h.y;

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
  const netY   = history[len - 1] ? history[len - 1].y - (history[start] ? history[start].y : 0) : 0;

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
   HELPERS GEOMÉTRICOS
══════════════════════════════════════ */
function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
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
  const pv  = { x: lm[4].x - lm[2].x, y: lm[4].y - lm[2].y };
  const iv  = { x: lm[8].x - lm[5].x, y: lm[8].y - lm[5].y };
  const dot = pv.x * iv.x + pv.y * iv.y;
  const mag = Math.sqrt(pv.x*pv.x + pv.y*pv.y) * Math.sqrt(iv.x*iv.x + iv.y*iv.y);
  if (!mag) return false;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
  return angle > 55 && angle < 130;
}

function esFormaC(lm, hs) {
  hs = hs || hsize(lm);
  const r = dist(lm[4], lm[8]) / dist(lm[5], lm[17]);
  return r > 0.28 && r < 0.85;
}

function esFormaO(lm, hs) {
  hs = hs || hsize(lm);
  const t = hs * 0.38;
  return dist(lm[4], lm[8]) < t &&
         dist(lm[4], lm[12]) < t * 1.3 &&
         dist(lm[4], lm[16]) < t * 1.5;
}

function esPoseE(lm, hs) {
  hs = hs || hsize(lm);
  const p   = lm[9];
  const lim = hs * 0.82;
  return dist(lm[8], p)  < lim &&
         dist(lm[12], p) < lim &&
         dist(lm[16], p) < lim &&
         dist(lm[20], p) < lim;
}

function esPulgarArriba(lm) { return lm[4].y < lm[0].y - 0.05; }
function esPulgarAbajo(lm)  { return lm[4].y > lm[0].y + 0.08; }

/* ══════════════════════════════════════
   CLASIFICADOR DE LETRAS (bug-fixed)
══════════════════════════════════════ */
function clasificarLetra(lm) {
  const { P, I, Me, A, Mi, hs } = fingers(lm);
  const ext4 = (I ? 1:0) + (Me ? 1:0) + (A ? 1:0) + (Mi ? 1:0);

  const tPI  = touchPI(lm, hs);
  const tPMe = touchPMe(lm, hs);
  const sIM  = spreadIM(lm, hs);
  const thumbAbducted = dist(lm[4], lm[5]) > hs * 0.42;
  const thumbOverFing = lm[4].y > lm[6].y && lm[4].y > lm[10].y;

  // ── Contactos especiales (alta prioridad) ──
  if (tPI && Me && A && Mi && !I)    return 'F'; // F: círculo pulgar-índice + 3 arriba
  if (esFormaO(lm, hs))             return 'O'; // O: todos forman círculo
  if (I && !Me && !A && !Mi && tPMe) return 'D'; // D: índice + pulgar toca medio

  // ── 2 dedos: R / U / V (índice + medio) ──
  if (!P && I && Me && !A && !Mi) {
    if (sIM < 0.22) return 'R'; // R: muy juntos/cruzados
    if (sIM < 0.38) return 'U'; // U: juntos
    return 'V';                  // V: separados
  }

  // ── 4 dedos ──
  if (!P && I && Me && A && Mi)  return 'B';

  // ── 3 dedos ──
  if (!P && I && Me && A && !Mi) return 'W';

  // ── Pulgar + Índice ──
  if (P && I && !Me && !A && !Mi) return esFormaL(lm) ? 'L' : 'G';

  // ── Pulgar + Meñique ──
  if (P && !I && !Me && !A && Mi) return 'Y';

  // ── Solo índice (sin otros) ──
  if (!P && I && !Me && !A && !Mi) return 'D';

  // ── Solo meñique ── (BUG FIX: antes estaba dentro de !Mi, era inalcanzable)
  if (!P && !I && !Me && !A && Mi) return 'I';

  // ── Puño cerrado (0 dedos largos) ──
  if (ext4 === 0) {
    // BUG FIX: C se comprueba aquí dentro (antes estaba después del return 'A' → inalcanzable)
    if (esFormaC(lm, hs))    return 'C';
    if (esFormaO(lm, hs))    return 'O';
    // M: pulgar bajo 3 dedos
    if (lm[4].y > lm[6].y && lm[4].y > lm[10].y && lm[4].y > lm[14].y) return 'M';
    // N: pulgar bajo 2 dedos (pero no el anular)
    if (lm[4].y > lm[6].y && lm[4].y > lm[10].y && lm[4].y <= lm[14].y) return 'N';
    // E: yemas cerca de la palma
    if (esPoseE(lm, hs))     return 'E';
    // S: pulgar sobre los dedos
    if (thumbOverFing && P)   return 'S';
    // T: punta del pulgar asoma entre índice y medio
    if (lm[4].y < lm[8].y && lm[4].y > lm[5].y) return 'T';
    return 'A';
  }

  return null;
}

/* ══════════════════════════════════════
   CLASIFICADOR DE PALABRAS
══════════════════════════════════════ */
function clasificarPalabra(lm, mov) {
  const { P, I, Me, A, Mi, hs } = fingers(lm);
  const allOpen = I && Me && A && Mi;
  const fist    = !I && !Me && !A && !Mi;
  const idxOnly = !P && I && !Me && !A && !Mi;

  // ── Dinámicos primero ──
  if (mov) {
    if (allOpen && mov.isWaving)   return 'hola';
    if (fist    && mov.isNodding)  return 'si';
    if (idxOnly && mov.isShaking)  return 'no';
    if (allOpen && mov.movingDown) return 'gracias';
  }

  // ── Estáticos ──
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
   DIBUJO DE MANO (optimizado — sin shadowBlur por elemento)
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
  const W = canvas.width;
  const H = canvas.height;

  // Precomputar coordenadas de los 21 puntos (evita recalcular en cada conexión)
  const pts = new Float32Array(42); // [x0,y0, x1,y1, ..., x20,y20]
  for (let i = 0; i < 21; i++) {
    pts[i * 2]     = (flip ? 1 - lm[i].x : lm[i].x) * W;
    pts[i * 2 + 1] = lm[i].y * H;
  }

  // ── Dibujar TODAS las conexiones en un solo path (1 stroke total) ──
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5;
  ctx.globalAlpha = 0.85;
  HAND_CONNECTIONS.forEach(([a, b]) => {
    ctx.moveTo(pts[a * 2], pts[a * 2 + 1]);
    ctx.lineTo(pts[b * 2], pts[b * 2 + 1]);
  });
  ctx.stroke();

  // ── Dibujar TODOS los puntos (fill único por radio) ──
  ctx.globalAlpha = 1.0;
  ctx.fillStyle   = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = 1;

  for (let i = 0; i < 21; i++) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    const r = (i === 0 ? 6 : i % 4 === 0 ? 5 : 3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283185); // 2*PI constante
    ctx.fill();
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;
}

/* ══════════════════════════════════════
   UI — HELPERS
══════════════════════════════════════ */
function _showNoHands() {
  if (espejoModoActual === 'letras') {
    [0, 1].forEach(i => _resetHandPanel(i));
  } else {
    _updateInstantDisplay(null);
  }
}

function _resetHandPanel(hi) {
  if (_lastLetter[hi] === '') return; // Ya está reseteado
  _lastLetter[hi] = '';
  const l = document.getElementById(`espejo-live-letter-${hi}`);
  const d = document.getElementById(`espejo-live-desc-${hi}`);
  if (l) { l.textContent = '—'; l.className = 'espejo-live-letter'; }
  if (d) d.textContent = 'Muestra tu mano';
}

function renderTextoAcumulado() {
  const box = document.getElementById('espejo-texto-acumulado');
  if (!box) return;
  if (textoAcumulado.length === 0) {
    box.innerHTML = '<span class="espejo-placeholder">La traducción aparecerá aquí…</span>';
  } else {
    box.innerHTML = textoAcumulado
      .map(p => `<span class="palabra">${p}</span>`).join(' ');
  }
  box.scrollTop = box.scrollHeight;
}

function espejoBorrarUltima() {
  if (textoAcumulado.length > 0) { textoAcumulado.pop(); renderTextoAcumulado(); }
  lastCommitted = [null, null];
}

function espejoLimpiar() {
  textoAcumulado = [];
  lastCommitted  = [null, null];
  wristHistory   = [[], []];
  _lastGesture   = '';
  renderTextoAcumulado();
  _updateInstantDisplay(null);
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
  ['letras', 'palabras'].forEach(m => {
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
