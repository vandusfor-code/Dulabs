/**
 * PILOTO AMORE + Nylas (autorizado, FASE C) — creación REAL de una reserva:
 * revalidación (jornada + bloqueos + citas DuLabs + eventos reales de
 * Google Calendar) -> crear evento en Nylas -> crear cita en DuLabs (segunda
 * protección atómica, EXCLUDE de Postgres) -> si DuLabs falla, se revierte
 * el evento de Nylas ya creado.
 *
 * Reutiliza TAL CUAL (nunca duplicado):
 * - resolverEspecialistasElegiblesParaServicio (lib/asignacion-categoria.ts).
 * - ventanasLaboralesEspecialista / bloqueosDelDia / restarBloqueos
 *   (lib/especialistas.ts) -- mismo cálculo de jornada que el portal.
 * - citasOcupadasDelDia (lib/disponibilidad-servicio.ts) -- mismas citas ya
 *   reservadas en DuLabs.
 * - crearCitaEspecialista (lib/especialistas.ts) -- MISMA función que ya usa
 *   reservarCitaPorServicio/el portal; el constraint EXCLUDE de Postgres
 *   (dulabs_citas_especialista_sin_solape) sigue siendo la ÚLTIMA barrera
 *   real contra doble reserva, sin ningún cambio.
 * - ejecutarConIdempotencia / huellaSolicitud (lib/idempotencia-reserva.ts)
 *   -- MISMO mecanismo que ya usa el portal, sin tabla ni lógica nueva.
 * - consultarEventosOcupadosNylas / resolverCalendarIdNylasDeEspecialista
 *   (FASE B, sin cambios).
 *
 * Tenant-gateado explícitamente a AMORE (defensa en profundidad, además de
 * que ningún caller real llama esto todavía para otro tenant).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ventanasLaboralesEspecialista,
  bloqueosDelDia,
  restarBloqueos,
  crearCitaEspecialista,
  confirmarCita,
  type CitaEspecialista,
} from "@/lib/especialistas";
import { citasOcupadasDelDia } from "@/lib/disponibilidad-servicio";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";
import { fechaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import { consultarEventosOcupadosNylas } from "@/lib/nylas/nylas-eventos-ocupados";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

export type MotivoRechazoCitaNylas =
  | "tenant_no_autorizado"
  | "servicio_no_encontrado"
  | "duracion_invalida"
  | "especialista_no_encontrado"
  | "especialista_no_habilitado"
  | "sin_calendario_nylas"
  | "fuera_de_horario"
  | "bloqueado"
  | "ocupado"
  | "revalidacion_fallida"
  | "error_creando_evento_nylas"
  | "error_de_base_de_datos"
  | "solicitud_en_progreso"
  | "solicitud_en_conflicto"
  | "inconsistencia_requiere_revision_manual";

export type ResultadoCrearCitaNylas =
  | {
      ok: true;
      cita: CitaEspecialista;
      nylasEventId: string;
      especialista: { id: number; nombre: string };
      servicio: { id: string; nombre: string; duracionMin: number };
    }
  | { ok: false; motivo: MotivoRechazoCitaNylas; detalle: string };

export interface DepsCrearCitaNylas {
  /** Cliente de LECTURA de eventos (revalidación) -- real o mockeado. */
  nylasReadClient: NylasEventsClient;
  /** Cliente de ESCRITURA (crear/borrar evento) -- real o mockeado. */
  nylasWriteClient: NylasEventsWriteClient;
  /** grant_id ya resuelto por el caller (ver lib/nylas/nylas-grant.ts) -- nunca hardcodeado acá. */
  grantId: string;
  /** Inyectable para tests -- default real: resolverCalendarIdNylasDeEspecialista. */
  resolverCalendarId?: typeof resolverCalendarIdNylasDeEspecialista;
}

function construirDescripcionEvento(datos: { servicio: string; especialista: string; cliente: string; telefono: string | null }): string {
  return [
    `Servicio: ${datos.servicio}`,
    `Profesional: ${datos.especialista}`,
    `Cliente: ${datos.cliente}`,
    datos.telefono ? `Teléfono: ${datos.telefono}` : null,
    "Origen: Piloto AMORE (DuLabs + Nylas)",
  ]
    .filter(Boolean)
    .join("\n");
}

