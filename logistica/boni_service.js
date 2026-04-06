/**
 * BONI SERVICE — Integración con Google Gemini (1.5 Flash)
 * Proporcionado por: Mario
 * API Key: AIzaSyCaj4vySysPHhQoS6oEbOWC06VAEhF3Mwo
 */

const BONI_API_KEY = "AIzaSyCaj4vySysPHhQoS6oEbOWC06VAEhF3Mwo";
const BONI_MODEL   = "gemini-1.5-flash"; // Optimizado para velocidad y gratis

const Boni = {
  lastRequestTime: 0,
  minIntervalMs: 3500, // Máximo ~20 peticiones/min

  /**
   * Analiza una secuencia de landmarks o un gesto ambiguo
   * @param {string} lenguaje - 'lsv', 'lse', 'asl'
   * @param {string} gestoContexto - Descripción del gesto detectado
   */
  async analizarGesto(lenguaje, gestoContexto) {
    const now = Date.now();
    if (now - this.lastRequestTime < this.minIntervalMs) {
      console.warn("Boni: Límite de velocidad, reintentando...");
      return null;
    }
    this.lastRequestTime = now;

    const prompts = {
      lsv: "Actúa como un experto en Lengua de Señas Venezolana (LSV). El usuario está haciendo un gesto que parece ser: ",
      lse: "Actúa como un experto en Lengua de Señas Española (LSE). El usuario está haciendo un gesto que parece ser: ",
      asl: "Actúa como un experto en American Sign Language (ASL). El usuario está haciendo un gesto que parece ser: ",
    };

    const prompt = `${prompts[lenguaje] || prompts.lsv} "${gestoContexto}". 
    Responde ÚNICAMENTE con la palabra que representa el gesto en mayúsculas. 
    Si no estás seguro, responde con el gesto más probable. 
    Máximo 1 palabra.`;

    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${BONI_MODEL}:generateContent?key=${BONI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      const data = await response.json();
      if (data.candidates && data.candidates[0].content.parts[0].text) {
        return data.candidates[0].content.parts[0].text.trim().toUpperCase();
      }
    } catch (error) {
      console.error("Error en Boni Gemini:", error);
    }
    return null;
  }
};
