/**
 * MANO APP — Modo Espejo con IA
 * MediaPipe Hands + clasificador geométrico
 * Detecta letras (A-M) y frases (Hola, Cómo estás, Bien, Usted)
 */

/* ══════════════════════════════════════
   ESTADO GLOBAL DEL ESPEJO
══════════════════════════════════════ */
let espejoHands       = null;
let espejoCamera      = null;
let espejoActivo      = false;
let espejoModoActual  = 'letras';   // 'letras' | 'palabras'
let espejoLetraObj    = 'A';
let espejoPalabraObj  = 'hola';

// Buffer temporal para detección sostenida de frases
const BUFFER_SIZE     = 45;         // ~1.5s a 30fps
let frameBuffer       = [];         // últimas N detecciones
let esperandoNueva    = false;

// Estado para Traductor Continuo
let textoAcumulado = [];
let ultimaFraseAgregada = null;

// Configuración de Cámara
let espejoFacingMode = 'user'; // 'user' (frontal) | 'environment' (trasera)

/* ══════════════════════════════════════
   DEFINICIÓN DE LETRAS
══════════════════════════════════════ */
const letrasEspejo = [
  { letra: 'A', desc: 'Puño cerrado, pulgar lateral' },
  { letra: 'B', desc: 'Mano abierta, dedos juntos' },
  { letra: 'C', desc: 'Curva en forma de C' },
  { letra: 'D', desc: 'Índice arriba, mano curva' },
  { letra: 'E', desc: 'Dedos curvados hacia la palma' },
  { letra: 'F', desc: 'Pulgar e índice se tocan' },
  { letra: 'G', desc: 'Índice apunta al costado' },
  { letra: 'H', desc: 'Índice y medio horizontales' },
  { letra: 'I', desc: 'Solo meñique extendido' },
  { letra: 'L', desc: 'Pulgar e índice en L' },
  { letra: 'M', desc: 'Pulgar bajo tres dedos' },
];

/* ══════════════════════════════════════
   DEFINICIÓN DE FRASES
══════════════════════════════════════ */
const frasesEspejo = [
  { id: 'hola',       texto: 'Hola',         emoji: '👋', instruccion: 'Mano abierta plana, enfocada a la cámara' },
  { id: 'comoestas',  texto: '¿Cómo estás?', emoji: '🤔', instruccion: 'Forma una C con tu mano' },
  { id: 'bien',       texto: 'Bien',         emoji: '👍', instruccion: 'Pulgar arriba, resto del puño cerrado' },
  { id: 'mal',        texto: 'Mal',          emoji: '👎', instruccion: 'Pulgar señalando hacia abajo' },
  { id: 'usted',      texto: 'Usted',        emoji: '👉', instruccion: 'Índice extendido señalando adelante' },
  { id: 'tequiero',   texto: 'Te quiero',    emoji: '🤟', instruccion: 'Pulgar, índice y meñique arriba' },
  { id: 'paz',        texto: 'Paz / Dos',    emoji: '✌️', instruccion: 'Índice y medio arriba en forma de V' },
  { id: 'llamar',     texto: 'Llamar',       emoji: '🤙', instruccion: 'Pulgar y meñique arriba (forma Y)' },
  { id: 'ok',         texto: 'Todo bien/OK', emoji: '👌', instruccion: 'Pulgar e índice unidos en O, resto arriba' },
];

/* ══════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════ */
function initEspejo() {
  if (espejoActivo) return;

  showEspejoMode('letras');

  // Esperar a que MediaPipe esté disponible
  if (typeof Hands === 'undefined') {
    const r = document.getElementById('espejo-live-desc');
    if (r) r.textContent = '⚠️ Abre la app desde un servidor HTTP (Live Server o http://)';
    return;
  }

  espejoHands = new Hands({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  espejoHands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5,
  });

  espejoHands.onResults(onEspejoResults);

  const video = document.getElementById('espejo-video');
  if (!video) return;

  espejoCamera = new Camera(video, {
    onFrame: async () => {
      if (espejoActivo && espejoHands) {
        await espejoHands.send({ image: video });
      }
    },
    width: 340,
    height: 255,
    facingMode: espejoFacingMode,
  });

  espejoCamera.start();
  espejoActivo = true;
}

