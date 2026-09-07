/**
 * AGENDA V2 (autorizado) — FASES 4 y 5: cálculo REAL de días candidatos y de
 * horarios disponibles. Único módulo de Agenda V2 que toca el motor de
 * disponibilidad -- nunca reimplementa nada, reutiliza TAL CUAL:
 *
 * - ventanasLaboralesEspecialista / bloqueosDelDia / restarBloqueos
 *   (lib/especialistas.ts) -- filtro RÁPIDO, sin red, para descartar días no
 *   laborables o completamente bloqueados ANTES de gastar una consulta real
 *   a Nylas (sección "EFICIENCIA / NYLAS" del pedido).
 * - listarHorariosDisponiblesPorServicioConNylas
 *   (lib/disponibilidad-servicio-nylas.ts) -- EL motor real de
 *   disponibilidad (horario + bloqueos + duración del servicio + eventos
 *   reales de Nylas), ya usado por el resto de la plataforma. Se le pasa
 *   `especialistaId` para que resuelva un solo profesional (no manda
 *   `modo prioridad`).
 * - sumarDias (lib/parse-fecha-colombia.ts) -- aritmética de fechas pura,
 *   independiente del Flow Engine.
 * - fechaColombiaDesdeIso (lib/timezone-colombia.ts) -- "hoy" real en
 *   Colombia, nunca calculado a mano.
 *
 * GAP DOCUMENTADO (autorizado, sección "FESTIVOS" del pedido): no existe
 * ninguna fuente real de festivos colombianos en el sistema (ni tabla, ni
 * librería). Un festivo entre semana HOY solo queda cubierto si:
 *   (a) el negocio ya registró ese día como bloqueo general en
 *       dulabs_bloqueos (especialista_id NULL, mecanismo YA existente,
 *       reutilizado tal cual acá vía bloqueosDelDia), o
 *   (b) por coincidencia no hay ningún hueco real libre en Nylas ese día.
 * Si ninguna de las dos aplica, un festivo real podría ofrecerse como
 * candidato -- esto NO se corrige inventando una lista de festivos (sección
 * "FESTIVOS" del pedido lo prohíbe explícitamente), queda documentado como
 * limitación conocida.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ventanasLaboralesEspecialista, bloqueosDelDia, restarBloqueos } from "@/lib/especialistas";
import {
  listarHorariosDisponiblesPorServicioConNylas,
  type DepsDisponibilidadNylas,
} from "@/lib/disponibilidad-servicio-nylas";
import { sumarDias } from "@/lib/parse-fecha-colombia";
import { fechaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { construirOpcionesFecha, type OpcionFechaAgendaV2 } from "@/lib/agenda-v2/fechas";

/** Máximo de fechas candidatas a ofrecer (sección FASE 4, punto 7 del pedido). */
export const MAX_DIAS_CANDIDATOS = 4;
/**
 * Horizonte máximo de días a EVALUAR buscando esos 4 candidatos (sección
 * "EFICIENCIA / NYLAS": "no evalúes indefinidamente"). 14 días (2 semanas)
 * es un tope defensivo razonable -- ninguna profesional real de AMORE tiene
 * huecos tan escasos hoy, pero el límite existe para que, si algún día lo
 * estuviera, esto nunca entre en un loop largo ni dispare decenas de
 * llamadas a Nylas en un solo mensaje de WhatsApp.
 */
export const HORIZONTE_DIAS_A_EVALUAR = 14;

export interface DepsDiasCandidatos {
  ventanasLaboralesEspecialista: typeof ventanasLaboralesEspecialista;
  bloqueosDelDia: typeof bloqueosDelDia;
  restarBloqueos: typeof restarBloqueos;
  listarHorariosDisponiblesPorServicioConNylas: typeof listarHorariosDisponiblesPorServicioConNylas;
  sumarDias: typeof sumarDias;
  /** Inyectable para tests deterministas -- default real: hoy en Colombia. */
  hoyIso: () => string;
}

export type ResultadoDiasCandidatos =
  | { ok: true; opciones: OpcionFechaAgendaV2[] }
  | { ok: false; motivo: "servicio_no_encontrado" | "sin_especialistas_habilitados" };

/**
 * Calcula hasta MAX_DIAS_CANDIDATOS fechas reales, evaluando desde MAÑANA
 * (nunca el mismo día -- necesita margen real para agendar) y avanzando día
 * por día hasta HORIZONTE_DIAS_A_EVALUAR. Cada día candidato debe:
 *   1. Tener alguna ventana laboral real ese día de la semana (si no
 *      trabaja, ej. domingo, se descarta SIN tocar Nylas).
 *   2. Sobrevivir a los bloqueos reales de ese día (propios o generales del
 *      salón) -- si quedan sin ninguna ventana libre, se descarta SIN tocar
 *      Nylas.
 *   3. Tener AL MENOS un horario real libre según el motor de disponibilidad
 *      + Nylas (listarHorariosDisponiblesPorServicioConNylas) -- la ÚNICA
 *      llamada cara (red) de todo el cálculo, y solo se hace para los días
 *      que ya sobrevivieron los dos filtros anteriores.
 *
 * `nylasDeps === null` significa que este tenant no tiene grant_id/API key
 * de Nylas configurados (mismo criterio de "sin conexión con el calendario"
 * ya usado en lib/flow/executors/internal-action-executor.ts) -- nunca se
 * ofrece un día "a ciegas" sin poder confirmarlo contra el calendario real,
 * así que se devuelve la lista vacía (el caller lo trata igual que "sin
 * días disponibles", nunca como un error).
 */
