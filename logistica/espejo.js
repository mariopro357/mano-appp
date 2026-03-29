/**
 * MANO APP — Espejo IA v2.0
 * ✅ 2 manos simultáneas
 * ✅ Gestos dinámicos (agitar, asentir, negar, bajar mano)
 * ✅ Reconocimiento instantáneo — sin barra de carga
 * ✅ Clasificador de letras mejorado (menos confusión)
 */

/* ══════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════ */
const CFG = {
  stabilityFrames:  6,      // Frames para confirmar seña estática (rápido)
  movHistoryLen:    28,     // Frames de historial para movimiento
  commitCooldownMs: 1400,   // ms antes de volver a confirmar la misma seña
  minSwingX:        0.055,  // Desplazamiento X mínimo para "agitar"
  minSwingY:        0.04,   // Desplazamiento Y mínimo para "asentir"
  minDirChanges:    3,      // Cambios de dirección mínimos para movimiento
};

/* ══════════════════════════════════════
   ESTADO GLOBAL
══════════════════════════════════════ */
let espejoHands      = null;
let espejoCamera     = null;
let espejoActivo     = false;
let espejoModoActual = 'letras';
let espejoFacingMode = 'user';

// Buffers de estabilidad por mano
let stabBuffers  = [[], []];

// Historial de muñeca por mano  [{x,y}]
let wristHistory = [[], []];

// Modo palabras
let textoAcumulado = [];
let lastCommitted  = [null, null];
let inCooldown     = [false, false];

/* ══════════════════════════════════════
   INFORMACIÓN DE LETRAS Y PALABRAS
══════════════════════════════════════ */
const LETRAS_INFO = {
  'A':'Puño, pulgar al lado',     'B':'Cuatro dedos arriba',
  'C':'Forma de C',               'D':'Índice arriba, pulgar al medio',
  'E':'Dedos curvados a la palma','F':'Pulgar e índice se tocan',
  'G':'Índice y pulgar laterales','H':'Índice y medio horizontales',
  'I':'Solo meñique arriba',      'K':'Índice, medio y pulgar',
  'L':'Pulgar e índice en L',     'M':'Pulgar bajo tres dedos',
  'N':'Pulgar bajo dos dedos',    'O':'Todos forman una O',
  'R':'Índice y medio cruzados',  'S':'Puño, pulgar encima',
  'T':'Pulgar entre dedos',       'U':'Índice y medio juntos',
  'V':'Índice y medio en V',      'W':'Tres dedos separados',
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

  espejoHands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });

  espejoHands.setOptions({
    maxNumHands:             2,
    modelComplexity:         1,
    minDetectionConfidence:  0.75,
    minTrackingConfidence:   0.6,
  });

  espejoHands.onResults(onEspejoResults);

  const video = document.getElementById('espejo-video');
  if (!video) return;

  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (espejoActivo && espejoHands)
        await espejoHands.send({ image: video });
    },
    width: 340, height: 255,
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
      if (espejoActivo && espejoHands)
        await espejoHands.send({ image: video });
    },
    width: 340, height: 255,
    facingMode: espejoFacingMode,
  });
  espejoCamera.start();
}

function stopEspejo() {
  espejoActivo = false;
  if (espejoCamera) { espejoCamera.stop(); espejoCamera = null; }
  if (espejoHands)  { espejoHands.close(); espejoHands  = null; }
  stabBuffers  = [[], []];
  wristHistory = [[], []];
  lastCommitted = [null, null];
  inCooldown    = [false, false];
}

function setEspejoStatus(msg) {
  ['espejo-live-desc-0','espejo-live-desc-1'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  });
}

/* ══════════════════════════════════════
   PROCESAMIENTO PRINCIPAL
══════════════════════════════════════ */
const HAND_COLORS = ['#22d3ee', '#f472b6']; // Cian / Rosa

