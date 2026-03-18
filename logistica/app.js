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
const tabs = ['inicio', 'diccionario', 'traductor', 'perfil', 'juegos'];

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
  if (tab === 'juegos')      initJuegos();
  if (tab === 'traductor')   initTraductor && initTraductor();
}


/* ══════════════════════════════════════
   JUEGOS — Sub-Navegación e Inicialización
══════════════════════════════════════ */
function showJuegoSection(section) {
  ['adivina', 'trivia'].forEach(s => {
    const btn = document.getElementById(`juego-btn-${s}`);
    const sec = document.getElementById(`juego-${s}`);
    if (btn) btn.classList.toggle('active', s === section);
    if (sec) sec.classList.toggle('hidden', s !== section);
  });
  if (section === 'adivina' && quizTotal === 0) {
    quizScore = 0; quizTotal = 0;
    updateScore();
    nextQuestion();
  }
  if (section === 'trivia' && typeof currentTriviaIndex === 'undefined') {
    initTrivia();
  } else if (section === 'trivia' && currentTriviaIndex === 0 && !document.getElementById('trivia-options').innerHTML.trim()) {
    initTrivia();
  }
}

function initJuegos() {
  showJuegoSection('adivina');
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
  if (quizTotal >= 100) {
    const el = document.getElementById('quiz-score');
    if (el) el.textContent = `¡Has completado los 100 niveles! 🎉`;
    document.getElementById('quiz-options').innerHTML = '';
    const signEl = document.getElementById('quiz-sign');
    signEl.innerHTML = '<div style="font-size: 60px; line-height: 120px;">🏆</div>';
    document.getElementById('quiz-sign-label').textContent = '¡Felicidades!';
    document.getElementById('quiz-next').style.display = 'none';
    return;
  }
  updateScore();
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
  // Se cambia el puntaje por el nivel (1 al 100)
  const maxNiveles = 100;
  const nivelActual = Math.min(quizTotal + 1, maxNiveles);
  if (el) el.textContent = `NIVEL ${nivelActual}/${maxNiveles}`;
}

/* ══════════════════════════════════════
   TRIVIA SORDA (Niveles 1 al 100)
══════════════════════════════════════ */
const trivias = [
  {
    tema: 'Mitos y Realidades 🧠',
    pregunta: '¿Cuál es el término correcto y respetuoso en Venezuela para referirse a alguien que no oye?',
    opciones: [
      { texto: 'Sordomudo', correcta: false, explicacion: '¡Mito! Las personas sordas sí tienen cuerdas vocales, solo no desarrollaron el habla.' },
      { texto: 'Persona Sorda / Sordo', correcta: true, explicacion: '¡Correcto! Es el término adecuado aceptado por la comunidad.' },
      { texto: 'Enfermo del oído', correcta: false, explicacion: 'No es el término preferido, ya que se enfoca en la carencia.' }
    ]
  },
  {
    tema: 'Comunicación 💬',
    pregunta: '¿Es el lenguaje de señas universal en todo el mundo?',
    opciones: [
      { texto: 'Sí, es igual en todos lados', correcta: false, explicacion: '¡Falso! Cada país tiene su propia lengua de señas.' },
      { texto: 'No, varía por país', correcta: true, explicacion: '¡Correcto! Cada idioma y cultura ha desarrollado la suya propia.' },
      { texto: 'Solo existe la Internacional', correcta: false, explicacion: 'Solo existe un sistema internacional parcial, pero no es universal.' }
    ]
  },
  {
    tema: 'Mitos y Realidades 🧠',
    pregunta: '¿Todas las personas sordas leen los labios perfectamente?',
    opciones: [
      { texto: 'Sí, siempre pueden', correcta: false, explicacion: '¡Mito! Solo se capta alrededor del 30% a 40% del mensaje.' },
      { texto: 'No, la lectoescritura es parcial', correcta: true, explicacion: '¡Correcto! Requiere un gran esfuerzo y no todos lo hacen.' },
      { texto: 'Depende del audífono', correcta: false, explicacion: 'Falso, la lectura labial es puramente visual.' }
    ]
  }
];

const trivia100 = [];
for (let i = 0; i < 100; i++) {
  trivia100.push(trivias[i % trivias.length]); 
}

let currentTriviaIndex = 0;
let triviaRespondida = false;

function initTrivia() {
  currentTriviaIndex = 0;
  loadTrivia();
}

function loadTrivia() {
  if (currentTriviaIndex >= 100) {
    document.getElementById('trivia-score').textContent = `¡COMPLETADO!`;
    document.getElementById('trivia-options').innerHTML = '<div style="font-size: 60px; line-height: 120px;">🏆</div>';
    document.getElementById('trivia-question').textContent = 'Has demostrado ser un experto en Cultura Sorda.';
    document.getElementById('trivia-next').style.display = 'none';
    return;
  }

  const trivia = trivia100[currentTriviaIndex];
  triviaRespondida = false;

  document.getElementById('trivia-score').textContent = `NIVEL ${(currentTriviaIndex + 1)}/100`;
  document.getElementById('trivia-topic').textContent = trivia.tema;
  document.getElementById('trivia-question').textContent = trivia.pregunta;

  const optContainer = document.getElementById('trivia-options');
  optContainer.innerHTML = '';
  document.getElementById('trivia-feedback').textContent = '';
  document.getElementById('trivia-next').style.display = 'none';

  trivia.opciones.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'trivia-btn';
    btn.textContent = opt.texto;
    btn.style.background = 'rgba(255,255,255,0.06)';
    btn.style.border = '1.5px solid rgba(106,13,173,0.35)';
    btn.style.padding = '14px';
    btn.style.borderRadius = '12px';
    btn.style.fontSize = '13px';
    btn.style.color = 'rgba(255,255,255,0.8)';
    btn.style.fontWeight = '600';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s';
    btn.onclick = () => verificarRespuestaJuego(btn, opt.correcta, opt.explicacion);
    optContainer.appendChild(btn);
  });
}

function verificarRespuestaJuego(botonClickeado, esCorrecta, explicacion) {
    if (triviaRespondida) return;
    triviaRespondida = true;

    const feedback = document.getElementById('trivia-feedback');
    const contenedor = document.getElementById('trivia-options');
    
    const botones = contenedor.getElementsByTagName('button');
    for (let b of botones) {
        b.disabled = true;
        b.style.opacity = "0.7";
        b.style.cursor = "default";
    }

    if (esCorrecta) {
        botonClickeado.style.backgroundColor = "rgba(76, 175, 80, 0.2)"; 
        botonClickeado.style.color = "#4caf50";
        botonClickeado.style.borderColor = "#4caf50";
        botonClickeado.style.opacity = "1"; 
        
        feedback.innerText = "🎉 " + explicacion;
        feedback.style.color = "#4caf50";
        
        if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]); 
    } else {
        botonClickeado.style.backgroundColor = "rgba(244, 67, 54, 0.2)"; 
        botonClickeado.style.color = "#f44336";
        botonClickeado.style.borderColor = "#f44336";
        botonClickeado.style.opacity = "1";
        
        feedback.innerText = "❌ " + explicacion;
        feedback.style.color = "#f44336";
        
        if ("vibrate" in navigator) navigator.vibrate(2000); 
    }
    
    document.getElementById('trivia-next').style.display = 'block';
}

function nextTrivia() {
  currentTriviaIndex++;
  loadTrivia();
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