export async function calcularDiasCandidatosReales(
  supabase: SupabaseClient,
  params: { idTenant: string; servicioId: string; profesionalId: number },
  nylasDeps: DepsDisponibilidadNylas | null,
  deps: Partial<DepsDiasCandidatos> = {},
): Promise<ResultadoDiasCandidatos> {
  if (!nylasDeps) {
    return { ok: true, opciones: [] };
  }

  const _ventanasLaborales = deps.ventanasLaboralesEspecialista ?? ventanasLaboralesEspecialista;
  const _bloqueosDelDia = deps.bloqueosDelDia ?? bloqueosDelDia;
  const _restarBloqueos = deps.restarBloqueos ?? restarBloqueos;
  const _listarHorarios = deps.listarHorariosDisponiblesPorServicioConNylas ?? listarHorariosDisponiblesPorServicioConNylas;
  const _sumarDias = deps.sumarDias ?? sumarDias;
  const _hoyIso = deps.hoyIso ?? (() => fechaColombiaDesdeIso(new Date().toISOString()));

  const hoy = _hoyIso();
  const fechasCandidatas: string[] = [];

  for (let offset = 1; offset <= HORIZONTE_DIAS_A_EVALUAR && fechasCandidatas.length < MAX_DIAS_CANDIDATOS; offset++) {
    const fechaIso = _sumarDias(hoy, offset);

    const ventanasBase = await _ventanasLaborales(supabase, params.profesionalId, params.idTenant, fechaIso);
    if (ventanasBase.length === 0) continue; // no trabaja ese día de la semana

    const bloqueos = await _bloqueosDelDia(supabase, params.profesionalId, params.idTenant, fechaIso);
    const ventanas = _restarBloqueos(ventanasBase, bloqueos);
    if (ventanas.length === 0) continue; // bloqueado por completo ese día (propio o del salón)

    const resultado = await _listarHorarios(
      supabase,
      { idTenant: params.idTenant, servicioId: params.servicioId, fecha: fechaIso, especialistaId: params.profesionalId },
      nylasDeps,
    );
    if (!resultado.ok) {
      // servicio_no_encontrado / sin_especialistas_habilitados -- afecta a
      // CUALQUIER día por igual, nunca tiene sentido seguir probando los
      // siguientes. Se propaga tal cual para que el caller decida.
      return { ok: false, motivo: resultado.motivo };
    }
    const especialista = resultado.especialistas.find((e) => e.especialistaId === params.profesionalId);
    if (!especialista || especialista.estado !== "ok" || especialista.horarios.length === 0) continue; // sin hueco real ese día (agenda llena, o Nylas no pudo confirmar)

    fechasCandidatas.push(fechaIso);
  }

  return { ok: true, opciones: construirOpcionesFecha(fechasCandidatas) };
}

export type ResultadoHorariosFecha =
  | { ok: true; horarios: string[] }
  | { ok: false; motivo: "servicio_no_encontrado" | "sin_especialistas_habilitados" | "sin_horarios_ese_dia" };

/**
 * UNA sola consulta real (sección "EFICIENCIA / NYLAS": "para horas, una
 * sola consulta de disponibilidad para la fecha seleccionada") -- reutiliza
 * el MISMO motor que calcularDiasCandidatosReales, ya con la fecha decidida.
 */
export async function calcularHorariosParaFecha(
  supabase: SupabaseClient,
  params: { idTenant: string; servicioId: string; profesionalId: number; fechaIso: string },
  nylasDeps: DepsDisponibilidadNylas | null,
  deps: Partial<Pick<DepsDiasCandidatos, "listarHorariosDisponiblesPorServicioConNylas">> = {},
): Promise<ResultadoHorariosFecha> {
  if (!nylasDeps) {
    return { ok: false, motivo: "sin_horarios_ese_dia" };
  }
  const _listarHorarios = deps.listarHorariosDisponiblesPorServicioConNylas ?? listarHorariosDisponiblesPorServicioConNylas;

  const resultado = await _listarHorarios(
    supabase,
    { idTenant: params.idTenant, servicioId: params.servicioId, fecha: params.fechaIso, especialistaId: params.profesionalId },
    nylasDeps,
  );
  if (!resultado.ok) return { ok: false, motivo: resultado.motivo };

  const especialista = resultado.especialistas.find((e) => e.especialistaId === params.profesionalId);
  if (!especialista || especialista.estado !== "ok" || especialista.horarios.length === 0) {
    return { ok: false, motivo: "sin_horarios_ese_dia" };
  }
  return { ok: true, horarios: especialista.horarios };
}