function onEspejoResults(results) {
  const canvas = document.getElementById('espejo-canvas');
  const ctx    = canvas?.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Dibujar video (espejado en cámara frontal)
  ctx.save();
  if (espejoFacingMode === 'user') {
    ctx.scale(-1, 1);
    ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
  } else {
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  }
  ctx.restore();

  const handsLM = results.multiHandLandmarks || [];

  if (handsLM.length === 0) {
    stabBuffers  = [[], []];
    wristHistory[0].push(null);
    wristHistory[1].push(null);
    trimHistory();
    showNoHands();
    return;
  }

  handsLM.forEach((lm, hi) => {
    if (hi > 1) return;
    drawHand(ctx, canvas, lm, HAND_COLORS[hi]);

    // Historial de muñeca
    wristHistory[hi].push({ x: lm[0].x, y: lm[0].y });
    trimHistory();

    const mov = analyzeMovement(wristHistory[hi]);

    if (espejoModoActual === 'letras') {
      processLetraMode(lm, hi);
    } else {
      processPalabraMode(lm, mov, hi);
    }
  });

  // Si solo hay 1 mano, resetear el panel de la otra
  if (handsLM.length === 1) {
    resetHandPanel(1);
    stabBuffers[1] = [];
  }
}

/* ══════════════════════════════════════
   MODO LETRAS
══════════════════════════════════════ */
function processLetraMode(lm, hi) {
  const letra  = clasificarLetra(lm);
  const letterEl = document.getElementById(`espejo-live-letter-${hi}`);
  const descEl   = document.getElementById(`espejo-live-desc-${hi}`);
  if (!letterEl || !descEl) return;

  if (letra) {
    stabBuffers[hi].push(letra);
    if (stabBuffers[hi].length > CFG.stabilityFrames)
      stabBuffers[hi].shift();

    const buf     = stabBuffers[hi];
    const stable  = buf.length >= 4 && buf.every(l => l === letra);

    if (stable) {
      letterEl.textContent = letra;
      letterEl.className   = 'espejo-live-letter detected';
      descEl.textContent   = LETRAS_INFO[letra] || '';
    }
  } else {
    stabBuffers[hi] = [];
    letterEl.textContent = '—';
    letterEl.className   = 'espejo-live-letter';
    descEl.textContent   = 'Muestra tu mano';
  }
}

/* ══════════════════════════════════════
   MODO PALABRAS
══════════════════════════════════════ */
function processPalabraMode(lm, mov, hi) {
  const gesto   = clasificarPalabra(lm, mov);
  const instantEl = document.getElementById('espejo-instant-detect');

  if (gesto) {
    const info = PALABRAS_INFO[gesto];
    if (info && instantEl) {
      instantEl.innerHTML  = `<span class="instant-emoji">${info.emoji}</span><span class="instant-label">${info.texto}</span>`;
      instantEl.className  = 'espejo-instant-detect active';
    }

    // Confirmar y acumular con cooldown
    if (!inCooldown[hi] && gesto !== lastCommitted[hi]) {
      if (info) {
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
  } else {
    if (!inCooldown[hi]) lastCommitted[hi] = null;
    if (instantEl) {
      instantEl.innerHTML = '<span class="instant-label">Muestra una seña…</span>';
      instantEl.className = 'espejo-instant-detect';
    }
  }
}

/* ══════════════════════════════════════
   ANÁLISIS DE MOVIMIENTO
══════════════════════════════════════ */
function analyzeMovement(history) {
  const valid = history.filter(Boolean).slice(-CFG.movHistoryLen);
  if (valid.length < 10) return { isWaving:false, isNodding:false, movingDown:false };

  let xChanges = 0, lastXDir = 0;
  let yChanges = 0, lastYDir = 0;

  for (let i = 1; i < valid.length; i++) {
    const dx = valid[i].x - valid[i-1].x;
    const dy = valid[i].y - valid[i-1].y;

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

  const xs = valid.map(h => h.x);
  const ys = valid.map(h => h.y);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeY = Math.max(...ys) - Math.min(...ys);
  const netY   = valid[valid.length-1].y - valid[0].y;

  return {
    isWaving:   xChanges >= CFG.minDirChanges && rangeX > CFG.minSwingX,
    isNodding:  yChanges >= CFG.minDirChanges && rangeY > CFG.minSwingY,
    isShaking:  xChanges >= CFG.minDirChanges && rangeX > CFG.minSwingX,
    movingDown: netY > 0.07 && yChanges <= 2,
  };
}

function trimHistory() {
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
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z||0) - (b.z||0));
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
  const mag = Math.hypot(pv.x,pv.y) * Math.hypot(iv.x,iv.y);
  if (!mag) return false;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot/mag))) * 180/Math.PI;
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
  return dist(lm[4],lm[8]) < t && dist(lm[4],lm[12]) < t*1.3 && dist(lm[4],lm[16]) < t*1.5;
}

