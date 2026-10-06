/**
 * AMORE — «MI CITA»: ver, reprogramar y cancelar UNA cita desde su enlace personal. Los casos de uso detrás de /mi-cita/{token} y /api/mi-cita/{token}/…
 *
 * NO es una segunda lógica de agenda: reutiliza TAL CUAL las piezas que ya usan el chat (Agenda V2) y el panel, con la misma fuente de verdad
 * (dulabs_citas_especialista + Google Calendar vía Nylas):
 *   - reprogramar  -> actualizarCitaConNylas (revalida jornada + bloqueos + citas + eventos reales de Google Calendar; UPDATE atómico de la MISMA fila,
 *                     protegido por el EXCLUDE de Postgres; nunca cancelar-y-crear; la profesional no cambia)
 *   - disponibilidad -> calcularHorariosDeEspecialista (el mismo motor del portal y del chat)
 *   - cancelar     -> cancelarCita + borrar el evento de Nylas (igual que el chat)
 *
 * Seguridad: el id de la cita NUNCA viene del cliente — sale del token (por su hash). Solo AMORE (compuerta explícita). La cita debe ser del mismo negocio
 * que el enlace. Un enlace inválido, vencido o de otro negocio responde igual (sin pistas). Los datos que se devuelven no incluyen ids internos, teléfono ni
 * el nombre de la clienta.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { cancelarCita, especialistaPorId } from "@/lib/especialistas";
import { fechaColombiaDesdeIso, horaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { formatearFechaLarga } from "@/lib/agenda-v2/fechas";
import { formatearHoraAmPm } from "@/lib/especialistas-flow-adaptador";
import { obtenerNombresServiciosDeCita } from "@/lib/agenda-v2/multi-servicio";
import { borrarNylasEventIdDeCita, guardarNylasEventIdDeCita, obtenerNylasEventIdDeCita } from "@/lib/agenda-v2/citas-nylas";
import { actualizarCitaConNylas } from "@/lib/reserva-servicio-nylas";
import { calcularHorariosDeEspecialista } from "@/lib/disponibilidad-servicio-nylas";
import { AMORE_TENANT_ID, resolverNylasGrantIdParaTenant } from "@/lib/nylas/nylas-grant";
import { createNylasEventsClient, createNylasEventsWriteClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import type { NylasEventsClient, NylasEventsWriteClient } from "@/lib/nylas/nylas-types";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";
import { normalizarTelefono } from "@/lib/marketplace-store";
import { createSupabaseEnlacesStore, obtenerOCrearEnlace, resolverEnlace, vencimientoDeEnlace, type EnlacesStore, type FilaEnlace } from "@/lib/mi-cita/enlaces";
import { mensajeCitaCancelada, mensajeCitaReprogramada } from "@/lib/mi-cita/mensajes";

/** Hasta cuántos días hacia adelante se puede reprogramar (igual que el portal de reservas). */
export const HORIZONTE_REPROGRAMAR_DIAS = 30;

export interface NylasMiCita {
  read: NylasEventsClient;
  write: NylasEventsWriteClient;
  grantId: string;
}

export interface DepsMiCita {
  supabase: SupabaseClient;
  store: EnlacesStore;
  /** null = sin integración de calendario en este entorno: reprogramar se rechaza (nunca a ciegas); cancelar sigue (sin tocar el evento). */
  nylas: NylasMiCita | null;
  ahora?: () => Date;
  /** Aviso por WhatsApp (mejor esfuerzo). */
  enviarMensaje?: (p: { tenantId: string; telefono: string; mensaje: string }) => Promise<{ ok: boolean }>;
  nombresServicios?: typeof obtenerNombresServiciosDeCita;
  log?: (mensaje: string, detalle?: unknown) => void;
}

