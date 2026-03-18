/**
 * MANO APP — Lógica principal
 * Abecedario y Quiz usan imágenes individuales de letras/
 */

const LETRAS_DIR = 'letras/';

/* Datos del abecedario: letra + descripción (ya no necesita coords de sprite) */
const abecedario = [
  { letra:'A', desc:'Puño, pulgar lateral' },
  { letra:'B', desc:'Mano abierta, dedos juntos' },
  { letra:'C', desc:'Forma de C' },
  { letra:'D', desc:'Índice arriba, mano curva' },
  { letra:'E', desc:'Dedos doblados' },
  { letra:'F', desc:'Seña OK / F' },
  { letra:'G', desc:'Índice señalando lateral' },
  { letra:'H', desc:'Dos dedos laterales' },
  { letra:'I', desc:'Meñique extendido' },
  { letra:'J', desc:'Meñique traza J' },
  { letra:'K', desc:'V con pulgar al centro' },
  { letra:'L', desc:'L: pulgar e índice' },
  { letra:'M', desc:'Pulgar bajo 3 dedos' },
  { letra:'N', desc:'Pulgar bajo 2 dedos' },
  { letra:'O', desc:'Forma de O' },
  { letra:'P', desc:'K apuntando abajo' },
  { letra:'Q', desc:'G apuntando abajo' },
  { letra:'R', desc:'Dedos cruzados' },
  { letra:'S', desc:'Puño, pulgar sobre dedos' },
  { letra:'T', desc:'Pulgar entre dedos' },
  { letra:'U', desc:'Dos dedos juntos arriba' },
  { letra:'V', desc:'Dos dedos separados' },
  { letra:'W', desc:'Tres dedos extendidos' },
  { letra:'X', desc:'Índice doblado en gancho' },
  { letra:'Y', desc:'Pulgar y meñique' },
  { letra:'Z', desc:'Índice traza la Z' },
];

/* Helper: ruta de imagen para una letra */
function letraImg(letra) {
  return `${LETRAS_DIR}${letra.toLowerCase()}.jpg`;
}


/* ══════════════════════════════════════
   NAVEGACIÓN PRINCIPAL
══════════════════════════════════════ */
const tabs = ['inicio', 'diccionario', 'traductor', 'perfil'];

