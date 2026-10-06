/**
 * AMORE — reserva desde el portal público (/reservar/amore) sobre el MISMO motor real que usan el chat y el panel: crearCitaConNylas.
 *
 * Por qué existe: el portal usaba el motor genérico (reservarCitaPorServicio), que NO mira Google Calendar y NO crea el evento. Una reserva del portal no
 * bloqueaba el calendario de la profesional y un evento de Google no bloqueaba el portal (dos fuentes de verdad). Además guardaba la cita con el
 * phone_number_id legacy de Meta y el teléfono tal como lo escribió la clienta, así que la gestión por WhatsApp (que busca por «whatsapp-qr:<negocio>» y el
 * teléfono normalizado) NUNCA encontraba las citas hechas por el enlace.
 *
 * Ahora, para AMORE: revalidación real (jornada + bloqueos + citas + eventos de Google Calendar) -> evento en Google -> cita en DuLabs (EXCLUDE de Postgres)
 * con la MISMA identidad que el chat -> enlace personal «Mi cita» -> confirmación por WhatsApp con ese enlace. Si no hay integración de calendario, FALLA
 * CERRADO (nunca se reserva a ciegas). Cualquier otro negocio sigue exactamente por su camino de siempre (esta función no se invoca para ellos).
 */
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { crearCitaConNylas } from "@/lib/reserva-servicio-nylas";
import { ejecutarConIdempotencia, huellaSolicitud } from "@/lib/idempotencia-reserva";
import { guardarNylasEventIdDeCita } from "@/lib/agenda-v2/citas-nylas";
import { MAX_SERVICIOS_POR_CITA } from "@/lib/agenda-v2/servicios";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import { AMORE_TENANT_ID, phoneNumberIdWhatsappQr } from "@/lib/nylas/nylas-grant";
import { enviarConfirmacionReservaWhatsApp } from "@/lib/reserva-notificaciones-whatsapp";
import { normalizarTelefono } from "@/lib/marketplace-store";
import { obtenerOCrearEnlace, type EnlacesStore } from "@/lib/mi-cita/enlaces";
import type { NylasMiCita } from "@/lib/mi-cita/gestion";

export interface EntradaReservaPortalAmore {
  /** Servicio principal de la cita (el primero que eligió la clienta). */
  servicioId: string;
  /** 0 a 2 servicios MÁS en la MISMA cita (ej. uñas de manos + de pies): una sola profesional que haga todos, un bloque continuo con la duración sumada. */
  serviciosIdsAdicionales?: string[];
  especialistaId: number;
  inicio: Date;
  nombreCliente: string;
  telefonoCliente: string;
  correoCliente?: string;
  fechaNacimientoDia?: number;
  fechaNacimientoMes?: number;
  idempotencyKey: string;
}

export interface DepsReservaPortalAmore {
  supabase: SupabaseClient;
  store: EnlacesStore;
  nylas: NylasMiCita | null;
  enviarConfirmacion?: typeof enviarConfirmacionReservaWhatsApp;
  ahora?: () => Date;
}

export interface ExitoReservaPortalAmore {
  codigo: string;
  servicio: string;
  profesional: string;
  inicio: string;
  fin: string;
  duracionMin: number;
  /** Enlace personal para gestionar la cita; null si no se pudo emitir (la reserva igual quedó hecha). */
  enlaceGestion: string | null;
}

export type ResultadoReservaPortalAmore = { ok: true; data: ExitoReservaPortalAmore } | { ok: false; status: number; error: string };

/**
 * Textos de rechazo de la reserva del portal de AMORE. La frase de «ocupado» es la que reconoce la pantalla de confirmación para ofrecer «elegir otro
 * horario» (portal-amore: `errorReserva.includes("acaba de ser reservado")`).
 */