function espejoToggleCamara() {
  espejoFacingMode = espejoFacingMode === 'user' ? 'environment' : 'user';
  if (espejoActivo && espejoCamera) {
    espejoCamera.stop();
    const video = document.getElementById('espejo-video');
    espejoCamera = new Camera(video, {
      onFrame: async () => {
        if (espejoActivo && espejoHands) {
          await espejoHands.send({ image: video });
        }
      },
      width: 340,
      height: 255,
      facingMode: espejoFacingMode,
    });
    espejoCamera.start();
  }
}

function stopEspejo() {
  espejoActivo = false;
  if (espejoCamera) {
    espejoCamera.stop();
    espejoCamera = null;
  }
  if (espejoHands) {
    espejoHands.close();
    espejoHands = null;
  }
  frameBuffer = [];
  esperandoNueva = false;
}

/* ══════════════════════════════════════
   PROCESAMIENTO DE RESULTADOS MEDIAPIPE
══════════════════════════════════════ */
function onEspejoResults(results) {
  const canvas = document.getElementById('espejo-canvas');
  const ctx    = canvas ? canvas.getContext('2d') : null;
  if (!ctx || !canvas) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Dibujar la imagen de video
  ctx.save();
  if (espejoFacingMode === 'user') {
    ctx.scale(-1, 1);
    ctx.drawImage(results.image, -canvas.width, 0, canvas.width, canvas.height);
  } else {
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
  }
  ctx.restore();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    frameBuffer = [];
    showNoHand();
    return;
  }

  const landmarks = results.multiHandLandmarks[0];

  // ── Colores por dedo ──
  const COLORES = {
    palma:  'rgba(255,255,255,0.55)',   // blanco suave
    pulgar: '#facc15',                  // amarillo
    indice: '#22d3ee',                  // cian
    medio:  '#4ade80',                  // verde
    anular: '#fb923c',                  // naranja
    menique:'#f472b6',                  // rosa
  };

  // Mapeo: índice del landmark → color
  function colorDeLandmark(i) {
    if ([1,2,3,4].includes(i))                   return COLORES.pulgar;
    if ([5,6,7,8].includes(i))                   return COLORES.indice;
    if ([9,10,11,12].includes(i))                return COLORES.medio;
    if ([13,14,15,16].includes(i))               return COLORES.anular;
    if ([17,18,19,20].includes(i))               return COLORES.menique;
    return COLORES.palma;                         // muñeca (0)
  }

  // Mapeo: conexión → color (usa el color del primer punto)
  function colorDeConexion(i) {
    if ([0,1,2,3].includes(i))  return COLORES.pulgar;   // [0-1],[1-2],[2-3],[3-4]
    if ([4,5,6,7].includes(i))  return COLORES.indice;   // [0-5],[5-6],[6-7],[7-8]
    if ([8,9,10,11].includes(i))return COLORES.medio;    // [0-9],[9-10]...
    if ([12,13,14,15].includes(i)) return COLORES.anular;
    if ([16,17,18,19].includes(i)) return COLORES.menique;
    return COLORES.palma;                                 // conexiones de palma
  }

  // ── Dibujar conexiones con color por dedo ──
  HAND_CONNECTIONS.forEach(([a, b], idx) => {
    const lmA = landmarks[a];
    const lmB = landmarks[b];
    const xA = espejoFacingMode === 'user' ? (1 - lmA.x) : lmA.x;
    const xB = espejoFacingMode === 'user' ? (1 - lmB.x) : lmB.x;

    ctx.beginPath();
    ctx.moveTo(xA * canvas.width, lmA.y * canvas.height);
    ctx.lineTo(xB * canvas.width, lmB.y * canvas.height);
    ctx.strokeStyle = colorDeConexion(idx);
    ctx.lineWidth   = 2.5;
    ctx.shadowColor = colorDeConexion(idx);
    ctx.shadowBlur  = 6;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  });

  // ── Dibujar puntos con color por dedo ──
  landmarks.forEach((lm, i) => {
    const xDir  = espejoFacingMode === 'user' ? (1 - lm.x) : lm.x;
    const x     = xDir * canvas.width;
    const y     = lm.y * canvas.height;
    const color = colorDeLandmark(i);
    const radio = i === 0 ? 7 : (i % 4 === 0 ? 6 : 4);  // punta de dedo más grande
    ctx.beginPath();
    ctx.arc(x, y, radio, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10;
    ctx.fill();
    // borde blanco sutil
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.shadowBlur  = 0;
  });

  // Clasificar según el modo activo
  if (espejoModoActual === 'letras') {
    procesarModoLetras(landmarks);
  } else {
    procesarModoPalabras(landmarks);
  }
}

