// DuLabs Business — Agent Compiler, R7 — fecha solicitada por el cliente.
//
// PROBLEMA REAL: el prompt de la IA NO incluye la fecha actual, así que cuando el
// cliente dice "mañana" o "el sábado" el modelo proponía una `fecha` YYYY-MM-DD
// adivinada (típicamente del año equivocado). La fecha es un dato del BACKEND, igual
// que el horario o la disponibilidad: este módulo (PURO) la resuelve de forma
// determinista desde lo que ESCRIBIÓ el cliente, anclada a "hoy" en Colombia,
// reutilizando el parser existente (lib/parse-fecha-colombia.ts).
//
// Regla de autoridad:
//   1. Si el texto del cliente contiene una fecha resoluble ("mañana", "el sábado",
//      "4 de septiembre") => MANDA el texto (el backend), no la propuesta de la IA.
//   2. Si el texto dice una fecha que ya pasó => se rechaza (nunca se "corrige" a otra).
//   3. Si el texto no trae una fecha reconocible pero SÍ habla de una fecha ("el próximo jueves", "dentro de 2 semanas"),
//      se acepta la propuesta de la IA SOLO si es una fecha YYYY-MM-DD real, no pasada, y coherente con el día de la semana
//      que nombró el cliente. Un texto que no habla de ninguna fecha ("cuéntame un chiste") NO autoriza a la IA a elegir una.
//   4. Si nada de eso => sin fecha (fail-closed).

import { parseFechaColombia } from "@/lib/parse-fecha-colombia";

export type FechaSolicitadaResultado =
  | { ok: true; fecha: string; origen: "texto" | "propuesta" }
  | { ok: false; motivo: "fecha_pasada" | "fecha_invalida" };

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ¿El texto habla de una fecha? (dígitos, hoy/mañana, día de la semana, mes, semana...). Sin tildes y en minúsculas. */
const HABLA_DE_FECHA = /\d|\bhoy\b|manana|pasado|semana|proxim|siguiente|\bdia|lunes|martes|miercoles|jueves|viernes|sabado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|finde/;
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

function sinTildes(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** YYYY-MM-DD válida del calendario (rechaza 2026-02-31). */
function esFechaIsoReal(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function resolverFechaSolicitada(input: {
  /** Lo que escribió el cliente al preguntarle el día (variable del flow), p. ej. "mañana". */
  solicitudTexto?: string;
  /** `fecha` que propuso la IA (NO confiable: no conoce la fecha actual). */
  fechaPropuesta?: string;
  /** Hoy en Colombia (YYYY-MM-DD). Se inyecta para poder probarlo. */
  hoyISO: string;
}): FechaSolicitadaResultado {
  // "el 15 de marzo" / "para el 15 de marzo" / "el día 15 de marzo": el parser espera "15 de marzo".
  const texto = input.solicitudTexto?.trim().replace(/^(?:para\s+)?(?:el\s+)?(?:d[ií]a\s+)?(?=\d)/i, "");
  if (texto) {
    const r = parseFechaColombia(texto, input.hoyISO);
    if (r.ok) return { ok: true, fecha: r.fecha, origen: "texto" };
    // El cliente pidió explícitamente una fecha que ya pasó: no se sustituye por otra.
    if (r.kind === "past") return { ok: false, motivo: "fecha_pasada" };
  }
  const propuesta = input.fechaPropuesta?.trim();
  if (propuesta && esFechaIsoReal(propuesta)) {
    if (propuesta < input.hoyISO) return { ok: false, motivo: "fecha_pasada" };
    const dicho = sinTildes(input.solicitudTexto ?? "");
    if (dicho.trim()) {
      // El cliente contestó, pero no habló de ninguna fecha: la IA no puede elegirla por él.
      if (!HABLA_DE_FECHA.test(dicho)) return { ok: false, motivo: "fecha_invalida" };
      // Si nombró UN día de la semana, la propuesta debe caer en ese día.
      const nombrados = DIAS_SEMANA.filter((d) => new RegExp("\\b" + d + "\\b").test(dicho));
      if (nombrados.length === 1 && DIAS_SEMANA[new Date(propuesta + "T12:00:00Z").getUTCDay()] !== nombrados[0]) return { ok: false, motivo: "fecha_invalida" };
    }
    return { ok: true, fecha: propuesta, origen: "propuesta" };
  }
  return { ok: false, motivo: "fecha_invalida" };
}