const MENSAJES: Record<string, { status: number; error: string }> = {
  servicio_no_encontrado: { status: 409, error: "El servicio seleccionado ya no está disponible." },
  especialista_no_encontrado: { status: 409, error: "Ese profesional ya no está disponible." },
  especialista_no_habilitado: { status: 409, error: "Este profesional ya no está disponible para este servicio." },
  fuera_de_horario: { status: 409, error: "Este horario ya no está disponible." },
  bloqueado: { status: 409, error: "Este horario ya no está disponible." },
  ocupado: { status: 409, error: "Este horario acaba de ser reservado. Por favor selecciona otro." },
  revalidacion_fallida: { status: 503, error: "No pudimos confirmar la disponibilidad en este momento. Por favor intenta de nuevo en unos minutos." },
  sin_calendario_nylas: { status: 503, error: "No pudimos confirmar la disponibilidad en este momento. Por favor intenta de nuevo en unos minutos." },
  error_creando_evento_nylas: { status: 503, error: "No pudimos confirmar la disponibilidad en este momento. Por favor intenta de nuevo en unos minutos." },
  solicitud_en_progreso: { status: 409, error: "Tu solicitud se está procesando, espera un momento." },
  solicitud_en_conflicto: { status: 409, error: "Esta solicitud ya se procesó con datos diferentes. Actualiza la página e intenta de nuevo." },
};
/** Con varios servicios en la cita, estos dos rechazos hablan de la combinación (los demás textos sirven igual). */
const MENSAJES_VARIOS_SERVICIOS: Record<string, { status: number; error: string }> = {
  servicio_no_encontrado: { status: 409, error: "Alguno de los servicios seleccionados ya no está disponible." },
  especialista_no_habilitado: { status: 409, error: "Este profesional ya no está disponible para esta combinación de servicios." },
};
const MENSAJE_GENERICO = { status: 409, error: "Hubo un problema al reservar. Por favor intenta nuevamente." };
const SIN_CALENDARIO = { status: 503, error: "Las reservas en línea no están disponibles en este momento. Por favor intenta de nuevo más tarde." };

/** Referencia corta para la clienta. NO es el id de la cita (no revela cuántas hay) ni una credencial: es solo un código para mencionar al hablar con el salón. */
export function codigoDeReferencia(citaId: number): string {
  return `A-${createHash("sha256").update(`amore-cita:${citaId}`).digest("hex").slice(0, 6).toUpperCase()}`;
}

/** Un teléfono que sirva para escribirle por WhatsApp: dígitos con indicativo (10 dígitos colombianos -> 57…) y entre 10 y 15 en total. */
export function telefonoParaReserva(crudo: string): string | null {
  const t = normalizarTelefono(crudo);
  return /^\d{10,15}$/.test(t) ? t : null;
}