/* ══════════════════════════════════════
   MODO LETRAS — Traductor en tiempo real
══════════════════════════════════════ */
function procesarModoLetras(landmarks) {
  const letra = clasificarLetra(landmarks);
  const letraEl = document.getElementById('espejo-live-letter');
  const descEl  = document.getElementById('espejo-live-desc');
  if (!letraEl || !descEl) return;

  if (letra) {
    const info = letrasEspejo.find(l => l.letra === letra);
    letraEl.textContent = letra;
    letraEl.className   = 'espejo-live-letter detected';
    descEl.textContent  = info ? info.desc : '';
  } else {
    letraEl.textContent = '—';
    letraEl.className   = 'espejo-live-letter';
    descEl.textContent  = 'Muestra tu mano a la cámara';
  }
}

/* ══════════════════════════════════════
   MODO PALABRAS — Traductor Continuo
══════════════════════════════════════ */
function procesarModoPalabras(landmarks) {
  const fraseId = clasificarPalabra(landmarks);

  // Buffer para estabilizar la detección
  frameBuffer.push(fraseId);
  if (frameBuffer.length > BUFFER_SIZE) frameBuffer.shift();

  const counts = {};
  frameBuffer.forEach(f => { if (f) counts[f] = (counts[f] || 0) + 1; });

  let maxFrase = null, maxCount = 0;
  Object.entries(counts).forEach(([k, v]) => { if (v > maxCount) { maxCount = v; maxFrase = k; } });

  const confianza = frameBuffer.length > 0 ? maxCount / frameBuffer.length : 0;
  updateConfianzaBar(maxFrase, confianza);

  const descEl = document.getElementById('espejo-live-phrase-desc');
  if (!descEl) return;

  // Si hay alta confianza, el buffer está lleno de esa seña y superó el umbral
  if (maxFrase && confianza >= 0.75 && frameBuffer.length >= BUFFER_SIZE) {
    const info = frasesEspejo.find(f => f.id === maxFrase);
    descEl.textContent = info ? `Detectando: ${info.texto}...` : '';

    // Si no estamos en cooldown y no es la misma frase que acabamos de agregar pegada
    if (!esperandoNueva && maxFrase !== ultimaFraseAgregada) {
      if (info) {
        textoAcumulado.push(info.texto);
        ultimaFraseAgregada = maxFrase;
        renderTextoAcumulado();
      }
      
      // Cooldown para no agregar la misma palabra 20 veces por segundo
      esperandoNueva = true;
      setTimeout(() => {
        esperandoNueva = false;
        frameBuffer = []; // Forzar nueva evaluación
      }, 1500); 
    }
  } else {
    descEl.textContent = 'Mantén la seña para agregarla a la frase...';
    // Si la mano se va o deja de hacer seña un rato, permitimos repetir la misma palabra
    if (!maxFrase && frameBuffer.every(f => !f)) {
      ultimaFraseAgregada = null;
    }
  }
}

/* ══════════════════════════════════════
   ACCIONES TRADUCTOR CONTINUO
══════════════════════════════════════ */
function renderTextoAcumulado() {
  const box = document.getElementById('espejo-texto-acumulado');
  if (!box) return;

  if (textoAcumulado.length === 0) {
    box.innerHTML = '<span class="espejo-placeholder">La traducción aparecerá aquí...</span>';
  } else {
    box.innerHTML = textoAcumulado.map(palabra => `<span class="palabra">${palabra}</span>`).join(' ');
  }
  box.scrollTop = box.scrollHeight;
}

function espejoBorrarUltima() {
  if (textoAcumulado.length > 0) {
    textoAcumulado.pop();
    ultimaFraseAgregada = null; // permite repetir si es necesario
    renderTextoAcumulado();
  }
}

