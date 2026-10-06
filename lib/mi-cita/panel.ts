/**
 * AMORE — el PANEL de la profesional y Google Calendar: cada acción del panel deja el calendario igual que la agenda.
 *
 * Antes, el panel solo cambiaba la base: editar una cita (otra hora, otra duración u otra profesional) dejaba el evento de Google en el horario viejo y en el
 * calendario de la profesional anterior; rechazar una solicitud dejaba el evento bloqueando ese horario; y una cita creada a mano guardaba el teléfono tal como
 * se escribió («314 812 7388»), con lo que el bot de WhatsApp no la encontraba para cancelar o cambiar, y su confirmación no llevaba el enlace «Mi cita».
 *
 * Reglas (las mismas que ya usan el portal y «Mi cita», nunca una segunda):
 *   - La base sigue siendo la autoridad: el panel es una decisión de la administradora y NO se revalida contra lo ocupado en Google (puede mover una cita sobre un
 *     evento personal si ella lo decide). El evento de Google se mueve «crear el nuevo → cambiar la base → borrar el viejo»: si Google no responde NO se cambia nada
 *     (falla cerrado, con un mensaje claro), y si la base rechaza el cambio (choque de horario) el evento nuevo se borra y todo queda como estaba.
 *   - Solo AMORE (el único negocio con Google Calendar). Cualquier otro negocio no pasa por aquí.
 *   - Los avisos (WhatsApp) nunca tumban una acción ya hecha.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cancelarCita,
  confirmarCita,
  editarCitaConfirmada,
  proponerReagendamiento,
  rechazarCita,
  type CitaEspecialista,
} from "@/lib/especialistas";
import { AMORE_TENANT_ID, phoneNumberIdWhatsappQr } from "@/lib/nylas/nylas-grant";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import { guardarNylasEventIdDeCita, obtenerNylasEventIdDeCita } from "@/lib/agenda-v2/citas-nylas";
import { obtenerNombresServiciosDeCita } from "@/lib/agenda-v2/multi-servicio";
import { construirDescripcionEvento, crearCitaConNylas, type ResultadoCrearCitaNylas } from "@/lib/reserva-servicio-nylas";
import { enviarConfirmacionReservaWhatsApp, notificarNuevaCitaProfesional } from "@/lib/reserva-notificaciones-whatsapp";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import { borrarEventoDeCita, type DepsMiCita } from "@/lib/mi-cita/gestion";
import { urlEnlaceDeCita } from "@/lib/mi-cita/chat";
import { telefonoParaReserva } from "@/lib/mi-cita/reserva-portal";

export interface DepsPanelAmore extends DepsMiCita {
  /** Inyectables para pruebas; el default es el envío real por WhatsApp. */
  enviarConfirmacion?: typeof enviarConfirmacionReservaWhatsApp;
  notificarProfesional?: typeof notificarNuevaCitaProfesional;
}

const logPorDefecto = (mensaje: string, detalle?: unknown) => console.error(`[mi-cita/panel] ${mensaje}`, detalle ?? "");

type ResultadoDb = { ok: true; cita: CitaEspecialista } | { ok: false; motivo: "ocupado" | "no_encontrada" | "error"; detalle?: string };
export type ResultadoPanelConGoogle = ResultadoDb | { ok: false; motivo: "calendario_no_disponible"; detalle: string };

interface FilaAntes {
  id: number;
  especialista_id: number;
  servicio: string;
  nombre_cliente: string;
  telefono_cliente: string | null;
  inicio: string;
  fin: string;
  estado: string;
}

interface Destino {
  inicio: Date;
  fin: Date;
  especialistaId: number;
  /** Solo para citas sin servicio estructurado (texto libre); cambia el título del evento. */
  servicioTexto?: string;
}

async function leerCita(supabase: SupabaseClient, citaId: number): Promise<FilaAntes | null> {
  const { data } = await supabase
    .from("dulabs_citas_especialista")
    .select("id, especialista_id, servicio, nombre_cliente, telefono_cliente, inicio, fin, estado")
    .eq("id", citaId)
    .eq("id_tenant", AMORE_TENANT_ID)
    .maybeSingle();
  return (data as FilaAntes | null) ?? null;
}

/**
 * Mueve el evento de Google de la cita a donde la acción del panel la deja, alrededor de `operacionDb` (el cambio real en la base).
 * Si la cita no está en un estado donde `operacionDb` pueda actuar, o nada de lo que importa al calendario cambia, solo se ejecuta `operacionDb`.
 */