/** Cableado de PRODUCCIÓN: enlaces en Supabase, Nylas desde el entorno (solo AMORE), WhatsApp por el worker. */
export function depsProduccionMiCita(supabase: SupabaseClient): DepsMiCita {
  const grantId = resolverNylasGrantIdParaTenant(AMORE_TENANT_ID);
  const apiKey = resolveNylasApiKeyFromEnv();
  return {
    supabase,
    store: createSupabaseEnlacesStore(supabase),
    nylas: grantId && apiKey ? { read: createNylasEventsClient(apiKey), write: createNylasEventsWriteClient(apiKey), grantId } : null,
  };
}

export type CodigoErrorMiCita = "enlace_invalido" | "cita_no_gestionable" | "horario_ocupado" | "horario_invalido" | "calendario_no_disponible" | "solicitud_invalida" | "error";

export type ResultadoMiCita<T> = { ok: true; data: T } | { ok: false; codigo: CodigoErrorMiCita; mensaje: string; status: number };

const ERRORES: Record<CodigoErrorMiCita, { mensaje: string; status: number }> = {
  enlace_invalido: { mensaje: "Este enlace no es válido o ya venció.", status: 404 },
  cita_no_gestionable: { mensaje: "Esta cita ya no se puede modificar.", status: 409 },
  horario_ocupado: { mensaje: "Ese horario acaba de ser tomado. Por favor elige otro.", status: 409 },
  horario_invalido: { mensaje: "Ese horario no está disponible. Por favor elige otro.", status: 409 },
  calendario_no_disponible: { mensaje: "No pudimos confirmar la disponibilidad en este momento. Intenta de nuevo en unos minutos.", status: 503 },
  solicitud_invalida: { mensaje: "La solicitud no es válida.", status: 400 },
  error: { mensaje: "Tuvimos un problema procesando tu solicitud. Por favor intenta de nuevo en un momento.", status: 500 },
};

const falla = (codigo: CodigoErrorMiCita, mensaje?: string): { ok: false; codigo: CodigoErrorMiCita; mensaje: string; status: number } => ({ ok: false, codigo, mensaje: mensaje ?? ERRORES[codigo].mensaje, status: ERRORES[codigo].status });

const logPorDefecto = (mensaje: string, detalle?: unknown) => console.error(`[mi-cita] ${mensaje}`, detalle ?? "");

type EstadoCita = "pendiente" | "confirmada" | "rechazada" | "cancelada" | "propuesta" | "completada" | "no_show";

interface FilaCita {
  id: number;
  id_tenant: string;
  especialista_id: number;
  telefono_cliente: string | null;
  servicio: string;
  servicio_id: string | null;
  inicio: string;
  fin: string;
  estado: EstadoCita;
}

export interface VistaCitaPublica {
  negocio: string;
  servicio: string;
  profesional: string;
  inicio: string;
  fin: string;
  duracionMin: number;
  estado: EstadoCita;
  puedeCancelar: boolean;
  puedeReprogramar: boolean;
  /** Por qué no se puede gestionar (si no se puede), en palabras de la clienta. */
  aviso: string | null;
}

/** Qué se puede hacer con una cita según su estado y su fecha. Pura. */
export function gestionDeCita(cita: Pick<FilaCita, "estado" | "inicio">, ahora: Date): { puedeCancelar: boolean; puedeReprogramar: boolean; aviso: string | null } {
  if (cita.estado === "cancelada") return { puedeCancelar: false, puedeReprogramar: false, aviso: "Esta cita ya fue cancelada." };
  if (cita.estado === "completada") return { puedeCancelar: false, puedeReprogramar: false, aviso: "Esta cita ya se realizó." };
  if (cita.estado !== "confirmada" && cita.estado !== "pendiente") return { puedeCancelar: false, puedeReprogramar: false, aviso: "Esta cita ya no se puede modificar." };
  if (!(Date.parse(cita.inicio) > ahora.getTime())) return { puedeCancelar: false, puedeReprogramar: false, aviso: "Esta cita ya pasó." };
  if (cita.estado === "pendiente") return { puedeCancelar: true, puedeReprogramar: false, aviso: "Tu cita está pendiente de aprobación. Por ahora solo puedes cancelarla." };
  return { puedeCancelar: true, puedeReprogramar: true, aviso: null };
}