function espejoLimpiar() {
  textoAcumulado = [];
  ultimaFraseAgregada = null;
  frameBuffer = [];
  renderTextoAcumulado();
}

function espejoHablar() {
  if (textoAcumulado.length === 0) return;
  // Unimos con comas para que la voz haga una pequeña pausa entre palabras clave
  const frase = textoAcumulado.join(', ');
  const utterance = new SpeechSynthesisUtterance(frase);
  utterance.lang = 'es-ES';
  window.speechSynthesis.speak(utterance);
}

function updateConfianzaBar(fraseId, nivel) {
  const wrap = document.getElementById('espejo-confianza-wrap');
  const bar  = document.getElementById('espejo-confianza-bar');
  const lbl  = document.getElementById('espejo-confianza-label');
  if (!wrap || !bar || !lbl) return;

  const pct = Math.round(nivel * 100);
  bar.style.width = pct + '%';
  bar.style.background = pct >= 70
    ? 'linear-gradient(90deg,#7c3aed,#a855f7)'
    : 'linear-gradient(90deg,#3a0070,#6a0dad)';
  lbl.textContent = `Confianza: ${pct}%`;
}

/* ══════════════════════════════════════
   CLASIFICADOR DE LETRAS (mejorado)
══════════════════════════════════════ */
/**
 * Método confiable:
 * Un dedo está EXTENDIDO si su punta (TIP) está más ARRIBA que su PIP.
 * En coordenadas de imagen: Y pequeña = arriba de la pantalla.
 * tip.y < pip.y  → dedo extendido
 * tip.y > pip.y  → dedo doblado
 */
function dedosExtendidos(lm) {
  const indice  = lm[8].y  < lm[6].y;   // punta índice < PIP índice
  const medio   = lm[12].y < lm[10].y;  // punta medio  < PIP medio
  const anular  = lm[16].y < lm[14].y;  // punta anular < PIP anular
  const menique = lm[20].y < lm[18].y;  // punta meñique< PIP meñique

  // Pulgar: comparar su punta (4) con su segunda articulación (2) en X
  // Como la imagen es espejada, usamos distancia genérica desde la base
  const pulgar = distancia(lm[4], lm[0]) > distancia(lm[2], lm[0]) * 1.05;

  return [pulgar, indice, medio, anular, menique];
}

/**
 * Retorna true si la punta del dedo está doblada hacia la palma.
 * tip.y > mcp.y (la punta está más abajo = doblado).
 */
function dedoCurvado(lm, tip, mcp) {
  return lm[tip].y > lm[mcp].y;
}

function clasificarLetra(lm) {
  const [P, I, Me, A, Mi] = dedosExtendidos(lm);

  // ── F: índice y pulgar se tocan, medio+anular+meñique extendidos ──
  if (esFormaF(lm) && Me && A && Mi) return 'F';

  // ── B: 4 dedos arriba, pulgar doblado o pegado ──
  if (!P && I && Me && A && Mi) return 'B';

  // ── L: pulgar e índice en L (90°) ──
  if (P && I && !Me && !A && !Mi && esFormaL(lm)) return 'L';

  // ── H: índice y medio extendidos, resto doblado ──
  if (!P && I && Me && !A && !Mi) return 'H';

  // ── D: solo índice extendido, sin pulgar ──
  if (!P && I && !Me && !A && !Mi) return 'D';

  // ── G: pulgar e índice extendidos pero SIN forma de L ──
  if (P && I && !Me && !A && !Mi && !esFormaL(lm)) return 'G';

  // ── I: solo meñique extendido ──
  if (!P && !I && !Me && !A && Mi) return 'I';

  // ── C: ninguno extendido del todo, mano curvada en arco ──
  if (!I && !Me && !A && !Mi && esFormaC(lm)) return 'C';

  // ── Todos doblados → distinguir A / E / M ──
  if (!I && !Me && !A && !Mi) {
    if (esPoseM(lm)) return 'M';
    if (esPoseE(lm)) return 'E';
    return 'A';           // por defecto: puño cerrado = A
  }

  return null;
}

