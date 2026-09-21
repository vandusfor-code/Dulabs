/**
 * Anti-invención — la HORA de una cita la fija el BACKEND a partir de lo que ESCRIBIÓ el cliente; la IA solo ayuda a
 * interpretar el lenguaje ("la segunda", "a las diez") y su propuesta se valida:
 *   1. Hora explícita del cliente ("3 pm", "10 de la mañana", "15:30") -> manda el parser determinista.
 *   2. Propuesta de la IA -> solo vale si (a) es UNO de los horarios que el sistema ofreció (lista real), o (b) sin lista
 *      ofrecida, si los números que escribió el cliente la respaldan. Así el modelo no puede "elegir" una hora que el
 *      cliente no dijo ni una que el sistema no ofreció.
 * Puro.
 */
import { parseHoraColombia } from "@/lib/parse-hora-colombia";

export type HoraResuelta = { ok: true; hora: string; origen: "cliente" | "lista" | "propuesta_validada" } | { ok: false; motivo: "hora_invalida" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const NUMEROS_EN_LETRAS: Record<string, number> = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5,
};

/** "9:00" -> "09:00"; cualquier otra cosa que no sea una hora válida -> "". */
function normalizarHHMM(valor: string | undefined): string {
  const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(valor ?? "");
  if (!m) return "";
  const hhmm = `${m[1]!.padStart(2, "0")}:${m[2]}`;
  return HHMM.test(hhmm) ? hhmm : "";
}

function numerosDelTexto(texto: string): number[] {
  const sinAcentos = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const out: number[] = [];
  for (const d of sinAcentos.match(/\d+/g) ?? []) out.push(Number(d));
  for (const w of sinAcentos.match(/[a-z]+/g) ?? []) if (w in NUMEROS_EN_LETRAS) out.push(NUMEROS_EN_LETRAS[w]!);
  return out;
}

/** ¿El cliente EXPRESÓ una hora ("a las 3", "10:30", "3 pm", "de la tarde")? Una elección por posición ("la segunda") no cuenta. */
const EXPRESA_HORA = /\bla?s?\s+(?:\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b|\d{1,2}:\d{2}|\d\s*(?:a\.?\s?m|p\.?\s?m)\b|\bde la (?:manana|tarde|noche)\b|\ben punto\b/;

/** ¿El cliente eligió algo de la lista (número, posición, "la última", "la más temprano")? */
const ELIGE_HORARIO = /\d|primer|segund|tercer|cuart|quint|sext|septim|octav|ultim|tempran|mediod|cualquier/;

const ORDINALES: Record<string, number> = {
  primera: 1, primero: 1, segunda: 2, segundo: 2, tercera: 3, tercero: 3, cuarta: 4, cuarto: 4, quinta: 5, quinto: 5,
  sexta: 6, sexto: 6, septima: 7, septimo: 7, octava: 8, octavo: 8, novena: 9, noveno: 9, decima: 10, decimo: 10,
};

/**
 * Posición (1-based) que el cliente eligió de la lista numerada, SIN ambigüedad: un ordinal en letras ("la segunda", "la última")
 * o un número con prefijo ("la 2", "opción 2", "número 2"). Un número SUELTO ("2") puede ser posición u hora: no se decide aquí.
 */
function posicionInequivoca(sinAcentos: string, total: number): number | null | "fuera_de_lista" {
  const t = sinAcentos.trim().replace(/[.,!?]+$/, "");
  if (/^(?:la |el )?(?:ultima|ultimo)$/.test(t)) return total;
  const ord = /^(?:la |el )?([a-z]+)$/.exec(t);
  if (ord && ORDINALES[ord[1]!] !== undefined) return ORDINALES[ord[1]!]! <= total ? ORDINALES[ord[1]!]! : "fuera_de_lista";
  const num = /^(?:la |el )?(?:opcion|numero)\s*(\d{1,2})$/.exec(t) ?? /^(?:la|el)\s+(\d{1,2})$/.exec(t);
  if (num) {
    const n = Number(num[1]);
    return n >= 1 && n <= total ? n : "fuera_de_lista";
  }
  return null;
}

export function resolverHoraSolicitada(input: { solicitudTexto?: string; horaPropuesta?: string; horariosOfrecidos?: string[] }): HoraResuelta {
  const texto = (input.solicitudTexto ?? "").trim();
  if (texto) {
    // "3pm" / "10:30am" (sin espacio) es muy común y el parser lo toma por ambiguo.
    const p = parseHoraColombia(texto.replace(/(\d)\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/gi, "$1 $2"));
    if (p.ok) return { ok: true, hora: p.hhmm, origen: "cliente" };
  }

  const sinAcentos = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const ofrecidos = (input.horariosOfrecidos ?? []).map(normalizarHHMM).filter(Boolean);

  // (0) Elección INEQUÍVOCA por posición ("la segunda", "la última", "opción 2"): la hora sale de la lista real, no de lo que
  //     interprete la IA.
  if (ofrecidos.length > 0) {
    const pos = posicionInequivoca(sinAcentos, ofrecidos.length);
    // Eligió una posición que no existe ("la quinta" de 4): no se adivina otra.
    if (pos === "fuera_de_lista") return { ok: false, motivo: "hora_invalida" };
    if (pos !== null) return { ok: true, hora: ofrecidos[pos - 1]!, origen: "lista" };
  }

  const propuesta = normalizarHHMM(input.horaPropuesta);
  if (!propuesta) return { ok: false, motivo: "hora_invalida" };

  const h = Number(propuesta.slice(0, 2));
  const min = Number(propuesta.slice(3));

  // (a) El cliente EXPRESÓ una hora ("a las 3", "10:30", "3 de la tarde"): sus números deben respaldar la propuesta (24h o 12h),
  //     aunque la propuesta esté en la lista (que es solo una muestra, no un límite). Un horario válido pero no listado se
  //     comprueba luego contra el calendario real.
  if (EXPRESA_HORA.test(sinAcentos)) {
    const numeros = numerosDelTexto(texto);
    const horaRespaldada = numeros.includes(h) || numeros.includes(h % 12 === 0 ? 12 : h % 12);
    const minutosRespaldados = min === 0 || numeros.includes(min);
    return horaRespaldada && minutosRespaldados ? { ok: true, hora: propuesta, origen: "propuesta_validada" } : { ok: false, motivo: "hora_invalida" };
  }

  // (b) El cliente ELIGIÓ de la lista sin decir una hora ("2", "la de más temprano"): la propuesta debe ser UNO de los horarios
  //     ofrecidos. Un texto sin ninguna elección ("cuéntame un chiste") no autoriza reservar una hora solo porque la IA la propuso.
  if (ofrecidos.includes(propuesta) && ELIGE_HORARIO.test(sinAcentos)) {
    // Un número SUELTO ("2") es posición u hora: la propuesta debe ser coherente con alguna de las dos lecturas.
    const suelto = /^\d{1,2}$/.exec(sinAcentos.trim());
    if (suelto) {
      const n = Number(suelto[0]);
      const coherente = ofrecidos.indexOf(propuesta) + 1 === n || (h % 12 === 0 ? 12 : h % 12) === n || h === n;
      if (!coherente) return { ok: false, motivo: "hora_invalida" };
    }
    return { ok: true, hora: propuesta, origen: "propuesta_validada" };
  }
  return { ok: false, motivo: "hora_invalida" };
}