async function conEventoSincronizado(
  deps: DepsPanelAmore,
  citaId: number,
  estadosValidos: string[],
  destinoDe: (antes: FilaAntes) => Destino,
  operacionDb: () => Promise<ResultadoDb>,
): Promise<ResultadoPanelConGoogle> {
  const log = deps.log ?? logPorDefecto;
  const antes = await leerCita(deps.supabase, citaId);
  if (!antes || !estadosValidos.includes(antes.estado)) return operacionDb();

  const destino = destinoDe(antes);
  const cambiaElCalendario =
    Date.parse(antes.inicio) !== destino.inicio.getTime() ||
    Date.parse(antes.fin) !== destino.fin.getTime() ||
    antes.especialista_id !== destino.especialistaId ||
    (destino.servicioTexto !== undefined && destino.servicioTexto !== antes.servicio);
  if (!cambiaElCalendario) return operacionDb();

  const nylas = deps.nylas;
  if (!nylas) return { ok: false, motivo: "calendario_no_disponible", detalle: "La integración con Google Calendar no está disponible en este momento, así que no se cambió nada. Intenta de nuevo en unos minutos." };

  const calendarioDestino = await resolverCalendarIdNylasDeEspecialista(deps.supabase, AMORE_TENANT_ID, destino.especialistaId);
  if (!calendarioDestino) return { ok: false, motivo: "calendario_no_disponible", detalle: "Esa profesional no tiene un calendario de Google asociado, así que no se cambió nada." };

  const eventoAnterior = await obtenerNylasEventIdDeCita(deps.supabase, citaId);

  let servicios: string[] = [];
  try {
    servicios = await (deps.nombresServicios ?? obtenerNombresServiciosDeCita)(deps.supabase, citaId);
  } catch {
    servicios = [];
  }
  if (servicios.length === 0) servicios = [destino.servicioTexto?.trim() || antes.servicio];
  const { data: profesional } = await deps.supabase.from("dulabs_especialistas").select("nombre").eq("id_tenant", AMORE_TENANT_ID).eq("id", destino.especialistaId).maybeSingle();

  // 1. El evento NUEVO primero: si Google no responde, la base no se toca.
  let eventoNuevo: string;
  try {
    const creado = await nylas.write.createEvent({
      grantId: nylas.grantId,
      calendarId: calendarioDestino,
      title: `AMORE — ${servicios.join(" + ")} (${antes.nombre_cliente})`,
      description: construirDescripcionEvento({ servicios, especialista: (profesional?.nombre as string | undefined) ?? "—", cliente: antes.nombre_cliente, telefono: antes.telefono_cliente }),
      startUnix: Math.floor(destino.inicio.getTime() / 1000),
      endUnix: Math.floor(destino.fin.getTime() / 1000),
      timezone: "America/Bogota",
    });
    eventoNuevo = creado.id;
  } catch (err) {
    log("no se pudo crear el evento nuevo en Google Calendar: la cita NO se modificó", err instanceof Error ? err.message : "error desconocido");
    return { ok: false, motivo: "calendario_no_disponible", detalle: "No pudimos actualizar Google Calendar, así que no se cambió nada. Intenta de nuevo en unos minutos." };
  }

  const deshacerEventoNuevo = async () => {
    try {
      await nylas.write.deleteEvent({ grantId: nylas.grantId, calendarId: calendarioDestino, eventId: eventoNuevo });
    } catch (err) {
      log(`el cambio no se pudo guardar y tampoco se pudo borrar el evento nuevo ${eventoNuevo} (requiere revisión manual del calendario)`, err instanceof Error ? err.message : "error desconocido");
    }
  };

  // 2. El cambio real en la base (el EXCLUDE de Postgres sigue siendo la última barrera contra choques).
  let r: ResultadoDb;
  try {
    r = await operacionDb();
  } catch (err) {
    await deshacerEventoNuevo();
    throw err;
  }
  if (!r.ok) {
    await deshacerEventoNuevo();
    return r;
  }

  // 3. La cita ya quedó movida: el mapeo apunta al evento nuevo y el viejo se borra (mejor esfuerzo, nunca deshace lo logrado).
  await guardarNylasEventIdDeCita(deps.supabase, citaId, eventoNuevo);
  if (eventoAnterior) {
    try {
      const calendarioOrigen = antes.especialista_id === destino.especialistaId ? calendarioDestino : await resolverCalendarIdNylasDeEspecialista(deps.supabase, AMORE_TENANT_ID, antes.especialista_id);
      if (!calendarioOrigen) throw new Error("la profesional anterior ya no tiene calendario asociado");
      await nylas.write.deleteEvent({ grantId: nylas.grantId, calendarId: calendarioOrigen, eventId: eventoAnterior });
    } catch (err) {
      log(`la cita ${citaId} se movió, pero no se pudo borrar su evento anterior ${eventoAnterior} (puede quedar un evento duplicado: requiere revisión manual)`, err instanceof Error ? err.message : "error desconocido");
    }
  }
  // El enlace «Mi cita» debe seguir vigente hasta después de la nueva fecha (si no existe aún, se emite: es el mismo que recibirá en el recordatorio).
  await urlEnlaceDeCita(deps.supabase, AMORE_TENANT_ID, { id: citaId, fin: r.cita.fin }, deps.store);
  return r;
}

