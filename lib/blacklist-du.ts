// Lista negra de DuLabs (autorizado) -- lógica pura, sin efectos secundarios,
// para que el bloqueo temprano en app/webhook-dulabs/route.ts sea testeable
// sin tocar Supabase/Gemini/WhatsApp reales. Reutiliza el campo YA EXISTENTE
// `ia_numeros_bloqueados` de dulabs_clientes_config (columna text, dígitos
// separados por comas) -- NO se crea ninguna tabla ni estructura nueva.
//
// La regla de normalización de un solo valor reutiliza normalizarTelefono()
// de lib/marketplace-store.ts (misma inferencia ya usada en el resto del
// proyecto: 10 dígitos que empiezan en "3" -> se asume móvil colombiano y se
// antepone "57"). Este módulo solo agrega lo que faltaba: separar campos con
// varios teléfonos (export de contactos) y la validación/comparación.
import { normalizarTelefono } from "@/lib/marketplace-store";

// Separadores reales observados en exports de contactos (Google Contacts usa
// " ::: " cuando un campo tiene varios números). ";" y "/" se incluyen como
// variantes razonables de otros exportadores -- nunca la coma ni el espacio
// solos, porque un teléfono legítimo puede contener espacios ("318 123 4567").
const SEPARADORES_MULTIVALOR = /\s*:::\s*|\s*;\s*|\s*\/\s*/;

/**
 * Verdadero si `digitos` (ya solo-dígitos, con o sin indicativo) tiene forma
 * de teléfono real y no es basura obvia (fragmento de un contacto corrupto,
 * dígito repetido, etc.). Nunca intenta adivinar un indicativo ambiguo -- si
 * no se puede determinar el número completo con certeza, se descarta.
 */
function formaValida(digitos: string): boolean {
  if (digitos.length < 10 || digitos.length > 13) return false;
  if (/^(\d)\1+$/.test(digitos)) return false; // "1111111111", etc.
  return true;
}

export type ResultadoNormalizacion = {
  validos: string[];
  invalidos: string[];
};

/**
 * Normaliza UN campo crudo (puede traer varios teléfonos separados) a una
 * lista de números en formato canónico (solo dígitos, con indicativo de
 * país). No elimina ni adivina de más: un valor que después de normalizar no
 * tiene forma de teléfono real queda en `invalidos`, nunca se fuerza a
 * "válido" ni se descarta en silencio.
 */
export function normalizarCampoTelefonos(campoCrudo: string): ResultadoNormalizacion {
  const partes = campoCrudo.split(SEPARADORES_MULTIVALOR).map((p) => p.trim()).filter(Boolean);
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const parte of partes) {
    const normalizado = normalizarTelefono(parte);
    if (normalizado && formaValida(normalizado)) {
      validos.push(normalizado);
    } else {
      invalidos.push(parte);
    }
  }
  return { validos, invalidos };
}

/**
 * Parsea el valor actual de `ia_numeros_bloqueados` (string separado por
 * comas, puede venir null/vacío) a un Set para lookup O(1) -- antes era
 * `.split(",").includes(...)`, O(n) en cada mensaje. Con ~4.400 números el
 * costo real de cualquiera de las dos formas es insignificante (microsegundos),
 * pero Set es la forma correcta de todos modos.
 */
export function parsearListaNegra(iaNumerosBloqueados: string | null | undefined): Set<string> {
  if (!iaNumerosBloqueados) return new Set();
  return new Set(
    iaNumerosBloqueados
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  );
}

/**
 * Regla determinística de bloqueo -- la ÚNICA función que debe llamarse
 * desde el webhook antes de cualquier acción de Du (IA, WhatsApp, leads).
 * Pura: mismo input, mismo output, sin red, sin Supabase, sin Gemini. No
 * depende del prompt, del Brain ni de ninguna interpretación del modelo --
 * es una comparación de strings, nada más.
 */
export function esTelefonoBloqueado(
  iaNumerosBloqueados: string | null | undefined,
  telefonoRemitente: string,
): boolean {
  if (!telefonoRemitente) return false;
  return parsearListaNegra(iaNumerosBloqueados).has(telefonoRemitente);
}

/**
 * Une la lista negra actual con números nuevos ya normalizados, sin duplicar
 * y SIN ELIMINAR nada de lo existente -- unión pura, nunca reemplazo. Usada
 * por scripts/importar-blacklist-du.mts. Devuelve también cuántos de los
 * `nuevos` ya estaban presentes, para el reporte de la importación.
 */
export function unirListaNegra(
  actual: string | null | undefined,
  nuevos: string[],
): { resultado: string; agregados: number; yaExistian: number } {
  const set = parsearListaNegra(actual);
  let agregados = 0;
  let yaExistian = 0;
  for (const n of nuevos) {
    if (set.has(n)) {
      yaExistian++;
    } else {
      set.add(n);
      agregados++;
    }
  }
  return { resultado: Array.from(set).join(","), agregados, yaExistian };
}
