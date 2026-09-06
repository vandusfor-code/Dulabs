/**
 * Segmentación de una respuesta conversacional en 1-4 mensajes reales de
 * WhatsApp (FASE — refinamiento conversacional, autorizado). Genérico,
 * reutilizable por cualquier tenant/canal -- no sabe nada de AMORE ni de
 * Gemini/Claude.
 *
 * NUNCA divide por conteo de caracteres: divide por BLOQUES SEMÁNTICOS
 * reales (líneas en blanco, que el nodo IA usa deliberadamente solo cuando
 * hay más de una idea separable -- ver la instrucción del nodo IA en
 * lib/flows/amore-router.flow.ts). Si el texto no trae ningún bloque así
 * pero es muy largo, agrupa oraciones COMPLETAS en 2-3 bloques balanceados
 * -- nunca corta una oración, un precio o un nombre de servicio a la mitad.
 * Un texto corto NUNCA se divide, sin importar su forma.
 */

/** Por debajo de este largo, la respuesta siempre viaja como un único mensaje. */
const LARGO_MINIMO_PARA_DIVIDIR = 140;
/** Umbral para intentar agrupar oraciones cuando no hay bloques naturales (líneas en blanco). */
const LARGO_MINIMO_PARA_AGRUPAR_ORACIONES = 260;
const MAX_MENSAJES = 4;

/**
 * Divide en oraciones completas -- el punto/exclamación/interrogación debe
 * estar precedido por una letra (nunca un dígito, para no cortar "$60.000")
 * y seguido de espacio + mayúscula/dígito/apertura de interrogación (inicio
 * real de una nueva oración), o el final del texto.
 */
function dividirEnOraciones(texto: string): string[] {
  const partes = texto.split(/(?<=[\p{L}\)"'”])([.!?]+)(?=\s+(?:[\p{Lu}0-9¿¡]|$))/gu);
  const oraciones: string[] = [];
  let actual = "";
  for (const parte of partes) {
    if (/^[.!?]+$/.test(parte)) {
      actual += parte;
      oraciones.push(actual.trim());
      actual = "";
    } else {
      actual += parte;
    }
  }
  if (actual.trim()) oraciones.push(actual.trim());
  return oraciones.filter(Boolean);
}

function agruparOracionesEnBloques(texto: string): string[] {
  const oraciones = dividirEnOraciones(texto);
  if (oraciones.length <= 1) return [texto];

  const totalLen = oraciones.reduce((acc, o) => acc + o.length, 0);
  const objetivoBloques = totalLen > 420 ? 3 : 2;
  const objetivoPorBloque = totalLen / objetivoBloques;

  const bloques: string[] = [];
  let actual: string[] = [];
  let actualLen = 0;
  for (let i = 0; i < oraciones.length; i++) {
    const oracion = oraciones[i]!;
    actual.push(oracion);
    actualLen += oracion.length;
    const esUltimaOracion = i === oraciones.length - 1;
    if (!esUltimaOracion && actualLen >= objetivoPorBloque && bloques.length < objetivoBloques - 1) {
      bloques.push(actual.join(" "));
      actual = [];
      actualLen = 0;
    }
  }
  if (actual.length) bloques.push(actual.join(" "));
  return bloques;
}

/** Funde los 2 bloques adyacentes más pequeños (nunca corta uno a la mitad) hasta caber en MAX_MENSAJES. */
function limitarCantidadDeBloques(bloques: string[]): string[] {
  let resultado = bloques;
  while (resultado.length > MAX_MENSAJES) {
    let mejorIdx = 0;
    let mejorSuma = Infinity;
    for (let i = 0; i < resultado.length - 1; i++) {
      const suma = resultado[i]!.length + resultado[i + 1]!.length;
      if (suma < mejorSuma) {
        mejorSuma = suma;
        mejorIdx = i;
      }
    }
    resultado = [
      ...resultado.slice(0, mejorIdx),
      `${resultado[mejorIdx]}\n\n${resultado[mejorIdx + 1]}`,
      ...resultado.slice(mejorIdx + 2),
    ];
  }
  return resultado;
}

export function segmentarRespuestaWhatsApp(texto: string): string[] {
  const limpio = texto.trim();
  if (!limpio) return [];

  if (limpio.length <= LARGO_MINIMO_PARA_DIVIDIR) return [limpio];

  let bloques = limpio
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (bloques.length === 1 && bloques[0]!.length > LARGO_MINIMO_PARA_AGRUPAR_ORACIONES) {
    bloques = agruparOracionesEnBloques(bloques[0]!);
  }

  if (bloques.length <= 1) return [limpio];

  return limitarCantidadDeBloques(bloques);
}