/* ══════════════════════════════════════
   CLASIFICADOR DE PALABRAS
══════════════════════════════════════ */
function clasificarPalabra(lm) {
  const ext = dedosExtendidos(lm);
  const [P, I, Me, A, Mi] = ext;

  // BIEN: pulgar extendido arriba, resto cerrado (👍)
  if (P && !I && !Me && !A && !Mi && esPulgarArriba(lm)) return 'bien';

  // MAL: pulgar extendido abajo, resto cerrado (👎)
  if (P && !I && !Me && !A && !Mi && esPulgarAbajo(lm)) return 'mal';

  // HOLA: mano abierta
  if (P && I && Me && A && Mi) return 'hola';

  // TE QUIERO: pulgar, índice, meñique (🤟)
  if (P && I && !Me && !A && Mi) return 'tequiero';

  // PAZ: índice y medio en V (✌️)
  if (!P && I && Me && !A && !Mi) return 'paz';

  // LLAMAR: pulgar y meñique (🤙)
  if (P && !I && !Me && !A && Mi) return 'llamar';

  // TODO BIEN / OK: Medio, anular y meñique extendidos, índice y pulgar en 'O' (👌)
  if (!I && Me && A && Mi && esFormaF(lm)) return 'ok';

  // USTED: solo índice extendido, señalando
  if (!P && I && !Me && !A && !Mi) return 'usted';

  // COMO ESTAS: forma de C con la mano
  if (!I && !Me && !A && !Mi && esFormaC(lm)) return 'comoestas';

  return null;
}


function distancia(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
}

function esFormaC(lm) {
  // En C, todos los dedos están curvados pero no cerrados del todo.
  // La distancia entre punta del índice y pulgar forma un arco.
  const d_PulgarIndice = distancia(lm[4], lm[8]);
  const d_PulgarMenique = distancia(lm[4], lm[20]);
  const d_IndiceMenique = distancia(lm[8], lm[20]);

  // La C tiene forma abierta: pulgar e índice no se tocan,
  // y la apertura es mayor que una F pero menor que una mano abierta.
  const anchoMano = distancia(lm[5], lm[17]);
  const ratio = d_PulgarIndice / anchoMano;

  return ratio > 0.35 && ratio < 0.85 && d_IndiceMenique < anchoMano * 1.5;
}

function esFormaF(lm) {
  // F: pulgar e índice se tocan (distancia muy pequeña)
  const d = distancia(lm[4], lm[8]);
  const anchoMano = distancia(lm[5], lm[17]);
  return d < anchoMano * 0.25;
}

function esFormaL(lm) {
  // L: pulgar apunta hacia arriba, índice apunta hacia la derecha/izquierda
  // El ángulo entre pulgar e índice debe ser cercano a 90°
  const pulgarVec  = { x: lm[4].x - lm[2].x, y: lm[4].y - lm[2].y };
  const indiceVec  = { x: lm[8].x - lm[5].x, y: lm[8].y - lm[5].y };

  const dot = pulgarVec.x * indiceVec.x + pulgarVec.y * indiceVec.y;
  const magP = Math.hypot(pulgarVec.x, pulgarVec.y);
  const magI = Math.hypot(indiceVec.x, indiceVec.y);
  if (magP === 0 || magI === 0) return false;

  const cosAngle = dot / (magP * magI);
  const angle    = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);

  return angle > 60 && angle < 120;
}

function esPoseE(lm) {
  // E: todos los dedos curvados, yemas cerca de la palma
  const palma = lm[9];
  const limiteE = distancia(lm[0], lm[9]) * 0.85;
  return (
    distancia(lm[8], palma)  < limiteE &&
    distancia(lm[12], palma) < limiteE &&
    distancia(lm[16], palma) < limiteE &&
    distancia(lm[20], palma) < limiteE
  );
}

function esPoseM(lm) {
  // M: pulgar oculto bajo los 3 dedos centrales
  // El pulgar está por debajo (mayor Y) que el índice, medio y anular
  const pulgarY = lm[4].y;
  return (
    pulgarY > lm[6].y  &&
    pulgarY > lm[10].y &&
    pulgarY > lm[14].y
  );
}