async function ejecutarCreacionReal(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    servicioId: string;
    especialistaId: number;
    inicio: Date;
    nombreCliente: string;
    telefonoCliente: string | null;
  },
  deps: DepsCrearCitaNylas,
): Promise<ResultadoCrearCitaNylas> {
  const { data: servicio } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, duracion_min")
    .eq("id_tenant", params.idTenant)
    .eq("id", params.servicioId)
    .eq("activo", true)
    .maybeSingle();
  if (!servicio) {
    return { ok: false, motivo: "servicio_no_encontrado", detalle: "Ese servicio no existe o no está activo." };
  }
  const duracionMin = servicio.duracion_min as number | null;
  if (!duracionMin || duracionMin <= 0) {
    return { ok: false, motivo: "duracion_invalida", detalle: "El servicio no tiene una duración real configurada." };
  }

  const { data: especialista } = await supabase
    .from("dulabs_especialistas")
    .select("id, nombre, phone_number_id, bloquea_horario, requiere_aprobacion")
    .eq("id_tenant", params.idTenant)
    .eq("id", params.especialistaId)
    .eq("activo", true)
    .maybeSingle();
  if (!especialista) {
    return { ok: false, motivo: "especialista_no_encontrado", detalle: "Ese especialista no existe o no está activo." };
  }

  const resolucion = await resolverEspecialistasElegiblesParaServicio(supabase, params.idTenant, servicio.id as string);
  if (!resolucion.especialistas.some((e) => e.especialistaId === especialista.id)) {
    return { ok: false, motivo: "especialista_no_habilitado", detalle: "Ese especialista no está habilitado para este servicio." };
  }

  const resolverCalendarId = deps.resolverCalendarId ?? resolverCalendarIdNylasDeEspecialista;
  const calendarId = await resolverCalendarId(supabase, params.idTenant, especialista.id);
  if (!calendarId) {
    return { ok: false, motivo: "sin_calendario_nylas", detalle: "Esta profesional no tiene un calendario de Nylas asociado todavía." };
  }

  const fin = new Date(params.inicio.getTime() + duracionMin * 60_000);
  const fechaISO = fechaColombiaDesdeIso(params.inicio.toISOString());

  // --- REVALIDACIÓN REAL (nunca se confía en una disponibilidad anterior) ---
  const ventanasBase = await ventanasLaboralesEspecialista(supabase, especialista.id, params.idTenant, fechaISO);
  const cabeEnJornadaBase = ventanasBase.some((v) => params.inicio >= v.apertura && fin <= v.cierre);
  if (!cabeEnJornadaBase) {
    return { ok: false, motivo: "fuera_de_horario", detalle: "Ese horario está fuera de la jornada laboral de la profesional." };
  }

  const bloqueos = await bloqueosDelDia(supabase, especialista.id, params.idTenant, fechaISO);
  const ventanasLibres = restarBloqueos(ventanasBase, bloqueos);
  const cabeSinBloqueo = ventanasLibres.some((v) => params.inicio >= v.apertura && fin <= v.cierre);
  if (!cabeSinBloqueo) {
    return { ok: false, motivo: "bloqueado", detalle: "Ese horario cae dentro de un bloqueo (almuerzo, vacaciones, etc.)." };
  }

  const desde = ventanasLibres[0]!.apertura;
  const hasta = ventanasLibres[ventanasLibres.length - 1]!.cierre;

  const ocupadasDulabs = await citasOcupadasDelDia(supabase, especialista.id, desde.toISOString(), hasta.toISOString());
  const seSolapaDulabs = ocupadasDulabs.some((o) => params.inicio < o.cierre && fin > o.apertura);
  if (seSolapaDulabs) {
    return { ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado por otra cita en DuLabs." };
  }

  const resultadoNylas = await consultarEventosOcupadosNylas(deps.nylasReadClient, {
    grantId: deps.grantId,
    calendarId,
    fechaISO,
    desde,
    hasta,
  });
  if (!resultadoNylas.ok) {
    return { ok: false, motivo: "revalidacion_fallida", detalle: "No se pudo confirmar la disponibilidad real contra Google Calendar." };
  }
  const seSolapaNylas = resultadoNylas.ocupadas.some((o) => params.inicio < o.cierre && fin > o.apertura);
  if (seSolapaNylas) {
    return { ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado en Google Calendar." };
  }

  // --- Todo libre: crear el evento REAL en Nylas primero ---
  let nylasEventId: string;
  try {
    const creado = await deps.nylasWriteClient.createEvent({
      grantId: deps.grantId,
      calendarId,
      title: `AMORE — ${servicio.nombre as string} (${params.nombreCliente})`,
      description: construirDescripcionEvento({
        servicio: servicio.nombre as string,
        especialista: especialista.nombre as string,
        cliente: params.nombreCliente,
        telefono: params.telefonoCliente,
      }),
      startUnix: Math.floor(params.inicio.getTime() / 1000),
      endUnix: Math.floor(fin.getTime() / 1000),
      timezone: "America/Bogota",
    });
    nylasEventId = creado.id;
  } catch (err) {
    return { ok: false, motivo: "error_creando_evento_nylas", detalle: err instanceof Error ? err.message : "Error desconocido creando el evento en Nylas." };
  }

  // --- Segunda protección: el INSERT atómico de DuLabs (EXCLUDE de Postgres) ---
  const resultadoDb = await crearCitaEspecialista(supabase, {
    especialistaId: especialista.id,
    idTenant: params.idTenant,
    phoneNumberId: especialista.phone_number_id as string,
    telefonoCliente: params.telefonoCliente,
    nombreCliente: params.nombreCliente,
    servicio: servicio.nombre as string,
    servicioId: servicio.id as string,
    inicio: params.inicio,
    duracionMin,
    bloqueaHorario: especialista.bloquea_horario as boolean,
    origen: "manual",
  });

  if (!resultadoDb.ok) {
    // DuLabs rechazó la cita (carrera real detectada por el EXCLUDE, u otro
    // error de base de datos) -- el evento de Nylas ya creado NUNCA debe
    // quedar huérfano: se intenta revertir (borrar) antes de responder.
    try {
      await deps.nylasWriteClient.deleteEvent({ grantId: deps.grantId, calendarId, eventId: nylasEventId });
    } catch {
      return {
        ok: false,
        motivo: "inconsistencia_requiere_revision_manual",
        detalle: `El evento de Nylas ${nylasEventId} quedó creado, pero DuLabs no pudo confirmar la cita (${resultadoDb.motivo}) y el intento de revertirlo también falló. Requiere revisión manual del calendario de ${especialista.nombre as string}.`,
      };
    }
    if (resultadoDb.motivo === "ocupado") {
      return { ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado (protección final de PostgreSQL)." };
    }
    return { ok: false, motivo: "error_de_base_de_datos", detalle: resultadoDb.detalle ?? "Error desconocido creando la cita en DuLabs." };
  }

  // Revisión (autorizada, sección 13 del pedido) — la disponibilidad de ESTE
  // camino ya fue revalidada de verdad (jornada + bloqueos + citas DuLabs +
  // eventos reales de Nylas/Google Calendar, arriba) y el evento/la fila ya
  // se crearon los dos con éxito: la cita YA está reservada, no necesita
  // aprobación administrativa. Mismo criterio EXACTO que ya usa
  // finalizarCitaCreada (lib/especialista-solicitud-ia.ts) para el resto del
  // equipo que agenda 100% dentro del spa -- requiere_aprobacion=false
  // confirma sola; requiere_aprobacion=true (el default más seguro para
  // cualquier especialista sin configurar explícitamente, ej. alguien que
  // también trabaja por fuera y cuya disponibilidad real el sistema no
  // conoce) se deja tal cual en "pendiente", sin ningún cambio de
  // comportamiento. Nunca se toca el flag acá -- se configura aparte, por
  // especialista, en dulabs_especialistas.
  const citaFinal = especialista.requiere_aprobacion
    ? resultadoDb.cita
    : ((await confirmarCita(supabase, resultadoDb.cita.id)) ?? resultadoDb.cita);

  return {
    ok: true,
    cita: citaFinal,
    nylasEventId,
    especialista: { id: especialista.id as number, nombre: especialista.nombre as string },
    servicio: { id: servicio.id as string, nombre: servicio.nombre as string, duracionMin },
  };
}

export async function crearCitaConNylas(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    servicioId: string;
    especialistaId: number;
    inicio: Date;
    nombreCliente: string;
    telefonoCliente: string | null;
    idempotencyKey: string;
  },
  deps: DepsCrearCitaNylas,
): Promise<ResultadoCrearCitaNylas> {
  if (params.idTenant !== AMORE_TENANT_ID) {
    return { ok: false, motivo: "tenant_no_autorizado", detalle: "Esta capacidad está limitada al tenant AMORE." };
  }

  const huella = huellaSolicitud([
    params.idTenant,
    params.servicioId,
    params.especialistaId,
    params.inicio.toISOString(),
    params.telefonoCliente,
    params.nombreCliente,
  ]);

  const idempotente = await ejecutarConIdempotencia<ResultadoCrearCitaNylas>(supabase, {
    idTenant: params.idTenant,
    idempotencyKey: params.idempotencyKey,
    huella,
    operacion: () => ejecutarCreacionReal(supabase, params, deps),
  });

  if (idempotente.estado === "conflicto") {
    return { ok: false, motivo: "solicitud_en_conflicto", detalle: "Esta idempotency_key ya se usó con parámetros distintos." };
  }
  if (idempotente.estado === "en_progreso") {
    return { ok: false, motivo: "solicitud_en_progreso", detalle: "Esta misma solicitud ya se está procesando." };
  }
  return idempotente.resultado;
}
