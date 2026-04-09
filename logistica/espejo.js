/**
 * MANO APP — Espejo IA v3.0
 *
 * VIDEO  → elemento <video> a 60fps nativo
 * RENDER → RAF a 60fps con LERP entre frames de IA
 * AI     → MediaPipe a ~30fps (interval 33ms)
 *
 * Canvas siempre oculto → aspecto limpio y profesional
 * Clasificador de letras v4 → geometría mejorada, menos confusiones
 */

/* ══════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════ */
const CFG = {
  stabilityFrames:  3,       // 3 frames para confirmar (menos parpadeo)
  movHistoryLen:    15,
  commitCooldownMs: 800,
  minSwingX:        0.035,
  minSwingY:        0.025,
  minDirChanges:    1,
  aiIntervalMs:     33,      // máximo ~30 análisis/segundo (sin saturar hilo)
  lerpMs:           40,      // movimiento más fluido
  minHandSize:      0.045,   // más estricto: evita detectar cuerpo/ropa
  boneColor:        '#000000',
  jointColor:       '#FFFFFF',
};

/* ══════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════ */
let espejoHands      = null;
let espejoCamera     = null;
let espejoActivo     = false;
let espejoModoActual = 'letras';
let espejoFacingMode = 'environment';
let espejoMirrored   = false;

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
  'A':'Puño, pulgar al costado',      'B':'Cuatro dedos arriba',
  'C':'Mano en arco (C)',              'D':'Índice arriba, pulgar al medio',
  'E':'Dedos curvados a la palma',     'F':'Pulgar e índice se tocan',
  'G':'Índice y pulgar laterales',     'H':'Índice y medio horizontales',
  'I':'Solo meñique arriba',           'L':'Pulgar e índice en L',
  'M':'Pulgar bajo tres dedos',        'N':'Pulgar bajo dos dedos',
  'O':'Todos forman una O',            'R':'Índice y medio cruzados',
  'S':'Puño, pulgar encima',           'T':'Pulgar entre índice y medio',
  'U':'Índice y medio juntos',         'V':'Índice y medio en V',
  'W':'Tres dedos separados',          'Y':'Pulgar y meñique',
  'Ñ':'N con movimiento lateral',
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
  // Canvas siempre oculto — el análisis ocurre en segundo plano
  _canvas.style.display = 'none';

  espejoHands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });
  espejoHands.setOptions({
    maxNumHands:            2,    // Soporte para 2 manos en modo letras
    modelComplexity:        1,    // Mayor precisión
    minDetectionConfidence: 0.65, // Más estricto (evita falsos positivos con poca luz)
    minTrackingConfidence:  0.60,
  });
  espejoHands.onResults(onEspejoResults);

  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (!espejoActivo || !espejoHands) return;
      const now = performance.now();
      if (now - _lastAITime < CFG.aiIntervalMs) return;
      _lastAITime = now;
      
      // PRE-PROCESAMIENTO DE IMAGEN PARA POCA LUZ
      // Aumentamos brillo y contraste a través del canvas antes de enviar a MediaPipe
      if (_canvas && _ctx) {
        _ctx.filter = 'brightness(1.3) contrast(1.15)';
        _ctx.drawImage(video, 0, 0, _canvas.width, _canvas.height);
        _ctx.filter = 'none'; // reset
        await espejoHands.send({ image: _canvas });
      } else {
        await espejoHands.send({ image: video });
      }
    },
    width: 640, height: 480,   // Mayor resolución → mejor detección
    facingMode: espejoFacingMode,
  });

  // Ajustar canvas al tamaño del video
  video.addEventListener('loadedmetadata', () => {
    if (_canvas) {
      _canvas.width  = video.videoWidth  || 640;
      _canvas.height = video.videoHeight || 480;
    }
  }, { once: true });

  // CHECK DE PROTOCOLO: getUserMedia suele fallar en file:///
  if (window.location.protocol === 'file:') {
    _setStatus('⚠️ Error: La cámara no funciona en archivos locales. Abre con Live Server o sube a la web.');
  } else if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    _setStatus('⚠️ Tu navegador no permite acceso a la cámara o requiere HTTPS.');
  }

  espejoCamera.start().then(() => {
    espejoActivo = true;
    _startRenderLoop();
    _setStatus('Muestra tu mano');
  }).catch((err) => {
    console.error("Error iniciando cámara: ", err);
    _setStatus('⚠️ Error cámara: Da permisos, revisa la cámara o usa HTTPS/localhost.');
  });
}

