/**
 * MANO APP — Traductor Texto → Señas (letras/)
 * Lógica basada en el código del usuario, adaptada al diseño de la app.
 * Muestra cada letra usando las imágenes en la carpeta letras/.
 */

const LETRAS_PATH = 'letras/';
const PAUSA_MS    = 1200;   // milisegundos entre letras (igual al código original)

/* ══════════════════════════════════
   HELPERS
══════════════════════════════════ */
const pausa = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function normalizarTexto(texto) {
  // Minúsculas y sin tildes — igual que el código de referencia
  return texto.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/* ══════════════════════════════════
   FUNCIÓN PRINCIPAL — TRADUCIR
   (activada al pulsar el botón ▶)
══════════════════════════════════ */
async function traducirTexto() {
  const inputEl  = document.getElementById('trn-input');
  const pantalla = document.getElementById('trn-pantalla');
  const letraEl  = document.getElementById('trn-sign-letter');
  const playBtn  = document.getElementById('trn-play');
  const playIcon = document.getElementById('trn-play-icon');

  if (!inputEl || !pantalla) return;

  const texto = normalizarTexto(inputEl.value);
  if (texto.trim() === '') return;

  // Bloquear botón durante la traducción
  if (playBtn) { playBtn.classList.add('playing'); playBtn.disabled = true; }
  if (playIcon) playIcon.textContent = '⏸';

  // Recorrer letra a letra
  for (let i = 0; i < texto.length; i++) {
    const letra = texto[i];

    if (letra >= 'a' && letra <= 'z') {
      // Mostrar imagen de la letra con animación
      await mostrarLetra(pantalla, letraEl, `${LETRAS_PATH}${letra}.jpg`, letra.toUpperCase());
    } else if (letra === ' ') {
      await mostrarLetra(pantalla, letraEl, `${LETRAS_PATH}espacio.jpg`, '·');
    } else {
      continue; // Ignorar números y símbolos
    }

    await pausa(PAUSA_MS);
  }

  // Restaurar estado final
  setImagen(pantalla, `${LETRAS_PATH}espacio.jpg`, false);
  if (letraEl) letraEl.textContent = '';
  if (playBtn)  { playBtn.classList.remove('playing'); playBtn.disabled = false; }
  if (playIcon) playIcon.textContent = '▶';
}

/* ── Mostrar imagen con animación de entrada ── */
async function mostrarLetra(img, letraEl, src, textoLetra) {
  // Fade out
  img.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
  img.style.opacity    = '0';
  img.style.transform  = 'scale(0.88)';

  await pausa(150);

  setImagen(img, src, true);
  if (letraEl) letraEl.textContent = textoLetra;

  // Fade in
  img.style.transition = 'opacity 0.25s ease, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)';
  img.style.opacity    = '1';
  img.style.transform  = 'scale(1)';
}

function setImagen(img, src, animIn) {
  img.src = src;
  if (!animIn) {
    img.style.opacity   = '1';
    img.style.transform = 'scale(1)';
  }
}

/* ══════════════════════════════════
   CONTROLES DE VELOCIDAD
══════════════════════════════════ */
function trnChangeSpeed() {
  // La velocidad no afecta el loop async de forma retroactiva,
  // pero se respeta en la próxima traducción si se modifica la variable PAUSA_MS
  // (ya no es necesario parche extra)
}

/* ══════════════════════════════════
   LIMPIAR TEXTO
══════════════════════════════════ */
function clearTrn() {
  const inputEl  = document.getElementById('trn-input');
  const letraEl  = document.getElementById('trn-sign-letter');
  const pantalla = document.getElementById('trn-pantalla');
  const counter  = document.getElementById('trn-charcount');
  if (inputEl)  inputEl.value = '';
  if (letraEl)  letraEl.textContent = '';
  if (counter)  counter.textContent = '0/60';
  if (pantalla) setImagen(pantalla, `${LETRAS_PATH}espacio.jpg`, false);
  updateChipHighlight_dummy();
}

/* ── Stub para onTrnInput ── */
function onTrnInput() {
  const inputEl = document.getElementById('trn-input');
  const counter = document.getElementById('trn-charcount');
  if (counter && inputEl) counter.textContent = `${inputEl.value.length}/60`;
}

function updateChipHighlight_dummy() {} // No se usan chips en este modo

/* ══════════════════════════════════
   INIT — llamado al cambiar de tab
══════════════════════════════════ */
function initTraductor() {
  const pantalla = document.getElementById('trn-pantalla');
  if (pantalla) setImagen(pantalla, `${LETRAS_PATH}espacio.jpg`, false);
}

function stopTranslating() {
  // No hay loop async persistente que detener desde fuera
}

/* ── El botón ▶ dispara traducción directamente ── */
function trnTogglePlay()  { traducirTexto(); }
function trnStepPrev()    { /* no aplica */ }
function trnStepNext()    { /* no aplica */ }