interface Contexto {
  enlace: FilaEnlace;
  cita: FilaCita;
}

async function cargarContexto(deps: DepsMiCita, tokenCrudo: unknown): Promise<{ ok: true; ctx: Contexto } | ReturnType<typeof falla>> {
  const ahora = (deps.ahora ?? (() => new Date()))();
  const log = deps.log ?? logPorDefecto;
  const r = await resolverEnlace(deps.store, tokenCrudo, ahora, { log });
  if (!r.ok) return falla(r.motivo === "error" ? "error" : "enlace_invalido");
  // Compuerta explícita: «Mi cita» es solo de AMORE. Un enlace de cualquier otro negocio no abre nada.
  if (r.enlace.idTenant !== AMORE_TENANT_ID) return falla("enlace_invalido");
  const { data, error } = await deps.supabase
    .from("dulabs_citas_especialista")
    .select("id, id_tenant, especialista_id, telefono_cliente, servicio, servicio_id, inicio, fin, estado")
    .eq("id", r.enlace.citaId)
    .eq("id_tenant", r.enlace.idTenant)
    .maybeSingle();
  if (error) {
    log("error leyendo la cita del enlace", error.code);
    return falla("error");
  }
  const cita = data as FilaCita | null;
  // El negocio de la cita DEBE ser el del enlace: un enlace nunca abre una cita de otro negocio.
  if (!cita || cita.id_tenant !== r.enlace.idTenant) return falla("enlace_invalido");
  await deps.store.registrarUso(r.enlace.id, ahora.toISOString()).catch(() => undefined);
  return { ok: true, ctx: { enlace: r.enlace, cita } };
}

async function nombreDeServicios(deps: DepsMiCita, cita: FilaCita): Promise<string> {
  try {
    const nombres = await (deps.nombresServicios ?? obtenerNombresServiciosDeCita)(deps.supabase, cita.id);
    return nombres.length > 0 ? nombres.join(" + ") : cita.servicio;
  } catch {
    return cita.servicio;
  }
}

const duracionDe = (cita: Pick<FilaCita, "inicio" | "fin">): number => Math.round((Date.parse(cita.fin) - Date.parse(cita.inicio)) / 60_000);

async function nombreDeProfesional(deps: DepsMiCita, cita: FilaCita): Promise<string> {
  const e = await especialistaPorId(deps.supabase, cita.especialista_id).catch(() => null);
  return e?.nombre ?? "tu profesional";
}

/** Los datos de la cita para mostrarlos en la página (sin ids, sin teléfono, sin el nombre de la clienta). */
export async function verMiCita(deps: DepsMiCita, tokenCrudo: unknown): Promise<ResultadoMiCita<VistaCitaPublica>> {
  const c = await cargarContexto(deps, tokenCrudo);
  if (!c.ok) return c;
  const { cita } = c.ctx;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const g = gestionDeCita(cita, ahora);
  return {
    ok: true,
    data: {
      negocio: "AMORE",
      servicio: await nombreDeServicios(deps, cita),
      profesional: await nombreDeProfesional(deps, cita),
      inicio: cita.inicio,
      fin: cita.fin,
      duracionMin: duracionDe(cita),
      estado: cita.estado,
      puedeCancelar: g.puedeCancelar,
      puedeReprogramar: g.puedeReprogramar && deps.nylas !== null,
      aviso: g.aviso,
    },
  };
}

const fechaTextoDe = (inicioISO: string): { fechaTexto: string; horaTexto: string } => ({
  fechaTexto: formatearFechaLarga(fechaColombiaDesdeIso(inicioISO)),
  horaTexto: formatearHoraAmPm(horaColombiaDesdeIso(inicioISO)),
});

