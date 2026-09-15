/**
 * AGENDA V2 (autorizado) — normalización CENTRALIZADA de una respuesta
 * numérica de menú. Corrección real de producción: una clienta respondía
 * "4." (con punto) a un menú de profesionales/horarios y el sistema no lo
 * reconocía, porque cada resolver de Agenda V2 exigía coincidencia EXACTA
 * con `/^\d+$/` (solo dígitos, nada más). TODO el motor de opciones
 * (categorías, servicios, profesionales, fechas, horas, confirmación,
 * gestión de citas) pasa ahora por esta ÚNICA función para reconocer un
 * número de opción -- nunca hay una segunda implementación de "qué cuenta
 * como el número 4" en ningún otro archivo de Agenda V2.
 *
 * Formatos reales aceptados: "4", "4.", "4)", " 4 ", "opción 4",
 * "opcion 4", "la 4". Deliberadamente NO interpreta un número dentro de
 * una frase más larga sin uno de estos prefijos/sufijos reconocidos (ej.
 * "Tengo disponibilidad a las 4." NUNCA se convierte en la opción 4) --
 * tras quitar como máximo un prefijo y el/los sufijo(s) de puntuación,
 * TODO lo que quede debe ser el número y nada más.
 */

const PREFIJOS_RECONOCIDOS: RegExp[] = [/^opci[oó]n\s+/, /^numero\s+/, /^n[uú]mero\s+/, /^la\s+/, /^el\s+/];
const SUFIJOS_PUNTUACION = /[.)\],]+$/;

export function normalizarNumeroDeOpcion(mensaje: string): number | null {
  let texto = mensaje.trim().toLowerCase();
  if (!texto) return null;

  for (const prefijo of PREFIJOS_RECONOCIDOS) {
    if (prefijo.test(texto)) {
      texto = texto.replace(prefijo, "").trim();
      break; // como máximo un prefijo -- nunca en cadena ("la opción 4" no calza a propósito)
    }
  }

  texto = texto.replace(SUFIJOS_PUNTUACION, "").trim();

  if (!/^\d+$/.test(texto)) return null;
  return Number(texto);
}