function esPoseE(lm, hs) {
  hs = hs || hsize(lm);
  const p = lm[9];
  const lim = hs * 0.82;
  return dist(lm[8],p)<lim && dist(lm[12],p)<lim && dist(lm[16],p)<lim && dist(lm[20],p)<lim;
}

function esPulgarArriba(lm) { return lm[4].y < lm[0].y - 0.05; }
function esPulgarAbajo(lm)  { return lm[4].y > lm[0].y + 0.08; }

/* ══════════════════════════════════════
   CLASIFICADOR DE LETRAS (mejorado)
══════════════════════════════════════ */
function clasificarLetra(lm) {
  const { P, I, Me, A, Mi, hs } = fingers(lm);
  const ext4 = [I,Me,A,Mi].filter(Boolean).length;

  const tPI  = touchPI(lm, hs);
  const tPMe = touchPMe(lm, hs);
  const sIM  = spreadIM(lm, hs);
  const thumbAbducted = dist(lm[4], lm[5]) > hs * 0.42;
  const thumbOverFing = lm[4].y > lm[6].y && lm[4].y > lm[10].y;

  // ── Gestos de contacto especiales ──
  if (tPI && Me && A && Mi && !I)          return 'F';  // F: O arriba
  if (esFormaO(lm, hs))                    return 'O';  // O
  if (I && !Me && !A && !Mi && tPMe)       return 'D';  // D: índice + pulgar-medio
  if (!P && I && Me && !A && !Mi && sIM < 0.22) return 'R'; // R: cruzados
  if (!P && I && Me && !A && !Mi && sIM < 0.35) return 'U'; // U: juntos
  if (!P && I && Me && !A && !Mi)          return 'V';  // V: separados

  // ── 4 dedos ──
  if (!P && I && Me && A && Mi)            return 'B';

  // ── 3 dedos ──
  if (!P && I && Me && A && !Mi)           return 'W';

  // ── Pulgar + 1 ──
  if (P && !Me && !A && !Mi) {
    if (I && !Me && !A && !Mi) return esFormaL(lm) ? 'L' : 'G';
    if (!I && Mi)              return 'Y';
  }

  // ── 1 dedo ──
  if (!Me && !A && !Mi) {
    if (I  && !P) return 'D';
    if (!I && Mi) return 'I';
  }

  // ── Puño cerrado ──
  if (ext4 === 0) {
    if (esFormaO(lm, hs))    return 'O';
    // M: pulgar bajo 3 dedos
    if (lm[4].y > lm[6].y && lm[4].y > lm[10].y && lm[4].y > lm[14].y) return 'M';
    // N: pulgar bajo 2 dedos
    if (lm[4].y > lm[6].y && lm[4].y > lm[10].y && lm[4].y <= lm[14].y) return 'N';
    // E: yemas muy cerca de la palma
    if (esPoseE(lm, hs))     return 'E';
    // S: pulgar sobre los dedos
    if (thumbOverFing && P)  return 'S';
    // T: pulgar entre índice y medio (punta asoma entre dedos)
    if (lm[4].y < lm[8].y && lm[4].y > lm[5].y) return 'T';
    return 'A';
  }

  // ── C: arco (ninguno totalmente extendido, ningún puño) ──
  if (esFormaC(lm, hs))     return 'C';

  return null;
}