async function avisarPorWhatsApp(deps: DepsMiCita, cita: FilaCita, mensaje: string): Promise<void> {
  try {
    const telefono = normalizarTelefono(cita.telefono_cliente);
    if (!telefono) return;
    const enviar = deps.enviarMensaje ?? ((p) => enviarMensajeWhatsApp({ ...p, origen: "automatico" }).then((r) => ({ ok: r.ok })));
    await enviar({ tenantId: cita.id_tenant, telefono, mensaje });
  } catch (err) {
    (deps.log ?? logPorDefecto)("no se pudo enviar el aviso por WhatsApp (la operación ya quedó hecha)", err instanceof Error ? err.message : "error desconocido");
  }
}

/** Borra el evento de Google Calendar de la cita (mejor esfuerzo, igual que el chat). El mapeo cita->evento solo se quita si el evento ya no existe. */
export async function borrarEventoDeCita(deps: Pick<DepsMiCita, "supabase" | "nylas" | "log">, cita: { id: number; id_tenant: string; especialista_id: number }): Promise<void> {
  const log = deps.log ?? logPorDefecto;
  try {
    const eventId = await obtenerNylasEventIdDeCita(deps.supabase, cita.id);
    if (!eventId) return;
    if (!deps.nylas) {
      log("cita cancelada pero este entorno no tiene Nylas configurado: el evento de Google Calendar queda sin borrar", { citaId: cita.id });
      return;
    }
    const calendarId = await resolverCalendarIdNylasDeEspecialista(deps.supabase, cita.id_tenant, cita.especialista_id);
    if (!calendarId) {
      log("cita cancelada pero su profesional no tiene calendario asociado: el evento queda sin borrar", { citaId: cita.id });
      return;
    }
    await deps.nylas.write.deleteEvent({ grantId: deps.nylas.grantId, calendarId, eventId });
    await borrarNylasEventIdDeCita(deps.supabase, cita.id);
  } catch (err) {
    log("cita cancelada en DuLabs pero no se pudo borrar su evento de Google Calendar (requiere revisión manual)", err instanceof Error ? err.message : "error desconocido");
  }
}