/** Editar una cita CONFIRMADA (otra hora, duración o profesional; texto de servicio solo en citas sin servicio estructurado). */
export function editarCitaDelPanelAmore(
  deps: DepsPanelAmore,
  citaId: number,
  cambios: { nuevoInicio?: Date; duracionMin?: number; servicio?: string; especialistaId?: number },
): Promise<ResultadoPanelConGoogle> {
  return conEventoSincronizado(
    deps,
    citaId,
    ["confirmada"],
    (antes) => {
      const inicio = cambios.nuevoInicio ?? new Date(antes.inicio);
      const duracionMin = cambios.duracionMin ?? (Date.parse(antes.fin) - Date.parse(antes.inicio)) / 60_000;
      return { inicio, fin: new Date(inicio.getTime() + duracionMin * 60_000), especialistaId: cambios.especialistaId ?? antes.especialista_id, servicioTexto: cambios.servicio?.trim() || undefined };
    },
    () => editarCitaConfirmada(deps.supabase, citaId, cambios),
  );
}

/** Proponer otro horario a una solicitud PENDIENTE: el horario propuesto queda retenido y el evento de Google lo acompaña. */
export function reagendarCitaDelPanelAmore(deps: DepsPanelAmore, citaId: number, nuevoInicio: Date, duracionMin: number): Promise<ResultadoPanelConGoogle> {
  return conEventoSincronizado(
    deps,
    citaId,
    ["pendiente"],
    (antes) => ({ inicio: nuevoInicio, fin: new Date(nuevoInicio.getTime() + duracionMin * 60_000), especialistaId: antes.especialista_id }),
    () => proponerReagendamiento(deps.supabase, citaId, nuevoInicio, duracionMin),
  );
}

/** Rechazar una solicitud: libera también el evento de Google (si no, seguiría bloqueando ese horario). */
export async function rechazarCitaDelPanelAmore(deps: DepsPanelAmore, citaId: number, motivo?: string): Promise<CitaEspecialista | null> {
  const cita = await rechazarCita(deps.supabase, citaId, motivo);
  if (cita) await borrarEventoDeCita(deps, { id: cita.id, id_tenant: AMORE_TENANT_ID, especialista_id: cita.especialista_id });
  return cita;
}

/** Cancelar una cita: libera también el evento de Google. */
export async function cancelarCitaDelPanelAmore(deps: DepsPanelAmore, citaId: number, motivo?: string): Promise<CitaEspecialista | null> {
  const cita = await cancelarCita(deps.supabase, citaId, motivo);
  if (cita) await borrarEventoDeCita(deps, { id: cita.id, id_tenant: AMORE_TENANT_ID, especialista_id: cita.especialista_id });
  return cita;
}

/** La confirmación por WhatsApp con el enlace «Mi cita». Nunca lanza. Solo se manda si la cita quedó confirmada. */
async function avisarConfirmacion(deps: DepsPanelAmore, datos: { cita: Pick<CitaEspecialista, "id" | "inicio" | "fin" | "estado">; telefono: string | null; servicio: string; profesional: string }): Promise<void> {
  try {
    const url = await urlEnlaceDeCita(deps.supabase, AMORE_TENANT_ID, { id: datos.cita.id, fin: datos.cita.fin }, deps.store);
    if (!datos.telefono || datos.cita.estado !== "confirmada") return;
    const enviar = deps.enviarConfirmacion ?? enviarConfirmacionReservaWhatsApp;
    await enviar(deps.supabase, AMORE_TENANT_ID, datos.telefono, { servicio: datos.servicio, profesional: datos.profesional, inicioISO: datos.cita.inicio, enlaceGestion: url });
  } catch (err) {
    (deps.log ?? logPorDefecto)("no se pudo enviar la confirmación por WhatsApp (la cita ya quedó)", err instanceof Error ? err.message : "error desconocido");
  }
}

/**
 * Confirmar una solicitud pendiente: la clienta recibe por WhatsApp la confirmación (con el enlace «Mi cita»). El aviso antiguo de este panel usa la API de Meta,
 * que AMORE no tiene (su canal es WhatsApp-QR), así que nunca le llegaba nada; además su texto es la política de otro negocio.
 */