/* ══════════════════════════════════════
   CLASIFICADOR DE PALABRAS
══════════════════════════════════════ */
function clasificarPalabra(lm, mov) {
  const { P, I, Me, A, Mi, hs } = fingers(lm);
  const allOpen  = I && Me && A && Mi;
  const fist     = !I && !Me && !A && !Mi;
  const idxOnly  = !P && I && !Me && !A && !Mi;

  // ── Dinámicos (movimiento primero) ──
  if (mov) {
    if (allOpen    && mov.isWaving)   return 'hola';
    if (fist       && mov.isNodding)  return 'si';
    if (idxOnly    && mov.isShaking)  return 'no';
    if (allOpen    && mov.movingDown) return 'gracias';
  }

  // ── Estáticos ──
  if ( P && !I && !Me && !A && !Mi && esPulgarArriba(lm)) return 'bien';
  if ( P && !I && !Me && !A && !Mi && esPulgarAbajo(lm))  return 'mal';
  if ( P && I  && !Me && !A && Mi)                         return 'tequiero';
  if (!P && I  && Me  && !A && !Mi)                        return 'paz';
  if ( P && !I && !Me && !A && Mi)                         return 'llamar';
  if (!I && Me && A   && Mi && touchPI(lm,hs))             return 'ok';
  if ( idxOnly)                                            return 'usted';
  if (!I && !Me && !A && !Mi && esFormaC(lm, hs))         return 'comoestas';

  return null;
}

/* ══════════════════════════════════════
   DIBUJO DE MANO
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
  const cx = lm => (flip ? 1 - lm.x : lm.x) * canvas.width;
  const cy = lm => lm.y * canvas.height;

  // Conexiones
  HAND_CONNECTIONS.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(cx(lm[a]), cy(lm[a]));
    ctx.lineTo(cx(lm[b]), cy(lm[b]));
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 8;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  });

  // Puntos
  lm.forEach((p, i) => {
    const r = (i === 0 ? 7 : i % 4 === 0 ? 5 : 3);
    ctx.beginPath();
    ctx.arc(cx(p), cy(p), r, 0, Math.PI*2);
    ctx.fillStyle   = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  });
}

/* ══════════════════════════════════════
   UI — HELPERS
══════════════════════════════════════ */
function showNoHands() {
  if (espejoModoActual === 'letras') {
    [0, 1].forEach(i => resetHandPanel(i));
  } else {
    const el = document.getElementById('espejo-instant-detect');
    if (el) {
      el.innerHTML  = '<span class="instant-label">Muestra tus manos…</span>';
      el.className  = 'espejo-instant-detect';
    }
  }
}

function resetHandPanel(hi) {
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
    box.innerHTML = textoAcumulado.map(p => `<span class="palabra">${p}</span>`).join(' ');
  }
  box.scrollTop = box.scrollHeight;
}

function espejoBorrarUltima() {
  if (textoAcumulado.length > 0) { textoAcumulado.pop(); renderTextoAcumulado(); }
  lastCommitted = [null, null];
}
function espejoLimpiar() {
  textoAcumulado = []; lastCommitted = [null, null];
  wristHistory   = [[], []];
  renderTextoAcumulado();
}
function espejoHablar() {
  if (!textoAcumulado.length) return;
  const utt = new SpeechSynthesisUtterance(textoAcumulado.join(', '));
  utt.lang = 'es-ES';
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
  stabBuffers  = [[], []];
  wristHistory = [[], []];
  lastCommitted = [null, null];
  inCooldown    = [false, false];
}
