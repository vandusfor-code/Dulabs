/**
 * AGENDA V2 (autorizado) — FASE 3: selección de profesional. Lógica propia,
 * en el mismo estilo que lib/agenda-v2/servicios.ts y categorias.ts --
 * deliberadamente independiente de lib/bot-escenarios/agendamiento-guiado.ts.
 *
 * Reutiliza `resolverEspecialistasElegiblesParaServicio`
 * (lib/asignacion-categoria.ts) -- el ÚNICO resolver real de "quién puede
 * atender este servicio", ya usado por el endpoint de listado de Daniela y
 * por el motor de disponibilidad/reserva. Verificado contra los datos reales
 * de AMORE antes de escribir este archivo: los 28 servicios activos tienen
 * asociación EXPLÍCITA en dulabs_servicio_especialista (modo "explicita" en
 * el 100% de los casos) -- nunca cae al fallback por categoría de Daniela
 * (AMORE no tiene fila en dulabs_config_bot, así que ese fallback siempre
 * devuelve null para este tenant). Este archivo NO reimplementa ninguna
 * regla de elegibilidad, solo adapta `EspecialistaElegible[]` al mismo
 * patrón numerado que ya usan categorias.ts/servicios.ts.
 */
import type { EspecialistaElegible } from "@/lib/asignacion-categoria";

export interface OpcionProfesionalAgendaV2 {
  numero: number;
  profesionalId: number;
  nombre: string;
}

/** Enumera EXACTAMENTE los especialistas elegibles ya resueltos (orden ya decidido por resolverEspecialistasElegiblesParaServicio) -- nunca inventa, nunca reordena por su cuenta. */
export function construirOpcionesProfesional(especialistas: EspecialistaElegible[]): OpcionProfesionalAgendaV2[] {
  return especialistas.map((e, i) => ({ numero: i + 1, profesionalId: e.especialistaId, nombre: e.nombre }));
}

function listaOpciones(opciones: OpcionProfesionalAgendaV2[]): string {
  return opciones.map((o) => `${o.numero}. ${o.nombre}`).join("\n");
}

export function renderizarMenuProfesional(opciones: OpcionProfesionalAgendaV2[]): string {
  return `Perfecto 💗 ¿Con quién deseas realizarte el servicio?\n\n${listaOpciones(opciones)}`;
}

export function textoSeleccionInvalidaProfesional(opciones: OpcionProfesionalAgendaV2[]): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpciones(opciones)}`;
}

/**
 * Resuelve la respuesta del cliente CONTRA las opciones realmente
 * mostradas (guardadas en la sesión) -- mismo criterio EXACTO que
 * resolverSeleccionServicio/resolverSeleccionCategoria: nunca
 * parseInt(text.replace(...)), nunca fuzzy matching, nunca busca por nombre
 * ambiguo. Solo número exacto es válido.
 */
export function resolverSeleccionProfesional(mensaje: string, opciones: OpcionProfesionalAgendaV2[]): OpcionProfesionalAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}

/** Discrimina la forma de un elemento de `opcionesMostradas` -- una opción de profesional siempre tiene `profesionalId` (nunca `servicioId` ni `categoria`). */
export function esOpcionProfesional(opcion: unknown): opcion is OpcionProfesionalAgendaV2 {
  return typeof opcion === "object" && opcion !== null && "profesionalId" in opcion;
}