/* ══════════════════════════════════════
   RENDER LOOP con LERP — 60fps
══════════════════════════════════════ */
function _startRenderLoop() {
  if (_rafId) cancelAnimationFrame(_rafId);
  _rafLastTime = performance.now();

  function loop(ts) {
    if (!espejoActivo) return;

    const dt = ts - _rafLastTime;
    _rafLastTime = ts;
    _lerpT = Math.min(_lerpT + dt, CFG.lerpMs);

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
  const video  = document.getElementById('espejo-video');
  const canvas = document.getElementById('espejo-canvas');
  const transform = espejoMirrored ? 'scaleX(-1)' : 'none';
  if (video)  video.style.transform  = transform;
  if (canvas) canvas.style.transform = transform;
  espejoCamera.stop();
  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (!espejoActivo || !espejoHands) return;
      const now = performance.now();
      if (now - _lastAITime < CFG.aiIntervalMs) return;
      _lastAITime = now;
      
      if (_canvas && _ctx) {
        _ctx.filter = 'brightness(1.3) contrast(1.15)';
        _ctx.drawImage(video, 0, 0, _canvas.width, _canvas.height);
        _ctx.filter = 'none';
        await espejoHands.send({ image: _canvas });
      } else {
        await espejoHands.send({ image: video });
      }
    },
    width: 640, height: 480,
    facingMode: espejoFacingMode,
  });
  espejoCamera.start().catch((err) => {
    console.error("Error al cambiar cámara: ", err);
    _setStatus('⚠️ No se pudo cambiar la cámara. Revisa permisos.');
  });
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
      _processLetraMode(lm, hi, mov);
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
function _processLetraMode(lm, hi, mov) {
  // FIX: usar letraBase (const) y letraFinal (let) para evitar error de reasignación
  const letraBase    = clasificarLetra(lm);
  const letterEl     = document.getElementById(`espejo-live-letter-${hi}`);
  const descEl       = document.getElementById(`espejo-live-desc-${hi}`);
  if (!letterEl || !descEl) return;

  if (letraBase) {
    stabBuffers[hi].push(letraBase);
    if (stabBuffers[hi].length > CFG.stabilityFrames) stabBuffers[hi].shift();
    const buf    = stabBuffers[hi];
    const stable = buf.length >= CFG.stabilityFrames && buf.every(l => l === letraBase);

    if (stable && _lastLetter[hi] !== letraBase) {
      // Detectar Ñ: N con movimiento lateral
      let letraFinal = letraBase;
      let desc       = LETRAS_INFO[letraBase] || '';

      if (letraBase === 'N' && mov && mov.isWaving) {
        letraFinal = 'Ñ';
        desc       = LETRAS_INFO['Ñ'];
      }

      _lastLetter[hi]      = letraFinal;
      letterEl.textContent = letraFinal;
      letterEl.className   = 'espejo-live-letter detected';
      descEl.textContent   = desc;
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
      _updateGuiaVisual(gesto);
    }
  } else {
    el.innerHTML = '<span class="instant-label">Muestra una seña…</span>';
    el.className = 'espejo-instant-detect';
    _updateGuiaVisual(null);
  }
}