export async function confirmarCitaDelPanelAmore(deps: DepsPanelAmore, citaId: number): Promise<CitaEspecialista | null> {
  const cita = await confirmarCita(deps.supabase, citaId);
  if (!cita) return null;
  try {
    let servicios: string[] = [];
    try {
      servicios = await (deps.nombresServicios ?? obtenerNombresServiciosDeCita)(deps.supabase, cita.id);
    } catch {
      servicios = [];
    }
    const { data: profesional } = await deps.supabase.from("dulabs_especialistas").select("nombre").eq("id_tenant", AMORE_TENANT_ID).eq("id", cita.especialista_id).maybeSingle();
    await avisarConfirmacion(deps, {
      cita,
      telefono: telefonoParaReserva(cita.telefono_cliente ?? ""),
      servicio: servicios.length > 0 ? servicios.join(" + ") : cita.servicio,
      profesional: (profesional?.nombre as string | undefined) ?? "tu profesional",
    });
  } catch (err) {
    (deps.log ?? logPorDefecto)("la cita se confirmó, pero no se pudo preparar el aviso a la clienta", err instanceof Error ? err.message : "error desconocido");
  }
  return cita;
}

export interface EntradaCitaDelPanelAmore {
  servicioId: string;
  especialistaId: number;
  inicio: Date;
  nombreCliente: string;
  telefonoCliente: string | null;
  correoCliente?: string;
  idempotencyKey: string;
}

/**
 * Crear una cita a mano desde el panel (motor real con Google Calendar). La clienta queda con la MISMA identidad que una que escribió por WhatsApp: teléfono
 * normalizado (si no se puede interpretar se conserva como lo escribieron, igual que antes), así el bot la encuentra al cancelar, cambiar o consultar; y su
 * confirmación lleva el enlace «Mi cita».
 */
export async function crearCitaDelPanelAmore(deps: DepsPanelAmore, e: EntradaCitaDelPanelAmore): Promise<ResultadoCrearCitaNylas> {
  const nylas = deps.nylas;
  if (!nylas) return { ok: false, motivo: "sin_calendario_nylas", detalle: "La integración de calendario no está configurada." };
  // Un teléfono interpretable se guarda normalizado y es el único al que se le escribe; uno que no se pueda interpretar se conserva como lo escribieron (igual que antes).
  const telefono = e.telefonoCliente ? telefonoParaReserva(e.telefonoCliente) : null;

  const resultado = await crearCitaConNylas(
    deps.supabase,
    { idTenant: AMORE_TENANT_ID, servicioId: e.servicioId, especialistaId: e.especialistaId, inicio: e.inicio, nombreCliente: e.nombreCliente, telefonoCliente: telefono ?? e.telefonoCliente, idempotencyKey: e.idempotencyKey },
    { nylasReadClient: nylas.read, nylasWriteClient: nylas.write, grantId: nylas.grantId },
  );
  if (!resultado.ok) return resultado;

  // Mejor esfuerzo (nunca tumba una cita ya creada), igual que el resto de los caminos.
  await guardarNylasEventIdDeCita(deps.supabase, resultado.cita.id, resultado.nylasEventId);
  if (telefono) {
    await recordarNombreCliente(deps.supabase, { idTenant: AMORE_TENANT_ID, phoneNumberId: phoneNumberIdWhatsappQr(AMORE_TENANT_ID), telefonoCliente: telefono, nombre: e.nombreCliente, correo: e.correoCliente });
  }
  // «Tu cita ha sido confirmada» solo si de verdad quedó confirmada (una profesional con requiere_aprobacion la deja pendiente): nunca se afirma algo falso.
  await avisarConfirmacion(deps, { cita: resultado.cita, telefono, servicio: resultado.servicio.nombre, profesional: resultado.especialista.nombre });

  try {
    const { data: profesional } = await deps.supabase.from("dulabs_especialistas").select("numero_whatsapp").eq("id_tenant", AMORE_TENANT_ID).eq("id", resultado.especialista.id).maybeSingle();
    const notificar = deps.notificarProfesional ?? notificarNuevaCitaProfesional;
    await notificar(AMORE_TENANT_ID, profesional?.numero_whatsapp as string | null | undefined, {
      nombreProfesional: resultado.especialista.nombre,
      servicio: resultado.servicio.nombre,
      inicioISO: resultado.cita.inicio,
      nombreCliente: e.nombreCliente,
      telefonoCliente: telefono ?? e.telefonoCliente,
    });
  } catch (err) {
    (deps.log ?? logPorDefecto)("la cita se creó, pero no se pudo avisar a la profesional", err instanceof Error ? err.message : "error desconocido");
  }
  return resultado;
}