export async function reservarPorPortalAmore(deps: DepsReservaPortalAmore, e: EntradaReservaPortalAmore): Promise<ResultadoReservaPortalAmore> {
  if (!deps.nylas) return { ok: false, ...SIN_CALENDARIO };
  const telefono = telefonoParaReserva(e.telefonoCliente);
  if (!telefono) return { ok: false, status: 400, error: "Escribe un número de WhatsApp válido, con el indicativo si no es de Colombia." };
  // Los servicios de la cita: de 1 a MAX_SERVICIOS_POR_CITA, sin repetir. La pantalla no deja otra cosa, pero la API se puede llamar directamente.
  const serviciosIds = [e.servicioId, ...(e.serviciosIdsAdicionales ?? [])];
  if (serviciosIds.length > MAX_SERVICIOS_POR_CITA || new Set(serviciosIds).size !== serviciosIds.length) {
    return { ok: false, status: 400, error: `Elige entre 1 y ${MAX_SERVICIOS_POR_CITA} servicios distintos.` };
  }
  const variosServicios = serviciosIds.length > 1;
  const nylas = deps.nylas;
  const ahora = (deps.ahora ?? (() => new Date()))();
  // Nunca una cita en el pasado (la pantalla solo ofrece horarios futuros, pero la API se puede llamar directamente).
  if (!(e.inicio.getTime() > ahora.getTime())) return { ok: false, ...MENSAJES.fuera_de_horario };
  const enviarConfirmacion = deps.enviarConfirmacion ?? enviarConfirmacionReservaWhatsApp;
  const idTenant = AMORE_TENANT_ID;

  // Idempotencia de TODO el flujo (incluidos los avisos): un doble clic o un reintento con la misma clave devuelve lo mismo SIN repetir WhatsApp.
  // Solo se guarda lo serializable y sin secretos; el enlace (que contiene el token) se vuelve a obtener —es el mismo— y nunca queda en esa caché.
  type Guardado = { ok: true; citaId: number; servicio: string; profesional: string; inicio: string; fin: string; duracionMin: number } | { ok: false; motivo: string };
  // Con un solo servicio la huella es la de siempre (join de uno = ese mismo id): una clave ya usada no cambia de significado.
  const huella = huellaSolicitud([idTenant, serviciosIds.join(","), e.especialistaId, e.inicio.toISOString(), telefono, e.nombreCliente]);
  const r = await ejecutarConIdempotencia<Guardado>(deps.supabase, {
    idTenant,
    idempotencyKey: `portal:${e.idempotencyKey}`,
    huella,
    operacion: async (): Promise<Guardado> => {
      const creada = await crearCitaConNylas(
        deps.supabase,
        {
          idTenant,
          servicioId: e.servicioId,
          serviciosIdsAdicionales: variosServicios ? serviciosIds.slice(1) : undefined,
          especialistaId: e.especialistaId,
          inicio: e.inicio,
          nombreCliente: e.nombreCliente,
          telefonoCliente: telefono,
          idempotencyKey: e.idempotencyKey,
        },
        { nylasReadClient: nylas.read, nylasWriteClient: nylas.write, grantId: nylas.grantId },
      );
      if (!creada.ok) {
        if (creada.motivo === "inconsistencia_requiere_revision_manual" || creada.motivo === "error_de_base_de_datos") console.error("[reservar-portal] AMORE:", creada.motivo, creada.detalle);
        return { ok: false, motivo: creada.motivo };
      }
      await guardarNylasEventIdDeCita(deps.supabase, creada.cita.id, creada.nylasEventId);
      // La clienta queda EXACTAMENTE igual que una que escribió por WhatsApp (misma identidad): así el bot ya la reconoce al cancelar, cambiar o consultar.
      await recordarNombreCliente(deps.supabase, {
        idTenant,
        phoneNumberId: phoneNumberIdWhatsappQr(idTenant),
        telefonoCliente: telefono,
        nombre: e.nombreCliente,
        correo: e.correoCliente,
        cumpleDia: e.fechaNacimientoDia,
        cumpleMes: e.fechaNacimientoMes,
      });
      const enlace = await obtenerOCrearEnlace(deps.store, { idTenant, citaId: creada.cita.id, citaFinISO: creada.cita.fin }, { ahora: () => ahora });
      // «Tu cita ha sido confirmada» solo si de verdad quedó confirmada (una profesional con requiere_aprobacion la deja pendiente): nunca se afirma algo falso.
      if (creada.cita.estado === "confirmada") {
        await enviarConfirmacion(deps.supabase, idTenant, telefono, { servicio: creada.servicio.nombre, profesional: creada.especialista.nombre, inicioISO: creada.cita.inicio, enlaceGestion: enlace?.url ?? null });
      }
      return { ok: true, citaId: creada.cita.id, servicio: creada.servicio.nombre, profesional: creada.especialista.nombre, inicio: creada.cita.inicio, fin: creada.cita.fin, duracionMin: creada.servicio.duracionMin };
    },
  });

  if (r.estado === "conflicto") return { ok: false, ...MENSAJES.solicitud_en_conflicto };
  if (r.estado === "en_progreso") return { ok: false, ...MENSAJES.solicitud_en_progreso };
  const g = r.resultado;
  if (!g.ok) return { ok: false, ...((variosServicios ? MENSAJES_VARIOS_SERVICIOS[g.motivo] : undefined) ?? MENSAJES[g.motivo] ?? MENSAJE_GENERICO) };

  const enlace = await obtenerOCrearEnlace(deps.store, { idTenant, citaId: g.citaId, citaFinISO: g.fin }, { ahora: () => ahora });
  return { ok: true, data: { codigo: codigoDeReferencia(g.citaId), servicio: g.servicio, profesional: g.profesional, inicio: g.inicio, fin: g.fin, duracionMin: g.duracionMin, enlaceGestion: enlace?.url ?? null } };
}