function switchTab(tab) {
  // Pausar traductor si se sale de su tab
  if (tab !== 'traductor') stopTranslating && stopTranslating();

  tabs.forEach(t => {
    const btn = document.getElementById(`btn-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
    const sec = document.getElementById(`content-${t}`);
    if (sec) sec.classList.toggle('hidden', t !== tab);
  });
  if (navigator.vibrate) navigator.vibrate(10);
  if (tab === 'diccionario') initDiccionario();
  if (tab === 'traductor')   initTraductor && initTraductor();
}


/* ══════════════════════════════════════
   DICCIONARIO — Sub-navegación
══════════════════════════════════════ */
function showDicSection(section) {
  ['abecedario', 'preguntas'].forEach(s => {
    const btn = document.getElementById(`dic-btn-${s}`);
    const sec = document.getElementById(`dic-${s}`);
    if (btn) btn.classList.toggle('active', s === section);
    if (sec) sec.classList.toggle('hidden', s !== section);
  });
  if (section === 'preguntas') {
    quizScore = 0; quizTotal = 0;
    updateScore();
    nextQuestion();
  }
}

/* ══════════════════════════════════════
   ABECEDARIO — Construir grid con imágenes
══════════════════════════════════════ */
let diccionarioIniciado = false;

function initDiccionario() {
  if (diccionarioIniciado) return;
  diccionarioIniciado = true;
  buildAbecedario();
}

function buildAbecedario() {
  const grid = document.getElementById('abc-grid');
  if (!grid) return;
  abecedario.forEach(item => {
    const card = document.createElement('div');
    card.className = 'abc-card';
    card.innerHTML = `
      <img class="abc-img" src="${letraImg(item.letra)}" alt="${item.letra}" loading="lazy">
      <span class="abc-letter">${item.letra}</span>
      <span class="abc-desc">${item.desc}</span>
    `;
    grid.appendChild(card);
  });
}

/* ══════════════════════════════════════
   QUIZ — Preguntas (imagen real, sin emoji)
══════════════════════════════════════ */
let quizScore      = 0;
let quizTotal      = 0;
let quizActual     = null;
let quizRespondido = false;

function getRandomOptions(correct) {
  const pool = abecedario.filter(x => x.letra !== correct.letra);
  return [...pool.sort(() => Math.random() - 0.5).slice(0, 3), correct]
    .sort(() => Math.random() - 0.5);
}

function nextQuestion() {
  quizRespondido = false;
  quizActual = abecedario[Math.floor(Math.random() * abecedario.length)];
  const options = getRandomOptions(quizActual);

  // ── Mostrar imagen de la seña ──
  const signEl = document.getElementById('quiz-sign');
  signEl.innerHTML = `<img
    src="${letraImg(quizActual.letra)}"
    alt="${quizActual.letra}"
    class="quiz-sign-img-el"
    style="width:120px;height:120px;object-fit:contain;border-radius:14px;display:block;margin:0 auto;filter:drop-shadow(0 0 14px rgba(106,13,173,0.6));">`;

  document.getElementById('quiz-sign-label').textContent = quizActual.desc;

  // ── Limpiar estado ──
  const feedback = document.getElementById('quiz-feedback');
  feedback.textContent = '';
  feedback.className = 'quiz-feedback';
  document.getElementById('quiz-next').style.display = 'none';

  // ── Generar botones ──
  const optContainer = document.getElementById('quiz-options');
  optContainer.innerHTML = '';
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className   = 'quiz-opt-btn';
    btn.textContent = opt.letra;
    btn.onclick = () => answerQuestion(opt.letra, btn);
    optContainer.appendChild(btn);
  });
}

function answerQuestion(letraElegida, btnEl) {
  if (quizRespondido) return;
  quizRespondido = true;
  quizTotal++;

  const esCorrecta = letraElegida === quizActual.letra;
  const feedback   = document.getElementById('quiz-feedback');

  document.querySelectorAll('.quiz-opt-btn').forEach(b => {
    b.disabled = true;
    if (b.textContent === quizActual.letra) b.classList.add('correct');
  });

  if (esCorrecta) {
    quizScore++;
    btnEl.classList.add('correct');
    feedback.textContent = '✅ ¡Correcto!';
    feedback.className   = 'quiz-feedback ok';
  } else {
    btnEl.classList.add('wrong');
    feedback.textContent = `❌ Era: ${quizActual.letra}`;
    feedback.className   = 'quiz-feedback err';
  }
  updateScore();
  document.getElementById('quiz-next').style.display = 'block';
}

function updateScore() {
  const el = document.getElementById('quiz-score');
  if (el) el.textContent = `Puntuación: ${quizScore} / ${quizTotal}`;
}

/* ══════════════════════════════════════
   PERFIL — Lógica de campos y localStorage
══════════════════════════════════════ */
function prfLoadData() {
  const data = JSON.parse(localStorage.getItem('mano_perfil') || '{}');
  const nombre   = document.getElementById('prf-nombre');
  const apellido = document.getElementById('prf-apellido');
  const lugar    = document.getElementById('prf-lugar');
  if (nombre   && data.nombre)   nombre.value   = data.nombre;
  if (apellido && data.apellido) apellido.value  = data.apellido;
  if (lugar    && data.lugar)    lugar.value     = data.lugar;
  prfSetReadOnly(true);
}

function prfSetReadOnly(readonly) {
  ['prf-nombre','prf-apellido','prf-lugar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = readonly;
  });
  const saveBtn = document.getElementById('prf-btn-save');
  if (saveBtn) saveBtn.disabled = readonly;
}

function prfEdit() {
  prfSetReadOnly(false);
  document.getElementById('prf-nombre') &&
    document.getElementById('prf-nombre').focus();
}

function prfSave() {
  const data = {
    nombre:   document.getElementById('prf-nombre')?.value   || '',
    apellido: document.getElementById('prf-apellido')?.value || '',
    lugar:    document.getElementById('prf-lugar')?.value    || '',
  };
  localStorage.setItem('mano_perfil', JSON.stringify(data));
  prfSetReadOnly(true);

  // Feedback visual breve
  const btn = document.getElementById('prf-btn-save');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ Guardado';
    setTimeout(() => { btn.innerHTML = orig; }, 1500);
  }
}

function prfLogout() {
  const ok = confirm('¿Cerrar sesión y borrar datos del perfil?');
  if (!ok) return;
  localStorage.removeItem('mano_perfil');
  ['prf-nombre','prf-apellido','prf-lugar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  prfSetReadOnly(true);
}

// Cargar perfil al arrancar
document.addEventListener('DOMContentLoaded', prfLoadData);