/** Cancela la cita del enlace. Idempotente: cancelarla otra vez responde que ya estaba cancelada, sin repetir nada. */
export async function cancelarMiCita(deps: DepsMiCita, tokenCrudo: unknown): Promise<ResultadoMiCita<{ yaCancelada: boolean }>> {
  const c = await cargarContexto(deps, tokenCrudo);
  if (!c.ok) return c;
  const { cita } = c.ctx;
  if (cita.estado === "cancelada") return { ok: true, data: { yaCancelada: true } };
  const ahora = (deps.ahora ?? (() => new Date()))();
  const g = gestionDeCita(cita, ahora);
  if (!g.puedeCancelar) return falla("cita_no_gestionable", g.aviso ?? undefined);

  let cancelada;
  try {
    cancelada = await cancelarCita(deps.supabase, cita.id, "La clienta canceló desde su enlace personal (Mi cita)");
  } catch (err) {
    (deps.log ?? logPorDefecto)("error cancelando la cita", err instanceof Error ? err.message : "error desconocido");
    return falla("error");
  }
  // null = alguien la cambió justo antes (p. ej. ya la canceló el panel): se vuelve a leer para responder con la verdad.
  if (!cancelada) {
    const otra = await cargarContexto(deps, tokenCrudo);
    if (otra.ok && otra.ctx.cita.estado === "cancelada") return { ok: true, data: { yaCancelada: true } };
    return falla("cita_no_gestionable");
  }
  await borrarEventoDeCita(deps, cita);
  await avisarPorWhatsApp(deps, cita, mensajeCitaCancelada());
  return { ok: true, data: { yaCancelada: false } };
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function sumarDiasISO(fechaISO: string, dias: number): string {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export interface HorariosReprogramar {
  fecha: string;
  horarios: string[];
}

/** Horarios REALES (jornada + bloqueos + citas + Google Calendar) de la MISMA profesional y con la duración de la cita, para un día. */
export async function horariosParaReprogramar(deps: DepsMiCita, tokenCrudo: unknown, fecha: unknown): Promise<ResultadoMiCita<HorariosReprogramar>> {
  const c = await cargarContexto(deps, tokenCrudo);
  if (!c.ok) return c;
  const { cita } = c.ctx;
  if (typeof fecha !== "string" || !FECHA_RE.test(fecha)) return falla("solicitud_invalida", "La fecha no es válida.");
  const ahora = (deps.ahora ?? (() => new Date()))();
  const g = gestionDeCita(cita, ahora);
  if (!g.puedeReprogramar) return falla("cita_no_gestionable", g.aviso ?? undefined);
  if (!deps.nylas) return falla("calendario_no_disponible");
  const hoy = fechaColombiaDesdeIso(ahora.toISOString());
  if (fecha < hoy || fecha > sumarDiasISO(hoy, HORIZONTE_REPROGRAMAR_DIAS)) return falla("solicitud_invalida", "Elige una fecha dentro de los próximos 30 días.");

  const profesional = await especialistaPorId(deps.supabase, cita.especialista_id).catch(() => null);
  if (!profesional || profesional.id_tenant !== cita.id_tenant) return falla("error");
  const r = await calcularHorariosDeEspecialista(
    deps.supabase,
    { idTenant: cita.id_tenant, especialista: { id: profesional.id, nombre: profesional.nombre }, fecha, duracionMin: duracionDe(cita) },
    { nylasClient: deps.nylas.read, grantId: deps.nylas.grantId, ahora: () => ahora },
  );
  if (r.estado !== "ok") return falla("calendario_no_disponible");
  return { ok: true, data: { fecha, horarios: r.horarios } };
}

export interface ResultadoReprogramacion {
  inicio: string;
  fin: string;
  servicio: string;
  profesional: string;
}

/**
 * Mueve la cita del enlace a otra fecha/hora con la MISMA profesional. La revalidación real y el UPDATE atómico los hace actualizarCitaConNylas: lo que la
 * clienta vio como libre se vuelve a comprobar desde cero. `idempotenciaDelCliente` es una clave por INTENTO (la página genera una al confirmar): un doble clic
 * o un reintento de red no ejecuta dos veces; un intento nuevo, sí.
 */
export async function reprogramarMiCita(
  deps: DepsMiCita,
  tokenCrudo: unknown,
  entrada: { fecha: unknown; hora: unknown; idempotenciaDelCliente: unknown },
): Promise<ResultadoMiCita<ResultadoReprogramacion>> {
  const c = await cargarContexto(deps, tokenCrudo);
  if (!c.ok) return c;
  const { cita, enlace } = c.ctx;
  const { fecha, hora, idempotenciaDelCliente } = entrada;
  if (typeof fecha !== "string" || !FECHA_RE.test(fecha) || typeof hora !== "string" || !HORA_RE.test(hora)) return falla("solicitud_invalida", "La fecha o la hora no son válidas.");
  if (typeof idempotenciaDelCliente !== "string" || idempotenciaDelCliente.length < 8 || idempotenciaDelCliente.length > 100) return falla("solicitud_invalida");
  const ahora = (deps.ahora ?? (() => new Date()))();
  const g = gestionDeCita(cita, ahora);
  if (!g.puedeReprogramar) return falla("cita_no_gestionable", g.aviso ?? undefined);
  if (!deps.nylas) return falla("calendario_no_disponible");

  const nuevoInicio = new Date(`${fecha}T${hora}:00-05:00`);
  if (Number.isNaN(nuevoInicio.getTime()) || nuevoInicio.getTime() <= ahora.getTime()) return falla("horario_invalido");
  const hoy = fechaColombiaDesdeIso(ahora.toISOString());
  if (fecha > sumarDiasISO(hoy, HORIZONTE_REPROGRAMAR_DIAS)) return falla("solicitud_invalida", "Elige una fecha dentro de los próximos 30 días.");

  // Reintento de la MISMA solicitud (p. ej. la red cayó justo después de confirmar y la página reenvía): si esa clave ya se procesó con éxito y la cita ya está en
  // ese horario, se responde igual SIN repetir cambios ni avisos. Es distinto de pedir «el mismo horario» con una clave nueva (eso se rechaza abajo).
  const claveCompleta = `mi-cita:${enlace.id}:${idempotenciaDelCliente}`;
  if (nuevoInicio.getTime() === Date.parse(cita.inicio)) {
    const { data: previa } = await deps.supabase.from("dulabs_idempotencia_reservas").select("resultado_json").eq("id_tenant", cita.id_tenant).eq("idempotency_key", claveCompleta).maybeSingle();
    if ((previa?.resultado_json as { ok?: boolean } | null | undefined)?.ok === true) {
      return { ok: true, data: { inicio: cita.inicio, fin: cita.fin, servicio: await nombreDeServicios(deps, cita), profesional: await nombreDeProfesional(deps, cita) } };
    }
  }
  if (nuevoInicio.getTime() === Date.parse(cita.inicio)) return falla("horario_invalido", "Esa ya es la fecha y hora de tu cita. Elige otro horario.");

  const log = deps.log ?? logPorDefecto;
  let r;
  try {
    r = await actualizarCitaConNylas(
      deps.supabase,
      // La clave de idempotencia queda atada a ESTA cita y a este enlace: la misma clave en otra cita nunca reutiliza un resultado ajeno.
      { idTenant: cita.id_tenant, citaId: cita.id, nuevoInicio, idempotencyKey: claveCompleta },
      { nylasReadClient: deps.nylas.read, nylasWriteClient: deps.nylas.write, grantId: deps.nylas.grantId, nylasEventIdActual: await obtenerNylasEventIdDeCita(deps.supabase, cita.id) },
    );
  } catch (err) {
    log("error reprogramando la cita", err instanceof Error ? err.message : "error desconocido");
    return falla("error");
  }

  if (!r.ok) {
    switch (r.motivo) {
      case "ocupado":
        return falla("horario_ocupado");
      case "fuera_de_horario":
      case "bloqueado":
        return falla("horario_invalido");
      case "revalidacion_fallida":
      case "sin_calendario_nylas":
      case "error_creando_evento_nylas":
        return falla("calendario_no_disponible");
      case "cita_no_encontrada":
      case "no_reagendable":
      case "tenant_no_autorizado":
        return falla("cita_no_gestionable");
      case "solicitud_en_progreso":
        return falla("horario_ocupado", "Tu solicitud se está procesando. Espera un momento.");
      case "solicitud_en_conflicto":
        return falla("solicitud_invalida", "Esta solicitud ya se procesó con otros datos. Actualiza la página e intenta de nuevo.");
      default:
        log("reprogramación rechazada", { motivo: r.motivo, detalle: r.detalle });
        return falla("error");
    }
  }

  await guardarNylasEventIdDeCita(deps.supabase, cita.id, r.nylasEventId);
  await deps.store.extenderVigencia(enlace.id, vencimientoDeEnlace(r.cita.fin, ahora).toISOString()).catch(() => undefined);
  const { fechaTexto, horaTexto } = fechaTextoDe(r.cita.inicio);
  const profesional = r.especialista.nombre;
  const enlaceNuevo = await obtenerOCrearEnlace(deps.store, { idTenant: cita.id_tenant, citaId: cita.id, citaFinISO: r.cita.fin }, { ahora: () => ahora, log });
  await avisarPorWhatsApp(deps, cita, mensajeCitaReprogramada({ servicio: r.servicio.nombre, profesional, fechaTexto, horaTexto, urlEnlace: enlaceNuevo?.url ?? null }));
  return { ok: true, data: { inicio: r.cita.inicio, fin: r.cita.fin, servicio: r.servicio.nombre, profesional } };
}