function _updateGuiaVisual(gesto) {
  const guia  = document.getElementById('espejo-guia-visual');
  const icon  = document.getElementById('espejo-guia-icon');
  const label = document.getElementById('espejo-guia-label');
  if (!guia || !icon || !label) return;

  if (gesto) {
    const info = PALABRAS_INFO[gesto];
    if (info) {
      icon.textContent  = info.emoji;
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
  const hs  = hsize(lm);
  const tol = hs * 0.10;
  return {
    P:  dist(lm[4], lm[0]) > dist(lm[2], lm[0]) * 1.05,
    I:  lm[8].y  < lm[6].y  + tol,
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

/* C: dedos semi-curvados, brecha clara entre pulgar e índice */
function esFormaC(lm, hs) {
  hs = hs || hsize(lm);
  const hw   = dist(lm[5], lm[17]);
  const gap  = dist(lm[4], lm[8]) / hw;
  const palmY = (lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 4;
  const tipsUp = lm[8].y < palmY && lm[12].y < palmY;
  return gap > 0.40 && gap < 0.95 && tipsUp;
}

/* O: todas las yemas cerca del pulgar (círculo cerrado) */
function esFormaO(lm, hs) {
  hs = hs || hsize(lm);
  const t = hs * 0.35;
  return dist(lm[4],lm[8]) < t && dist(lm[4],lm[12]) < t*1.2 && dist(lm[4],lm[16]) < t*1.4;
}

/* ══════════════════════════════════════
   POSES DE PUÑO — Geometría mejorada
══════════════════════════════════════ */

/**
 * E: yemas de los 4 dedos muy cerca de la palma (dedos curvados hacia adentro)
 * Umbral más estricto que antes para diferenciarlo de S y A.
 */
function esPoseE(lm, hs) {
  hs = hs || hsize(lm);
  const p   = lm[9];
  const lim = hs * 0.65; // Reducido de 0.75 → más estricto
  // Además el pulgar debe estar relativamente cerca de los dedos
  const thumbClose = dist(lm[4], lm[8]) < hs * 0.55;
  return dist(lm[8],p) < lim && dist(lm[12],p) < lim &&
         dist(lm[16],p) < lim && dist(lm[20],p) < lim && thumbClose;
}

/**
 * S: pulgar claramente POR ENCIMA (encima = coordenada Y menor en imagen invertida)
 * El pulgar cruza el dorso del puño y queda visible encima de los demás dedos.
 * Usamos diferencia de Y con margen para evitar ambigüedad.
 */
function esPoseS(lm, hs) {
  hs = hs || hsize(lm);
  const margin = hs * 0.08;
  // El pulgar (tip=4) debe estar claramente por encima de las articulaciones PIP
  const overIdx = lm[4].y > lm[6].y  + margin;
  const overMid = lm[4].y > lm[10].y + margin;
  // Y debe estar en la zona central X de la mano (no al costado)
  const inCenter = lm[4].x > lm[5].x - hs * 0.5 && lm[4].x < lm[17].x + hs * 0.5;
  return overIdx && overMid && inCenter;
}

/**
 * A: puño con pulgar claramente al COSTADO de la palma.
 * El pulgar apunta hacia afuera/lateral, NO encima de los dedos.
 * Para diferenciarlo de S: el pulgar NO supera los PIP.
 */
function esPoseA(lm, hs) {
  hs = hs || hsize(lm);
  const margin = hs * 0.05;
  // El pulgar NO está encima de los PIP (eso sería S)
  const notOverIdx = lm[4].y <= lm[6].y  + margin;
  const notOverMid = lm[4].y <= lm[10].y + margin;
  // El pulgar está a un lado (X lejos del centro de la palma)
  const palmCenterX = (lm[5].x + lm[17].x) / 2;
  const thumbLateral = Math.abs(lm[4].x - palmCenterX) > hs * 0.15;
  return (notOverIdx || notOverMid) && thumbLateral;
}

/**
 * M: pulgar debajo de los 3 primeros dedos (índice, medio, anular) con buen margen
 * "Debajo" = coordenada Y mayor en la imagen (más abajo en pantalla)
 */
function esPoseM(lm, hs) {
  hs = hs || hsize(lm);
  const margin = hs * 0.06;
  return lm[4].y > lm[5].y + margin &&   // debajo de la base del índice
         lm[4].y > lm[9].y + margin &&   // debajo de la base del medio
         lm[4].y > lm[13].y + margin;    // debajo de la base del anular
}

/**
 * N: pulgar debajo de los 2 primeros dedos (índice y medio) con buen margen
 * pero NO debajo del anular (eso sería M)
 */
function esPoseN(lm, hs) {
  hs = hs || hsize(lm);
  const margin = hs * 0.06;
  return lm[4].y > lm[5].y + margin &&    // debajo de la base del índice
         lm[4].y > lm[9].y + margin &&    // debajo de la base del medio
         lm[4].y <= lm[13].y + margin;    // NO debajo del anular
}

function esPulgarArriba(lm) { return lm[4].y < lm[0].y - 0.07; }
function esPulgarAbajo(lm)  { return lm[4].y > lm[0].y + 0.08; }

/* Validación de aspect ratio de la mano (filtra detecciones falsas) */
function esAspectRatioValido(lm) {
  const ancho = Math.abs(lm[5].x - lm[17].x);
  const alto  = Math.abs(lm[0].y  - lm[12].y);
  if (!ancho || !alto) return false;
  const ratio = ancho / alto;
  // Una mano real tiene ratio entre 0.3 y 2.5
  return ratio > 0.3 && ratio < 2.5;
}

/* ══════════════════════════════════════
   CLASIFICADOR DE LETRAS v4 — geometría mejorada
══════════════════════════════════════ */
function clasificarLetra(lm) {
  const hs = hsize(lm);
  // Mano muy pequeña = detectada lejos → no confiable
  if (hs < CFG.minHandSize) return null;
  // Aspect ratio inválido → probable falso positivo
  if (!esAspectRatioValido(lm)) return null;

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
    if (sIM < 0.20) return 'R';
    if (sIM < 0.36) return 'U';
    return 'V';
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

  // ── C: antes de los puños (puede parecer puño si dedos semi-cerrados) ──
  if (esFormaC(lm, hs)) return 'C';

  // ── Puño cerrado (ext4 === 0) ──
  if (ext4 === 0) {
    // E primero: yemas muy cerca de la palma (umbral estricto)
    if (esPoseE(lm, hs)) return 'E';

    // M y N: pulgar debajo de dedos (orden importa: M antes de N)
    if (esPoseM(lm, hs)) return 'M';
    if (esPoseN(lm, hs)) return 'N';

    // S: pulgar claramente encima de todos los dedos con margen
    if (esPoseS(lm, hs)) return 'S';

    // T: pulgar asoma entre índice y medio
    if (lm[4].y < lm[8].y && lm[4].y > lm[5].y) return 'T';

    // A: puño con pulgar al costado (default de puño)
    if (esPoseA(lm, hs)) return 'A';

    // Si llegamos aquí sin clasificar, default A
    return 'A';
  }

  return null;
}

/* ══════════════════════════════════════
   CLASIFICADOR DE PALABRAS (mejorado)
══════════════════════════════════════ */
function clasificarPalabra(lm, mov) {
  const hs = hsize(lm);
  if (hs < CFG.minHandSize) return null;
  if (!esAspectRatioValido(lm)) return null;

  const { P, I, Me, A, Mi } = fingers(lm);
  const allOpen = I && Me && A && Mi;
  const fist    = !I && !Me && !A && !Mi;
  const idxOnly = !P && I && !Me && !A && !Mi;
  const yShape  = P && !I && !Me && !A && Mi;
  const lShape  = P && I && !Me && !A && !Mi;
  const tPI     = touchPI(lm, hs);

  if (mov) {
    if (allOpen && mov.isWaving)   return 'hola';
    if (fist    && mov.isNodding)  return 'si';
    if (idxOnly && mov.isShaking)  return 'no';
    if (yShape  && mov.isShaking)  return 'jugar';
    if (lShape  && mov.isWaving)   return 'nose';
    if (allOpen && mov.movingDown) return 'calma';
  }

  // ── Estáticos ──
  const othersClosed = !I && !Me && !A && !Mi;

  // bien vs ok — separación clara:
  // bien: pulgar SOLO arriba, todos los demás cerrados
  if (P && othersClosed && esPulgarArriba(lm)) return 'bien';
  if (P && othersClosed && esPulgarAbajo(lm))  return 'mal';

  // ok: círculo pulgar-índice (touchPI) + medio, anular y meñique EXTENDIDOS
  if (tPI && !I && Me && A && Mi)  return 'ok';

  if ( P && I  && !Me && !A && Mi)  return 'tequiero';
  if (!P && I  && Me  && !A && !Mi) return 'paz';
  if ( P && !I && !Me && !A && Mi)  return 'llamar';
  if (idxOnly)                       return 'usted';
  if (fist && esFormaC(lm, hs))     return 'comoestas';

  return null;
}

/* ══════════════════════════════════════
   DIBUJO — Canvas siempre oculto
   La IA procesa en segundo plano y muestra
   el resultado solo en los paneles de texto.
══════════════════════════════════════ */
function drawHand(ctx, canvas, lm) {
  // Función mantenida por compatibilidad pero nunca se llama
  // (el canvas está display:none)
}

/* ══════════════════════════════════════
   VOLTEAR ESPEJO (MIRROR)
══════════════════════════════════════ */
function espejoToggleMirror() {
  espejoMirrored = !espejoMirrored;

  const video  = document.getElementById('espejo-video');
  const canvas = document.getElementById('espejo-canvas');

  if (video && canvas) {
    const transform = espejoMirrored ? 'scaleX(-1)' : 'none';
    video.style.transform  = transform;
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