function esPulgarArriba(lm) {
  // Pulgar arriba: la punta del pulgar (4) está más arriba que la base de la mano (0)
  return lm[4].y < lm[0].y - 0.1;
}

function esPulgarAbajo(lm) {
  // Pulgar abajo: la punta del pulgar (4) está más abajo que la base de la mano (0)
  return lm[4].y > lm[0].y + 0.1;
}

/* ══════════════════════════════════════
   DIBUJO DE CONEXIONES (estilo MediaPipe)
══════════════════════════════════════ */
const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],     // pulgar
  [0,5],[5,6],[6,7],[7,8],     // índice
  [0,9],[9,10],[10,11],[11,12],// medio
  [0,13],[13,14],[14,15],[15,16],// anular
  [0,17],[17,18],[18,19],[19,20],// meñique
  [5,9],[9,13],[13,17],[5,17]  // palma
];

function drawConnections(ctx, canvas, landmarks, connections, style) {
  ctx.strokeStyle = style.color || '#a855f7';
  ctx.lineWidth   = style.lineWidth || 2;
  connections.forEach(([i, j]) => {
    const a = landmarks[i];
    const b = landmarks[j];
    ctx.beginPath();
    ctx.moveTo((1 - a.x) * canvas.width, a.y * canvas.height);
    ctx.lineTo((1 - b.x) * canvas.width, b.y * canvas.height);
    ctx.stroke();
  });
}

/* ══════════════════════════════════════
   UI — CONSTRUCCIÓN DINÁMICA
══════════════════════════════════════ */
function buildLetraSelector() {
  const container = document.getElementById('espejo-letras-buttons');
  if (!container || container.childElementCount > 0) return;

  letrasEspejo.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'espejo-letra-btn' + (item.letra === espejoLetraObj ? ' active' : '');
    btn.textContent = item.letra;
    btn.title = item.desc;
    btn.onclick = () => {
      espejoLetraObj = item.letra;
      document.querySelectorAll('.espejo-letra-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const info = document.getElementById('espejo-letra-desc');
      if (info) info.textContent = item.desc;
      const res = document.getElementById('espejo-letra-result');
      if (res) { res.textContent = ''; res.className = 'espejo-result'; }
    };
    container.appendChild(btn);
  });

  // Descripcion inicial
  const info = document.getElementById('espejo-letra-desc');
  if (info) info.textContent = letrasEspejo[0].desc;
}

function buildPalabraSelector() {
  const container = document.getElementById('espejo-palabras-buttons');
  if (!container || container.childElementCount > 0) return;

  frasesEspejo.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'espejo-palabra-btn' + (item.id === espejoPalabraObj ? ' active' : '');
    btn.innerHTML = `${item.emoji} ${item.texto}`;
    btn.onclick = () => {
      espejoPalabraObj = item.id;
      frameBuffer = [];
      esperandoNueva = false;
      document.querySelectorAll('.espejo-palabra-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const res = document.getElementById('espejo-palabra-result');
      if (res) { res.textContent = item.instruccion; res.className = 'espejo-result hint'; }
    };
    container.appendChild(btn);
  });
}

function showNoHand() {
  if (espejoModoActual === 'letras') {
    const l = document.getElementById('espejo-live-letter');
    const d = document.getElementById('espejo-live-desc');
    if (l) { l.textContent = '—'; l.className = 'espejo-live-letter'; }
    if (d) d.textContent = 'Acerca tu mano a la cámara';
  } else {
    const d = document.getElementById('espejo-live-phrase-desc');
    if (d) d.textContent = 'Acerca tu mano a la cámara...';
    updateConfianzaBar(null, 0);
  }
}

/* ══════════════════════════════════════
   SUB-NAVEGACIÓN DEL MODO ESPEJO
══════════════════════════════════════ */
function showEspejoMode(mode) {
  espejoModoActual = mode;
  ['letras', 'palabras'].forEach(m => {
    const btn = document.getElementById(`espejo-btn-${m}`);
    const sec = document.getElementById(`espejo-${m}-section`);
    if (btn) btn.classList.toggle('active', m === mode);
    if (sec) sec.classList.toggle('hidden', m !== mode);
  });
  frameBuffer = [];
  esperandoNueva = false;
}
