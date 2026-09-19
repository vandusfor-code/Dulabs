// DuLabs Business — Agent Compiler, R7 — cancelar y reprogramar citas del cliente (Nylas).
//
// REGLA CENTRAL (misma filosofía que nylas-generic-booking.ts / nylas-availability.ts): la IA NUNCA elige
// ids, ni calcula horarios, ni escribe en el calendario. Este módulo (BACKEND) es la única autoridad:
//   1. La IDENTIDAD es la del canal: solo se ven/tocan las citas de (tenant, teléfono de la conversación).
//   2. La cita elegida sale de la lista que el propio backend generó (payload) y se RE-verifica contra la
//      base (pertenece a esa persona, sigue confirmada, es futura) antes de tocar nada.
//   3. La política del negocio (¿se permite? ¿con cuánta anticipación?) se aplica aquí, no en un prompt.
//   4. El calendario se resuelve por tenant (nunca del payload) y solo se opera sobre eventos del calendario
//      actualmente conectado (si el negocio reconectó otro, se deriva a una persona).
//   5. Cancelar es idempotente; reprogramar usa ejecutarConIdempotencia y revalida horario + conflictos.

import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import type { NylasEvent, NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import type { CalendarConnectionStore } from "@/lib/agent-compiler/calendar/types";
import type { AgentAppointment, AppointmentStore } from "@/lib/agent-compiler/calendar/appointment-store";
import type { BusinessHours } from "@/lib/agent-compiler/spec/types";
import { evaluateBusinessHours } from "@/lib/business-hours";
import { hayConflictoDeHorario } from "@/lib/agent-compiler/calendar/nylas-generic-booking";
import { TIMEZONE_COLOMBIA } from "@/lib/timezone-colombia";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_CITAS_LISTADAS = 10;

export interface PoliticaCitas {
  /** El negocio permite cancelar/reprogramar por WhatsApp. */
  allowed: boolean;
  /** Anticipación mínima (horas) respecto al inicio de la cita ACTUAL. */
  minNoticeHours: number;
}

export type MotivoNoModificable = "no_permitido" | "muy_cerca";

/** ¿Se puede cancelar/mover esta cita según la política del negocio? PURA. */
export function evaluarPoliticaCita(politica: PoliticaCitas, inicioIso: string, nowMs: number): { ok: true } | { ok: false; motivo: MotivoNoModificable } {
  if (!politica.allowed) return { ok: false, motivo: "no_permitido" };
  const horas = Math.max(0, politica.minNoticeHours);
  if (new Date(inicioIso).getTime() - nowMs < horas * 3_600_000) return { ok: false, motivo: "muy_cerca" };
  return { ok: true };
}

/** "sábado 14 de marzo, 3:00 p. m." en hora de Colombia. Determinista (nunca redactado por la IA). */
export function formatearFechaHoraCita(iso: string): string {
  const d = new Date(iso);
  const fecha = new Intl.DateTimeFormat("es-CO", { timeZone: TIMEZONE_COLOMBIA, weekday: "long", day: "numeric", month: "long" }).format(d);
  const hora = new Intl.DateTimeFormat("es-CO", { timeZone: TIMEZONE_COLOMBIA, hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${fecha}, ${hora}`;
}

export interface CitaListada {
  id: string;
  servicio: string | null;
  inicioIso: string;
  finIso: string;
  duracionMin: number;
  modificable: boolean;
  motivoNoModificable?: MotivoNoModificable;
}

const NUMEROS_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

export function formatearCitasTexto(citas: CitaListada[], minNoticeHours: number): string {
  return citas
    .map((c, i) => {
      const base = `${NUMEROS_EMOJI[i] ?? `${i + 1}.`} ${c.servicio ?? "Servicio"} — ${formatearFechaHoraCita(c.inicioIso)}`;
      if (c.modificable) return base;
      return c.motivoNoModificable === "muy_cerca"
        ? `${base} (quedan menos de ${minNoticeHours} h: pide ayuda al equipo)`
        : `${base} (no se puede cambiar por aquí)`;
    })
    .join("\n");
}

function aCitaListada(a: AgentAppointment, politica: PoliticaCitas, nowMs: number): CitaListada {
  const p = evaluarPoliticaCita(politica, a.inicioIso, nowMs);
  return {
    id: a.id,
    servicio: a.servicio,
    inicioIso: a.inicioIso,
    finIso: a.finIso,
    duracionMin: Math.round((new Date(a.finIso).getTime() - new Date(a.inicioIso).getTime()) / 60000),
    modificable: p.ok,
    ...(p.ok ? {} : { motivoNoModificable: p.motivo }),
  };
}

// ---------------------------------------------------------------------------
// Selección (la respuesta del cliente a "¿cuál cita?")
// ---------------------------------------------------------------------------

const ORDINALES: Record<string, number> = { primera: 1, primer: 1, uno: 1, una: 1, segunda: 2, segundo: 2, dos: 2, tercera: 3, tercero: 3, tres: 3, cuarta: 4, cuarto: 4, cuatro: 4, quinta: 5, quinto: 5, cinco: 5 };

/**
 * Convierte la respuesta del cliente en UNA cita de la lista que el backend mostró: número ("2"), ordinal
 * ("la segunda") o, si hay una sola cita, cualquier respuesta afirmativa. Nunca "adivina" entre varias.
 */
export function resolverSeleccionCita<T>(citas: T[], seleccion: string | undefined): { ok: true; cita: T; indice: number } | { ok: false; motivo: "sin_citas" | "seleccion_invalida" } {
  if (citas.length === 0) return { ok: false, motivo: "sin_citas" };
  const texto = (seleccion ?? "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
  // Una respuesta negativa NUNCA selecciona ('no', 'ninguna', 'mejor no'): el cliente no está eligiendo esa cita.
  if (/^(no\b|ninguna|nada\b|mejor no|dejalo|olvidalo)/.test(texto)) return { ok: false, motivo: "seleccion_invalida" };
  if (citas.length === 1 && texto) return { ok: true, cita: citas[0]!, indice: 0 };
  const num = /\b(\d{1,2})\b/.exec(texto);
  let n: number | null = num ? Number(num[1]) : null;
  if (n === null) {
    for (const [palabra, valor] of Object.entries(ORDINALES)) {
      if (new RegExp(`\\b${palabra}\\b`).test(texto)) {
        n = valor;
        break;
      }
    }
  }
  if (n === null || !Number.isInteger(n) || n < 1 || n > citas.length) return { ok: false, motivo: "seleccion_invalida" };
  return { ok: true, cita: citas[n - 1]!, indice: n - 1 };
}

// ---------------------------------------------------------------------------
// Dependencias
// ---------------------------------------------------------------------------

export interface AppointmentsDeps {
  supabase: SupabaseClient;
  calendarStore: CalendarConnectionStore;
  appointmentStore: AppointmentStore;
  /** null = credenciales de Nylas no configuradas -- NUNCA se simula una conexión. */
  nylasApiKey: string | null;
  createNylasEventsClient: (apiKey: string) => NylasEventsClient;
  createNylasEventsWriteClient: (apiKey: string) => NylasEventsWriteClient;
  /** Reloj inyectable (ms). */
  nowMs: number;
}

// ---------------------------------------------------------------------------
// Listar
// ---------------------------------------------------------------------------

export type ResultadoListarCitas =
  | { ok: true; citas: CitaListada[]; texto: string }
  | { ok: false; motivo: "sin_citas" | "error_tecnico" };

export async function listarCitasCliente(
  deps: Pick<AppointmentsDeps, "appointmentStore" | "nowMs">,
  params: { tenantId: string; telefono: string } & PoliticaCitas,
): Promise<ResultadoListarCitas> {
  let filas: AgentAppointment[];
  try {
    filas = await deps.appointmentStore.listUpcoming(params.tenantId, params.telefono, new Date(deps.nowMs).toISOString(), MAX_CITAS_LISTADAS);
  } catch {
    return { ok: false, motivo: "error_tecnico" };
  }
  if (filas.length === 0) return { ok: false, motivo: "sin_citas" };
  const citas = filas.map((f) => aCitaListada(f, params, deps.nowMs));
  return { ok: true, citas, texto: formatearCitasTexto(citas, params.minNoticeHours) };
}

/**
 * Cita elegida por el cliente, RE-verificada contra la base (misma identidad de canal). No aplica política ni toca el
 * calendario: la usa la disponibilidad de reprogramar para tomar la duración REAL de la cita y excluir su evento.
 */
export async function obtenerCitaSeleccionada(
  deps: Pick<AppointmentsDeps, "appointmentStore" | "nowMs">,
  params: { tenantId: string; telefono: string; citasMostradas: Array<{ id: string }>; seleccion: string | undefined },
): Promise<{ ok: true; cita: AgentAppointment } | { ok: false; motivo: "seleccion_invalida" | "sin_citas" | "cita_no_encontrada" | "error_tecnico"; detalle: string }> {
  const sel = resolverSeleccionCita(params.citasMostradas, params.seleccion);
  if (!sel.ok) return { ok: false, motivo: sel.motivo, detalle: sel.motivo === "sin_citas" ? "No hay citas para gestionar." : "No pude identificar cuál cita quieres." };
  let vigentes: AgentAppointment[];
  try {
    vigentes = await deps.appointmentStore.listUpcoming(params.tenantId, params.telefono, new Date(deps.nowMs).toISOString(), MAX_CITAS_LISTADAS);
  } catch {
    return { ok: false, motivo: "error_tecnico", detalle: "No se pudieron consultar tus citas en este momento." };
  }
  const cita = vigentes.find((v) => v.id === sel.cita.id);
  if (!cita) return { ok: false, motivo: "cita_no_encontrada", detalle: "Esa cita ya no está disponible para modificar." };
  return { ok: true, cita };
}

// ---------------------------------------------------------------------------
// Resolución común: cita elegida -> fila real re-verificada + calendario del tenant
// ---------------------------------------------------------------------------

type MotivoOperacion =
  | "seleccion_invalida"
  | "sin_citas"
  | "no_permitido"
  | "muy_cerca"
  | "cita_no_encontrada"
  | "calendario_no_conectado"
  | "calendario_distinto"
  | "proveedor_no_disponible"
  | "error_tecnico";

interface ContextoOperacion {
  cita: AgentAppointment;
  grantId: string;
  calendarId: string;
  apiKey: string;
}

async function resolverContexto(
  deps: AppointmentsDeps,
  params: { tenantId: string; telefono: string; citasMostradas: Array<{ id: string }>; seleccion: string | undefined } & PoliticaCitas,
): Promise<{ ok: true; ctx: ContextoOperacion } | { ok: false; motivo: MotivoOperacion; detalle: string }> {
  // 1-2) La elección sale de la lista que el backend mostró y se RE-verifica contra la base (misma identidad de canal).
  const elegida = await obtenerCitaSeleccionada(deps, params);
  if (!elegida.ok) return elegida;
  const cita = elegida.cita;

  // 3) Política del negocio.
  const politica = evaluarPoliticaCita(params, cita.inicioIso, deps.nowMs);
  if (!politica.ok) {
    return {
      ok: false,
      motivo: politica.motivo,
      detalle: politica.motivo === "no_permitido" ? "El negocio no permite modificar citas por este canal." : `Solo se puede modificar con más de ${params.minNoticeHours} horas de anticipación.`,
    };
  }

  // 4) Calendario del tenant (nunca del payload) y coherencia con el evento.
  const conn = await deps.calendarStore.getConnection(params.tenantId);
  if (!conn || conn.status !== "connected" || !conn.grantId || !conn.selectedCalendarId) {
    return { ok: false, motivo: "calendario_no_conectado", detalle: "No hay un calendario conectado para este negocio." };
  }
  if (!deps.nylasApiKey) return { ok: false, motivo: "proveedor_no_disponible", detalle: "La integración de calendario no está disponible en este momento." };
  if (conn.selectedCalendarId !== cita.calendarId) {
    return { ok: false, motivo: "calendario_distinto", detalle: "Esta cita está en un calendario que ya no está conectado." };
  }
  return { ok: true, ctx: { cita, grantId: conn.grantId, calendarId: conn.selectedCalendarId, apiKey: deps.nylasApiKey } };
}

function esNoEncontradoNylas(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 404 || status === 410;
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

export type ResultadoCancelarCita =
  | { ok: true; citaId: string; servicio: string | null; inicioIso: string; yaCancelada: boolean }
  | { ok: false; motivo: MotivoOperacion; detalle: string };

export async function cancelarCitaCliente(
  deps: AppointmentsDeps,
  params: { tenantId: string; telefono: string; citasMostradas: Array<{ id: string }>; seleccion: string | undefined } & PoliticaCitas,
  signal?: AbortSignal,
): Promise<ResultadoCancelarCita> {
  const r = await resolverContexto(deps, params);
  if (!r.ok) return r;
  const { cita, grantId, calendarId, apiKey } = r.ctx;

  // Cancelar en el calendario REAL. Un evento que ya no existe (404/410) cuenta como cancelado (idempotente).
  try {
    await deps.createNylasEventsWriteClient(apiKey).deleteEvent({ grantId, calendarId, eventId: cita.eventId }, signal);
  } catch (err) {
    if (!esNoEncontradoNylas(err)) return { ok: false, motivo: "error_tecnico", detalle: "No se pudo cancelar la cita en el calendario en este momento." };
  }
  let outcome;
  try {
    outcome = await deps.appointmentStore.markCancelled(params.tenantId, params.telefono, cita.id, new Date(deps.nowMs).toISOString());
  } catch {
    // El evento YA se borró del calendario (la fuente de verdad): no se reporta como fallo al cliente.
    outcome = "cancelada" as const;
  }
  if (outcome === "no_encontrada") return { ok: false, motivo: "cita_no_encontrada", detalle: "La cita ya no está disponible." };
  return { ok: true, citaId: cita.id, servicio: cita.servicio, inicioIso: cita.inicioIso, yaCancelada: outcome === "ya_cancelada" };
}

// ---------------------------------------------------------------------------
// Reprogramar
// ---------------------------------------------------------------------------

export type ReprogramarMotivo = MotivoOperacion | "fecha_invalida" | "fuera_de_horario" | "ocupado" | "muy_pronto" | "mismo_horario" | "en_progreso" | "conflicto_reintento" | "sin_soporte";

export type ResultadoReprogramarCita =
  | { ok: true; citaId: string; servicio: string | null; inicioIso: string; finIso: string }
  | { ok: false; motivo: ReprogramarMotivo; detalle: string };

function parseFechaHora(fecha: string, hora: string): Date | null {
  const d = new Date(`${fecha}T${hora}:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function reprogramarCitaCliente(
  deps: AppointmentsDeps,
  params: {
    tenantId: string;
    telefono: string;
    executionRowId: string;
    effectId: string;
    citasMostradas: Array<{ id: string }>;
    seleccion: string | undefined;
    /** YYYY-MM-DD resuelta por el backend desde lo que dijo el cliente. */
    fecha: string;
    /** HH:MM 24h. */
    hora: string;
    businessHours?: BusinessHours | null;
    /** Antelación mínima (minutos) del NUEVO horario respecto a ahora. */
    minNoticeMinutes?: number;
  } & PoliticaCitas,
  signal?: AbortSignal,
): Promise<ResultadoReprogramarCita> {
  const nuevoInicio = parseFechaHora(params.fecha, params.hora);
  if (!nuevoInicio) return { ok: false, motivo: "fecha_invalida", detalle: "Fecha u hora inválida." };
  const startUnix = Math.floor(nuevoInicio.getTime() / 1000);

  // La IDEMPOTENCIA envuelve TODO (identidad, política, validaciones, calendario): un replay del MISMO efecto devuelve
  // el resultado original aunque el estado ya haya cambiado (p. ej. la cita ya está en el nuevo horario). La huella es la
  // de la SOLICITUD (quién, cuál cita, qué horario), no la del estado.
  const idempotencyKey = `cita_nylas_reprogramar:${params.executionRowId}:${params.effectId}`;
  const huella = huellaSolicitud([params.tenantId, params.telefono, params.seleccion ?? "", params.fecha, params.hora]);

  let resultado;
  try {
    resultado = await ejecutarConIdempotencia<ResultadoReprogramarCita>(deps.supabase, {
      idTenant: params.tenantId,
      idempotencyKey,
      huella,
      operacion: async (): Promise<ResultadoReprogramarCita> => {
        const r = await resolverContexto(deps, params);
        if (!r.ok) {
          // Un fallo TÉCNICO no se cachea (se lanza para liberar la reserva de la clave y que el reintento pueda recuperarse).
          if (r.motivo === "error_tecnico") throw new Error("retry");
          return r;
        }
        const { cita, grantId, calendarId, apiKey } = r.ctx;

        // La DURACIÓN es la de la cita registrada (autoridad del backend), nunca la que proponga la IA.
        const duracionMin = Math.round((new Date(cita.finIso).getTime() - new Date(cita.inicioIso).getTime()) / 60000);
        const endUnix = startUnix + duracionMin * 60;

        if (startUnix * 1000 < deps.nowMs + Math.max(0, params.minNoticeMinutes ?? 0) * 60_000) {
          return { ok: false, motivo: "muy_pronto", detalle: "Ese horario ya pasó o no cumple la anticipación mínima." };
        }
        if (Math.abs(startUnix * 1000 - new Date(cita.inicioIso).getTime()) < 1000) {
          return { ok: false, motivo: "mismo_horario", detalle: "Ese ya es el horario de tu cita." };
        }
        const horario = evaluateBusinessHours(params.businessHours, { fecha: params.fecha, hora: params.hora, durationMin: duracionMin });
        if (!horario.ok) {
          return { ok: false, motivo: "fuera_de_horario", detalle: horario.reason === "cerrado" ? "El negocio no atiende ese día." : "Ese horario está fuera del horario de atención del negocio." };
        }

        const writeClient = deps.createNylasEventsWriteClient(apiKey);
        if (!writeClient.updateEventTime) return { ok: false, motivo: "sin_soporte", detalle: "El proveedor de calendario no permite mover eventos." };
        const readClient = deps.createNylasEventsClient(apiKey);

        let existentes: NylasEvent[];
        try {
          existentes = await readClient.listEvents({ grantId, calendarId, startUnix, endUnix }, signal);
        } catch {
          throw new Error("retry");
        }
        // El evento de ESTA cita no cuenta como conflicto (se está moviendo, no duplicando).
        const otros = existentes.filter((e) => e.id !== cita.eventId);
        if (hayConflictoDeHorario(otros, startUnix, endUnix)) return { ok: false, motivo: "ocupado", detalle: "Ese horario ya está ocupado en el calendario." };
        try {
          await writeClient.updateEventTime({ grantId, calendarId, eventId: cita.eventId, startUnix, endUnix, timezone: TIMEZONE_COLOMBIA }, signal);
        } catch {
          throw new Error("retry");
        }

        const inicioIso = new Date(startUnix * 1000).toISOString();
        const finIso = new Date(endUnix * 1000).toISOString();
        try {
          await deps.appointmentStore.markRescheduled(params.tenantId, params.telefono, cita.id, { eventId: cita.eventId, inicioIso, finIso });
        } catch {
          // El calendario (fuente de verdad) YA se movió: el registro se re-sincroniza en la próxima operación; no se falla al cliente.
        }
        return { ok: true, citaId: cita.id, servicio: cita.servicio, inicioIso, finIso };
      },
    });
  } catch {
    return { ok: false, motivo: "error_tecnico", detalle: "Hubo un error técnico real al intentar mover la cita." };
  }

  if (resultado.estado === "conflicto") return { ok: false, motivo: "conflicto_reintento", detalle: "Ya existe una solicitud distinta con esta misma referencia." };
  if (resultado.estado === "en_progreso") return { ok: false, motivo: "en_progreso", detalle: "Ya hay un cambio en curso para esta misma solicitud." };
  return resultado.resultado;
}
