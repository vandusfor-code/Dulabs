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
  editarCitaConfirmada,
  type CitaEspecialista,
} from "@/lib/especialistas";
import { citasOcupadasDelDia } from "@/lib/disponibilidad-servicio";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";
// Fase 3 (autorizado, multi-servicio) -- intersección real de elegibilidad
// para 2 o 3 servicios (lib/agenda-v2/multi-servicio.ts, reutiliza TAL CUAL
// resolverEspecialistasElegiblesParaServicio, nunca una segunda regla).
import { resolverEspecialistasParaMultiServicio } from "@/lib/agenda-v2/multi-servicio";
import { fechaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import { consultarEventosOcupadosNylas } from "@/lib/nylas/nylas-eventos-ocupados";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";

// Correo fijo de AMORE (autorizado) -- se agrega como invitado real en TODO
// evento de Google Calendar que este archivo cree (cita nueva o
// reprogramada, que acá siempre se implementa como crear+borrar, ver
// ejecutarCreacionReal/ejecutarReprogramacionReal más abajo) -- es la
// "copia" real que la dueña de esta cuenta necesita ver en su propio
// calendario, sin depender de que acepte la invitación. Cancelar una cita
// borra el evento que ya tenía este invitado, así que Google le notifica la
// cancelación solo, sin ningún paso adicional acá. Exclusivo de AMORE (este
// archivo entero ya está tenant-gateado arriba) -- nunca afecta a otro tenant.
const CORREO_INVITADO_FIJO_AMORE = "Amoresalon34@gmail.com";

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

/**
 * Fase 3 (autorizado, multi-servicio) — `servicios` con 1 elemento produce
 * EXACTAMENTE el mismo texto de siempre ("Servicio: {nombre}\n..."). Con más
 * de uno, la primera línea pasa a ser una lista -- el resto (profesional,
 * cliente, teléfono, origen) no cambia.
 */
function construirDescripcionEvento(datos: { servicios: string[]; especialista: string; cliente: string; telefono: string | null }): string {
  const lineaServicios = datos.servicios.length === 1 ? `Servicio: ${datos.servicios[0]}` : `Servicios:\n${datos.servicios.map((s) => `- ${s}`).join("\n")}`;
  return [lineaServicios, `Profesional: ${datos.especialista}`, `Cliente: ${datos.cliente}`, datos.telefono ? `Teléfono: ${datos.telefono}` : null, "Origen: Piloto AMORE (DuLabs + Nylas)"]
    .filter(Boolean)
    .join("\n");
}

async function ejecutarCreacionReal(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    servicioId: string;
    // Fase 3 (autorizado, multi-servicio) -- 0 a 2 servicios EXTRA, además de
    // servicioId (máximo 3 en total, validado por el caller en
    // lib/agenda-v2/servicios.ts). Ningún caller existente la pasa -- queda
    // undefined y el comportamiento de un solo servicio es 100% idéntico al
    // de antes de esta fase (ver esMultiServicio abajo).
    serviciosIdsAdicionales?: string[];
    especialistaId: number;
    inicio: Date;
    nombreCliente: string;
    telefonoCliente: string | null;
  },
  deps: DepsCrearCitaNylas,
): Promise<ResultadoCrearCitaNylas> {
  const todosLosServicioIds = [params.servicioId, ...(params.serviciosIdsAdicionales ?? [])];
  const esMultiServicio = todosLosServicioIds.length > 1;

  const { data: serviciosData } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, precio, duracion_min")
    .eq("id_tenant", params.idTenant)
    .in("id", todosLosServicioIds)
    .eq("activo", true);
  const serviciosEncontrados = (serviciosData ?? []) as { id: string; nombre: string; precio: number | null; duracion_min: number | null }[];
  if (serviciosEncontrados.length !== todosLosServicioIds.length) {
    return { ok: false, motivo: "servicio_no_encontrado", detalle: "Uno o más servicios ya no existen o no están activos." };
  }
  // Preserva el orden pedido -- el .in() de Postgres no lo garantiza.
  const servicios = todosLosServicioIds.map((id) => serviciosEncontrados.find((s) => s.id === id)!);

  if (servicios.some((s) => !s.duracion_min || s.duracion_min <= 0)) {
    return { ok: false, motivo: "duracion_invalida", detalle: "Uno o más servicios no tienen una duración real configurada." };
  }
  const duracionMin = servicios.reduce((total, s) => total + (s.duracion_min as number), 0);
  const servicioPrincipal = servicios[0]!;
  const nombreParaEvento = servicios.map((s) => s.nombre).join(" + ");
  // Nunca inventa un total si algún servicio de la combinación no tiene
  // precio fijo (sección PRECIO del pedido: "NO inventar descuentos ni
  // promociones") -- se deja sin precio_total en vez de sumar un 0 falso.
  const precioTotal = esMultiServicio && servicios.every((s) => s.precio !== null) ? servicios.reduce((total, s) => total + (s.precio as number), 0) : null;

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

  // Fase 3 (autorizado) -- con un solo servicio, resolverEspecialistasElegiblesParaServicio
  // TAL CUAL (comportamiento idéntico al de antes de esta fase). Con varios,
  // la intersección real (lib/agenda-v2/multi-servicio.ts) -- nunca confía
  // ciegamente en que el paso anterior de Agenda V2 ya lo validó.
  const especialistasElegibles = esMultiServicio
    ? (await resolverEspecialistasParaMultiServicio(supabase, params.idTenant, todosLosServicioIds)).especialistas
    : (await resolverEspecialistasElegiblesParaServicio(supabase, params.idTenant, servicioPrincipal.id)).especialistas;
  if (!especialistasElegibles.some((e) => e.especialistaId === especialista.id)) {
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
      title: `AMORE — ${nombreParaEvento} (${params.nombreCliente})`,
      description: construirDescripcionEvento({
        servicios: servicios.map((s) => s.nombre),
        especialista: especialista.nombre as string,
        cliente: params.nombreCliente,
        telefono: params.telefonoCliente,
      }),
      startUnix: Math.floor(params.inicio.getTime() / 1000),
      endUnix: Math.floor(fin.getTime() / 1000),
      timezone: "America/Bogota",
      participants: [{ email: CORREO_INVITADO_FIJO_AMORE }],
    });
    nylasEventId = creado.id;
  } catch (err) {
    return { ok: false, motivo: "error_creando_evento_nylas", detalle: err instanceof Error ? err.message : "Error desconocido creando el evento en Nylas." };
  }

  // Corrección post-deploy (auditoría real, autorizado) -- especialista.phone_number_id
  // trae para AMORE el valor LEGACY de Meta ("pendiente-amore-<tenant>",
  // nunca actualizado cuando el canal pasó a WhatsApp-QR/Baileys), mientras
  // que TODO el resto del canal (candado, sesiones de Agenda V2, búsqueda de
  // cliente conocido) identifica a AMORE con el prefijo sintético real
  // "whatsapp-qr:<tenant_id>" (ver phoneNumberIdSintetico en
  // lib/agenda-v2/router.ts/lib/amore-entrada-router.ts). Guardar el valor
  // legacy en la cita hacía que gestión de citas (consultarCitasActivasEspecialista,
  // que filtra por phone_number_id) NUNCA encontrara ninguna cita real de
  // AMORE, sin importar la fecha. Esta función es exclusiva de AMORE (tenant
  // ya validado arriba en crearCitaConNylas/actualizarCitaConNylas), así que
  // siempre usa el prefijo sintético real -- nunca toca dulabs_especialistas
  // ni afecta a ningún otro tenant (que nunca pasa por este archivo).
  const phoneNumberIdParaCita = params.idTenant === AMORE_TENANT_ID ? `whatsapp-qr:${params.idTenant}` : (especialista.phone_number_id as string);

  // --- Segunda protección: el INSERT atómico de DuLabs (EXCLUDE de Postgres) ---
  // servicio/servicioId SIEMPRE el PRIMER servicio (sección MUY IMPORTANTE
  // del pedido: compatibilidad histórica total) -- nunca el combinado, para
  // que cualquier lector existente (recordatorios, dashboard, contabilidad)
  // siga viendo un servicio real y válido sin ningún cambio de contrato.
  const resultadoDb = await crearCitaEspecialista(supabase, {
    especialistaId: especialista.id,
    idTenant: params.idTenant,
    phoneNumberId: phoneNumberIdParaCita,
    telefonoCliente: params.telefonoCliente,
    nombreCliente: params.nombreCliente,
    servicio: servicioPrincipal.nombre,
    servicioId: servicioPrincipal.id,
    precioTotal,
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

  // --- FASE 3 (autorizado, multi-servicio) --------------------------------
  // La cita YA existe (protegida por el EXCLUDE) y el evento de Nylas YA es
  // real -- ambos son el éxito que de verdad importa (el horario quedó
  // bloqueado correctamente). Guardar la lista de servicios en
  // dulabs_cita_servicios es la ÚLTIMA escritura: no hay transacción real
  // posible entre esto y el INSERT anterior (Supabase-js no ofrece
  // transacciones multi-tabla desde el cliente), así que se documenta
  // explícitamente el mismo patrón "best-effort pero NUNCA silencioso" que
  // ya usa guardarNylasEventIdDeCita (lib/agenda-v2/citas-nylas.ts) para el
  // mapeo cita->evento: si este INSERT falla, la cita y el evento reales NO
  // se revierten (revertir una reserva ya protegida por el EXCLUDE sería más
  // riesgoso que dejarla con su registro de servicios incompleto -- alguien
  // más podría tomar ese horario mientras tanto), pero el caller se entera
  // con un motivo explícito para revisión manual, nunca un éxito silencioso
  // con datos incompletos.
  if (esMultiServicio) {
    const { error: errorPuente } = await supabase.from("dulabs_cita_servicios").insert(
      servicios.map((s, i) => ({ cita_id: resultadoDb.cita.id, id_tenant: params.idTenant, servicio_id: s.id, orden: i + 1 })),
    );
    if (errorPuente) {
      console.error(`[reserva-servicio-nylas] cita ${resultadoDb.cita.id} y evento Nylas ${nylasEventId} creados con éxito, pero dulabs_cita_servicios falló:`, errorPuente.message);
      return {
        ok: false,
        motivo: "inconsistencia_requiere_revision_manual",
        detalle: `La cita ${resultadoDb.cita.id} y el evento de Nylas ${nylasEventId} se crearon con éxito, pero no se pudo guardar el detalle de sus ${servicios.length} servicios (${errorPuente.message}). El horario quedó reservado correctamente -- requiere completar dulabs_cita_servicios manualmente.`,
      };
    }
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
    servicio: { id: servicioPrincipal.id, nombre: nombreParaEvento, duracionMin },
  };
}

// ---------------------------------------------------------------------------
// FASE 8 (Agenda V2, autorizado) — reprogramar (mover) una cita EXISTENTE a
// una nueva fecha/hora, EXACTAMENTE con el mismo rigor de revalidación real
// que crearCitaConNylas (jornada + bloqueos + citas DuLabs + eventos reales
// de Nylas), reutilizando TAL CUAL:
// - editarCitaConfirmada (lib/especialistas.ts) -- UPDATE atómico sobre la
//   MISMA fila (nunca crea una fila nueva, nunca cancela-y-crea): el
//   constraint EXCLUDE de Postgres es la ÚLTIMA autoridad real, igual que en
//   una creación nueva.
// - ejecutarConIdempotencia/huellaSolicitud -- mismo mecanismo exacto.
//
// Limitación conocida y aceptada (documentada, nunca oculta): el chequeo
// previo de "¿ya está ocupado?" (citasOcupadasDelDia/consultarEventosOcupadosNylas)
// no puede excluir la cita/el evento PROPIO de esta misma reserva (esas
// funciones compartidas no devuelven el id de cada ocupación) -- en el caso
// límite de reprogramar a un horario que se solapa con el horario ACTUAL de
// la misma cita, este chequeo puede rechazarlo como "ocupado" por error. El
// resultado de ese falso positivo es siempre seguro (un rechazo educado,
// nunca una corrupción ni una doble reserva) y la autoridad real final sigue
// siendo el UPDATE atómico protegido por el EXCLUDE de Postgres.
// ---------------------------------------------------------------------------

export type MotivoRechazoActualizarCitaNylas =
  | "tenant_no_autorizado"
  | "cita_no_encontrada"
  | "no_reagendable"
  | "servicio_no_encontrado"
  | "duracion_invalida"
  | "especialista_no_encontrado"
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

export type ResultadoActualizarCitaNylas =
  | {
      ok: true;
      cita: CitaEspecialista;
      nylasEventId: string;
      nylasEventIdAnterior: string | null;
      especialista: { id: number; nombre: string };
      servicio: { id: string; nombre: string; duracionMin: number };
    }
  | { ok: false; motivo: MotivoRechazoActualizarCitaNylas; detalle: string };

export interface DepsActualizarCitaNylas extends DepsCrearCitaNylas {
  /** id del evento de Nylas YA asociado a esta cita (tabla dulabs_agenda_v2_citas_nylas) -- null si no hay mapeo (cita creada antes de que existiera, o de otro canal). Nunca bloquea la reprogramación: sin él, simplemente no hay evento viejo que borrar. */
  nylasEventIdActual: string | null;
}

async function ejecutarActualizacionReal(
  supabase: SupabaseClient,
  params: { idTenant: string; citaId: number; nuevoInicio: Date },
  deps: DepsActualizarCitaNylas,
): Promise<ResultadoActualizarCitaNylas> {
  const { data: citaActual } = await supabase
    .from("dulabs_citas_especialista")
    .select("id, especialista_id, servicio_id, inicio, fin, estado")
    .eq("id_tenant", params.idTenant)
    .eq("id", params.citaId)
    .maybeSingle();
  if (!citaActual) {
    return { ok: false, motivo: "cita_no_encontrada", detalle: "Esa cita no existe para este negocio." };
  }
  if (citaActual.estado !== "confirmada") {
    // Mismo criterio EXACTO que moverCitaEspecialista (especialistas-flow-adaptador.ts,
    // sin cambios) -- una cita pendiente de aprobación no se reprograma sola.
    return { ok: false, motivo: "no_reagendable", detalle: "Esta cita todavía está pendiente de aprobación y no se puede reprogramar todavía." };
  }
  if (!citaActual.servicio_id) {
    return { ok: false, motivo: "servicio_no_encontrado", detalle: "Esta cita no tiene un servicio real asociado -- no se puede revalidar su disponibilidad." };
  }

  // Fase 3 (autorizado, multi-servicio) -- si esta cita tiene fila(s) en
  // dulabs_cita_servicios, es la fuente de verdad de TODOS sus servicios
  // (mismo profesional, un solo bloque); si no tiene ninguna, es una cita de
  // un solo servicio y el camino queda IDÉNTICO al de antes de esta fase
  // (una sola consulta a dulabs_servicios por servicio_id).
  const { data: filasPuente } = await supabase.from("dulabs_cita_servicios").select("servicio_id, orden").eq("cita_id", params.citaId).order("orden", { ascending: true });
  const esMultiServicio = Boolean(filasPuente && filasPuente.length > 1);
  const idsAValidar = esMultiServicio ? (filasPuente as { servicio_id: string }[]).map((f) => f.servicio_id) : [citaActual.servicio_id as string];

  const { data: serviciosData } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, duracion_min")
    .eq("id_tenant", params.idTenant)
    .in("id", idsAValidar)
    .eq("activo", true);
  const serviciosEncontrados = (serviciosData ?? []) as { id: string; nombre: string; duracion_min: number | null }[];
  if (serviciosEncontrados.length !== idsAValidar.length) {
    return { ok: false, motivo: "servicio_no_encontrado", detalle: "Uno o más servicios de esta cita ya no existen o no están activos." };
  }
  const servicios = idsAValidar.map((id) => serviciosEncontrados.find((s) => s.id === id)!);
  if (servicios.some((s) => !s.duracion_min || s.duracion_min <= 0)) {
    return { ok: false, motivo: "duracion_invalida", detalle: "Uno o más servicios no tienen una duración real configurada." };
  }
  const duracionMin = servicios.reduce((total, s) => total + (s.duracion_min as number), 0);
  const nombreParaEvento = servicios.map((s) => s.nombre).join(" + ");

  const especialistaId = citaActual.especialista_id as number;
  const { data: especialista } = await supabase
    .from("dulabs_especialistas")
    .select("id, nombre, requiere_aprobacion")
    .eq("id_tenant", params.idTenant)
    .eq("id", especialistaId)
    .eq("activo", true)
    .maybeSingle();
  if (!especialista) {
    return { ok: false, motivo: "especialista_no_encontrado", detalle: "Esa profesional ya no existe o no está activa." };
  }

  const resolverCalendarId = deps.resolverCalendarId ?? resolverCalendarIdNylasDeEspecialista;
  const calendarId = await resolverCalendarId(supabase, params.idTenant, especialistaId);
  if (!calendarId) {
    return { ok: false, motivo: "sin_calendario_nylas", detalle: "Esta profesional no tiene un calendario de Nylas asociado todavía." };
  }

  const nuevoFin = new Date(params.nuevoInicio.getTime() + duracionMin * 60_000);
  const fechaISO = fechaColombiaDesdeIso(params.nuevoInicio.toISOString());

  // --- REVALIDACIÓN REAL para el NUEVO horario (nunca se confía en lo ya mostrado) ---
  const ventanasBase = await ventanasLaboralesEspecialista(supabase, especialistaId, params.idTenant, fechaISO);
  const cabeEnJornadaBase = ventanasBase.some((v) => params.nuevoInicio >= v.apertura && nuevoFin <= v.cierre);
  if (!cabeEnJornadaBase) {
    return { ok: false, motivo: "fuera_de_horario", detalle: "Ese horario está fuera de la jornada laboral de la profesional." };
  }

  const bloqueos = await bloqueosDelDia(supabase, especialistaId, params.idTenant, fechaISO);
  const ventanasLibres = restarBloqueos(ventanasBase, bloqueos);
  const cabeSinBloqueo = ventanasLibres.some((v) => params.nuevoInicio >= v.apertura && nuevoFin <= v.cierre);
  if (!cabeSinBloqueo) {
    return { ok: false, motivo: "bloqueado", detalle: "Ese horario cae dentro de un bloqueo (almuerzo, vacaciones, etc.)." };
  }

  const desde = ventanasLibres[0]!.apertura;
  const hasta = ventanasLibres[ventanasLibres.length - 1]!.cierre;

  const ocupadasDulabs = await citasOcupadasDelDia(supabase, especialistaId, desde.toISOString(), hasta.toISOString());
  const seSolapaDulabs = ocupadasDulabs.some((o) => params.nuevoInicio < o.cierre && nuevoFin > o.apertura);
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
  const seSolapaNylas = resultadoNylas.ocupadas.some((o) => params.nuevoInicio < o.cierre && nuevoFin > o.apertura);
  if (seSolapaNylas) {
    return { ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado en Google Calendar." };
  }

  // --- Todo libre: crear el NUEVO evento real en Nylas primero (mismo orden que crearCitaConNylas) ---
  let nylasEventIdNuevo: string;
  try {
    const creado = await deps.nylasWriteClient.createEvent({
      grantId: deps.grantId,
      calendarId,
      title: `AMORE — ${nombreParaEvento} (reprogramada)`,
      startUnix: Math.floor(params.nuevoInicio.getTime() / 1000),
      endUnix: Math.floor(nuevoFin.getTime() / 1000),
      timezone: "America/Bogota",
      participants: [{ email: CORREO_INVITADO_FIJO_AMORE }],
    });
    nylasEventIdNuevo = creado.id;
  } catch (err) {
    return { ok: false, motivo: "error_creando_evento_nylas", detalle: err instanceof Error ? err.message : "Error desconocido creando el evento en Nylas." };
  }

  // --- Segunda protección: el UPDATE atómico de DuLabs (EXCLUDE de Postgres), MISMA fila, nunca una nueva ---
  // duracionMin explícito SIEMPRE (ya es la suma real de todos los
  // servicios de la cita, sea 1 o varios) -- nunca se confía en que
  // fin-inicio de la fila ya guardada siga siendo correcto.
  const resultadoDb = await editarCitaConfirmada(supabase, params.citaId, { nuevoInicio: params.nuevoInicio, duracionMin });

  if (!resultadoDb.ok) {
    // La cita original NUNCA se toca si el UPDATE falla -- Postgres deja la
    // fila intacta en su horario anterior. El evento NUEVO de Nylas ya
    // creado nunca debe quedar huérfano: se intenta revertir (borrar) antes
    // de responder -- mismo criterio exacto que crearCitaConNylas.
    try {
      await deps.nylasWriteClient.deleteEvent({ grantId: deps.grantId, calendarId, eventId: nylasEventIdNuevo });
    } catch {
      return {
        ok: false,
        motivo: "inconsistencia_requiere_revision_manual",
        detalle: `El evento de Nylas ${nylasEventIdNuevo} quedó creado, pero DuLabs no pudo confirmar el cambio (${resultadoDb.motivo}) y el intento de revertirlo también falló. La cita original sigue intacta en su horario anterior. Requiere revisión manual del calendario de ${especialista.nombre as string}.`,
      };
    }
    if (resultadoDb.motivo === "ocupado") {
      return { ok: false, motivo: "ocupado", detalle: "Ese horario ya fue tomado (protección final de PostgreSQL). Tu cita original sigue intacta." };
    }
    if (resultadoDb.motivo === "no_encontrada") {
      return { ok: false, motivo: "cita_no_encontrada", detalle: "Esa cita ya no está disponible para reprogramar (pudo haber sido cancelada)." };
    }
    return { ok: false, motivo: "error_de_base_de_datos", detalle: resultadoDb.detalle ?? "Error desconocido actualizando la cita en DuLabs." };
  }

  // --- Éxito: la cita YA quedó movida de forma segura. Borrar el evento VIEJO de Nylas es best-effort (nunca deshace el éxito ya logrado). ---
  if (deps.nylasEventIdActual) {
    try {
      await deps.nylasWriteClient.deleteEvent({ grantId: deps.grantId, calendarId, eventId: deps.nylasEventIdActual });
    } catch (err) {
      console.error(
        `[reserva-servicio-nylas] no se pudo borrar el evento anterior de Nylas (${deps.nylasEventIdActual}) tras reprogramar la cita ${params.citaId} -- puede quedar un evento duplicado en el calendario, requiere revisión manual:`,
        err instanceof Error ? err.message : "error desconocido",
      );
    }
  }

  return {
    ok: true,
    cita: resultadoDb.cita,
    nylasEventId: nylasEventIdNuevo,
    nylasEventIdAnterior: deps.nylasEventIdActual,
    especialista: { id: especialista.id as number, nombre: especialista.nombre as string },
    servicio: { id: citaActual.servicio_id as string, nombre: nombreParaEvento, duracionMin },
  };
}

export async function actualizarCitaConNylas(
  supabase: SupabaseClient,
  params: { idTenant: string; citaId: number; nuevoInicio: Date; idempotencyKey: string },
  deps: DepsActualizarCitaNylas,
): Promise<ResultadoActualizarCitaNylas> {
  if (params.idTenant !== AMORE_TENANT_ID) {
    return { ok: false, motivo: "tenant_no_autorizado", detalle: "Esta capacidad está limitada al tenant AMORE." };
  }

  const huella = huellaSolicitud([params.idTenant, params.citaId, params.nuevoInicio.toISOString()]);

  const idempotente = await ejecutarConIdempotencia<ResultadoActualizarCitaNylas>(supabase, {
    idTenant: params.idTenant,
    idempotencyKey: params.idempotencyKey,
    huella,
    operacion: () => ejecutarActualizacionReal(supabase, params, deps),
  });

  if (idempotente.estado === "conflicto") {
    return { ok: false, motivo: "solicitud_en_conflicto", detalle: "Esta idempotency_key ya se usó con parámetros distintos." };
  }
  if (idempotente.estado === "en_progreso") {
    return { ok: false, motivo: "solicitud_en_progreso", detalle: "Esta misma solicitud ya se está procesando." };
  }
  return idempotente.resultado;
}

export async function crearCitaConNylas(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    servicioId: string;
    // Fase 3 (autorizado, multi-servicio) -- 0 a 2 servicios EXTRA, además de
    // servicioId (máximo 3 en total). Ningún caller existente la pasa -- la
    // firma/comportamiento de un solo servicio quedan 100% intactos.
    serviciosIdsAdicionales?: string[];
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
    (params.serviciosIdsAdicionales ?? []).join(","),
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
