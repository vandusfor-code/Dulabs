/**
 * NORMALIZADOR ÚNICO del lenguaje del cliente (Bloque 28).
 *
 * Una sola forma de "limpiar" lo que escribe una persona antes de que el BACKEND lo lea:
 *   minúsculas · sin tildes · sin emojis ni signos · letras repetidas colapsadas ("holaaa" -> "hola")
 *   · errores y abreviaciones frecuentes corregidos con el diccionario DECLARATIVO de lexico.ts.
 *
 * No interpreta nada: solo deja el texto comparable. Qué significa lo decide interpretar.ts (reglas
 * del backend) o, para el lenguaje libre, el modelo. Nunca se usa para escribir datos del cliente
 * (nombre, dirección): esos se guardan tal como los escribió.
 */
import { CORRECCIONES_FRASE, CORRECCIONES_PALABRA } from "@/lib/agente/lenguaje/lexico";

/** Minúsculas, sin tildes, sin emojis ni signos (quedan letras, números y espacios). Sin corregir nada. */
export function plano(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "holaaa" -> "hola", "siiii" -> "si", "quierooo" -> "quiero" (3+ letras iguales seguidas => 1). Las dobles ("llevo", "carro") se respetan. */
function colapsar(palabra: string): string {
  return palabra.replace(/(\p{L})\1{2,}/gu, "$1");
}

/**
 * Texto normalizado y corregido, listo para comparar con el léxico:
 *   "Kiero el PEDIDOOO!! 😍" -> "quiero el pedido";  "por mallor" -> "por mayor";  "domisilio" -> "domicilio".
 */
export function normalizar(text: string): string {
  const palabras = plano(text)
    .split(" ")
    .filter(Boolean)
    .map((p) => {
      const c = colapsar(p);
      return CORRECCIONES_PALABRA[c] ?? c;
    });
  let t = ` ${palabras.join(" ")} `;
  for (const [mal, bien] of CORRECCIONES_FRASE) t = t.split(` ${mal} `).join(` ${bien} `);
  return t.replace(/\s+/g, " ").trim();
}

/** Palabras normalizadas. */
export function palabras(text: string): string[] {
  const t = normalizar(text);
  return t ? t.split(" ") : [];
}

/** ¿El texto normalizado contiene la frase (palabras completas)? */
export function contieneFrase(textoNormalizado: string, frase: string): boolean {
  return ` ${textoNormalizado} `.includes(` ${frase} `);
}
