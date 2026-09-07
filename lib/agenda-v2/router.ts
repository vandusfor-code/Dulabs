/**
 * AGENDA V2 (autorizado) — router central de aislamiento. ÚNICO punto que
 * decide "esta conversación es de Agenda V2 o del comportamiento normal de
 * AMORE" -- se llama desde app/api/whatsapp-qr-bot/route.ts, ANTES de
 * ejecutarBotWhatsAppQR (Flow Engine). Mientras exista una sesión activa,
 * NINGÚN mensaje de esa conversación llega a resolverEscenario/
 * resolverEscenarioGanador/Gemini/Claude del bot normal -- queda resuelto
 * acá, por completo.
 *
 * Reutiliza EXACTAMENTE (nunca duplica):
 * - adquirirCandadoChat/liberarCandadoChat (lib/chat-lock.ts) -- mismo
 *   candado real que ya usa el webhook de Cloud API, con la MISMA
 *   convención de phone_number_id sintético que ya usa WhatsApp-QR
 *   ("whatsapp-qr:<tenantId>", ver lib/whatsapp-qr-bot.ts).
 * - cargarEscenariosReal (lib/bot-escenarios/store.ts) + esInicioDeAgendaV2
 *   (mismas variantes reales de CODIGO_ESCENARIO_AGENDAMIENTO).
 * - enviarMensajeWhatsApp (lib/whatsapp-worker-client.ts) -- mismo cliente
 *   que ya usa ejecutarBotWhatsAppQR para responder.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { adquirirCandadoChat, liberarCandadoChat } from "@/lib/chat-lock";
import { cargarEscenariosReal } from "@/lib/bot-escenarios/store";
import { listarCatalogoServiciosReal } from "@/lib/catalogo-servicios-flow-adaptador";
import { resolverEspecialistasElegiblesParaServicio } from "@/lib/asignacion-categoria";
import { resolverNylasGrantIdParaTenant } from "@/lib/nylas/nylas-grant";
import { createNylasEventsClient, createNylasEventsWriteClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import type { DepsDisponibilidadNylas } from "@/lib/disponibilidad-servicio-nylas";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";
import { esInicioDeAgendaV2 } from "@/lib/agenda-v2/entrada";
import { manejarMensajeAgendaV2 } from "@/lib/agenda-v2/controlador";
import { construirOpcionesServicio, renderizarMenuServicio } from "@/lib/agenda-v2/servicios";
import { construirOpcionesCategoria, renderizarMenuCategoria } from "@/lib/agenda-v2/categorias";
import { construirOpcionesProfesional, renderizarMenuProfesional } from "@/lib/agenda-v2/profesionales";
import { renderizarMenuFecha, formatearFechaLarga } from "@/lib/agenda-v2/fechas";
import { construirOpcionesHora, renderizarMenuHora } from "@/lib/agenda-v2/horas";
import {
  OPCIONES_CONFIRMACION,
  renderizarResumenConfirmacion,
  renderizarConfirmacionExitosa,
  MENSAJE_HORARIO_RECIEN_OCUPADO,
  MENSAJE_ERROR_TECNICO_CONFIRMACION,
  type ResumenCitaAgendaV2,
} from "@/lib/agenda-v2/confirmacion";
import { calcularDiasCandidatosReales, calcularHorariosParaFecha } from "@/lib/agenda-v2/disponibilidad";
import { formatearHoraAmPm } from "@/lib/especialistas-flow-adaptador";
import { buscarSesionActivaAgendaV2, crearSesionAgendaV2, cerrarSesionAgendaV2, actualizarSesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
// FASE 7 (autorizado) -- creación REAL de la reserva. Reutilizada TAL CUAL
// (sin ningún cambio): revalidación + crearCitaEspecialista (EXCLUDE de
// Postgres) + idempotencia (dulabs_idempotencia_reservas) ya viven ahí,
// mismo mecanismo EXACTO que ya usa lib/flow/executors/internal-action-executor.ts
// para Daniela -- nunca una segunda implementación de reservas.
import { crearCitaConNylas, actualizarCitaConNylas } from "@/lib/reserva-servicio-nylas";
// Mismo criterio que el resto de Agenda V2 (nunca pedir de nuevo un dato que
// el sistema ya conoce): resuelve un nombre real ya dado antes por esta
// clienta bajo el MISMO phone_number_id sintético; si nunca lo dio, se usa
// su teléfono como identificación (Agenda V2 no agrega un paso nuevo para
// pedir el nombre -- fuera del alcance autorizado de esta fase).
import { nombreConocido } from "@/lib/clientes-conocidos";
// FASE 8 (autorizado) -- gestión de citas existentes. Reutiliza TAL CUAL:
// - consultarCitasActivasEspecialista/cancelarCitaEspecialista
//   (lib/especialistas-flow-adaptador.ts) -- MISMO mecanismo exacto que ya
//   usa Daniela (internal-action-executor.ts) para listar/cancelar citas
//   reales, incluida la validación de propiedad (citaPorIdYCliente) antes de
//   tocar nada.
// - especialistaPorId (lib/especialistas.ts) -- mismo lookup ya usado en
//   toda la plataforma.
// - resolverCalendarIdNylasDeEspecialista (lib/nylas/nylas-calendario-especialista.ts)
//   -- mismo resolver exacto que ya usa crearCitaConNylas.
import { consultarCitasActivasEspecialista, cancelarCitaEspecialista } from "@/lib/especialistas-flow-adaptador";
import { especialistaPorId, type CitaEspecialista } from "@/lib/especialistas";
import { resolverCalendarIdNylasDeEspecialista } from "@/lib/nylas/nylas-calendario-especialista";
import { fechaColombiaDesdeIso, horaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { detectarIntencionGestionCitas, type AccionGestionCitasDetectada } from "@/lib/agenda-v2/entrada";
import {
  construirOpcionesCita,
  renderizarMenuCitas,
  renderizarConsultaCita,
  renderizarConfirmacionCancelar,
  renderizarConfirmacionReprogramarInicio,
  renderizarReprogramacionExitosa,
  OPCIONES_SI_NO,
  MENSAJE_SIN_CITAS_FUTURAS,
  MENSAJE_CITA_CANCELADA,
  MENSAJE_ERROR_CANCELACION,
  MENSAJE_ERROR_REPROGRAMACION,
  MENSAJE_ERROR_TECNICO_GESTION,
  type CitaParaMenu,
} from "@/lib/agenda-v2/gestion-citas";
import { renderizarResumenCambio } from "@/lib/agenda-v2/confirmacion";
import { guardarNylasEventIdDeCita, obtenerNylasEventIdDeCita, borrarNylasEventIdDeCita } from "@/lib/agenda-v2/citas-nylas";

/** Mismo prefijo sintético que ya usa lib/whatsapp-qr-bot.ts para el candado/estado de este canal -- nunca un phone_number_id real de Meta. */
function phoneNumberIdSintetico(tenantId: string): string {
  return `whatsapp-qr:${tenantId}`;
}

export interface AgendaV2RouterDeps {
  adquirirCandadoChat?: typeof adquirirCandadoChat;
  liberarCandadoChat?: typeof liberarCandadoChat;
  cargarEscenariosReal?: typeof cargarEscenariosReal;
  cargarCatalogoReal?: typeof listarCatalogoServiciosReal;
  resolverEspecialistas?: typeof resolverEspecialistasElegiblesParaServicio;
  // FASES 4/5 -- resolución del grant/API key/cliente de Nylas, MISMO
  // criterio exacto que ya usa lib/flow/executors/internal-action-executor.ts
  // (nunca una segunda forma de resolverlos). Inyectables para tests, nunca
  // para producción real.
  resolverNylasGrantIdParaTenant?: typeof resolverNylasGrantIdParaTenant;
  resolveNylasApiKeyFromEnv?: typeof resolveNylasApiKeyFromEnv;
  createNylasEventsClient?: typeof createNylasEventsClient;
  calcularDiasCandidatos?: typeof calcularDiasCandidatosReales;
  calcularHorariosFecha?: typeof calcularHorariosParaFecha;
  enviarMensajeWhatsApp?: typeof enviarMensajeWhatsApp;
  buscarSesionActiva?: typeof buscarSesionActivaAgendaV2;
  crearSesion?: typeof crearSesionAgendaV2;
  cerrarSesion?: typeof cerrarSesionAgendaV2;
  actualizarSesion?: typeof actualizarSesionAgendaV2;
  // FASE 7 -- inyectables para tests (nunca reservas/Nylas reales fuera de
  // producción real), mismo criterio exacto de arriba.
  createNylasEventsWriteClient?: typeof createNylasEventsWriteClient;
  crearCitaConNylas?: typeof crearCitaConNylas;
  buscarNombreConocido?: typeof nombreConocido;
  // FASE 8 -- inyectables para tests, mismo criterio exacto de arriba.
  consultarCitasActivas?: typeof consultarCitasActivasEspecialista;
  cancelarCitaEspecialista?: typeof cancelarCitaEspecialista;
  especialistaPorId?: typeof especialistaPorId;
  resolverCalendarIdNylasDeEspecialista?: typeof resolverCalendarIdNylasDeEspecialista;
  actualizarCitaConNylas?: typeof actualizarCitaConNylas;
  guardarNylasEventIdDeCita?: typeof guardarNylasEventIdDeCita;
  obtenerNylasEventIdDeCita?: typeof obtenerNylasEventIdDeCita;
  borrarNylasEventIdDeCita?: typeof borrarNylasEventIdDeCita;
}

export type ResultadoRouterAgendaV2 =
  | { manejado: true }
  | { manejado: false };

/**
 * Único punto de entrada. Devuelve `manejado:false` SOLO cuando de verdad
 * no hay ninguna sesión activa Y el mensaje tampoco dispara el inicio --
 * en ese caso, y SOLO en ese caso, el caller (route.ts) sigue con
 * ejecutarBotWhatsAppQR exactamente como hoy.
 */
export async function procesarMensajeConAgendaV2(
  params: {
    supabase: SupabaseClient;
    idTenant: string;
    telefono: string;
    texto: string;
    wamid: string;
  },
  deps: AgendaV2RouterDeps = {},
): Promise<ResultadoRouterAgendaV2> {
  const adquirir = deps.adquirirCandadoChat ?? adquirirCandadoChat;
  const liberar = deps.liberarCandadoChat ?? liberarCandadoChat;
  const cargarEscenarios = deps.cargarEscenariosReal ?? cargarEscenariosReal;
  const cargarCatalogo = deps.cargarCatalogoReal ?? listarCatalogoServiciosReal;
  const resolverEspecialistas = deps.resolverEspecialistas ?? resolverEspecialistasElegiblesParaServicio;
  const resolverGrantId = deps.resolverNylasGrantIdParaTenant ?? resolverNylasGrantIdParaTenant;
  const resolverApiKey = deps.resolveNylasApiKeyFromEnv ?? resolveNylasApiKeyFromEnv;
  const crearNylasClient = deps.createNylasEventsClient ?? createNylasEventsClient;
  const calcularDias = deps.calcularDiasCandidatos ?? calcularDiasCandidatosReales;
  const calcularHoras = deps.calcularHorariosFecha ?? calcularHorariosParaFecha;
  const enviarMensaje = deps.enviarMensajeWhatsApp ?? enviarMensajeWhatsApp;
  const buscarSesionActiva = deps.buscarSesionActiva ?? buscarSesionActivaAgendaV2;
  const crearSesion = deps.crearSesion ?? crearSesionAgendaV2;
  const cerrarSesion = deps.cerrarSesion ?? cerrarSesionAgendaV2;
  const actualizarSesion = deps.actualizarSesion ?? actualizarSesionAgendaV2;
  const crearNylasWriteClient = deps.createNylasEventsWriteClient ?? createNylasEventsWriteClient;
  const crearCitaReal = deps.crearCitaConNylas ?? crearCitaConNylas;
  const buscarNombreConocidoDep = deps.buscarNombreConocido ?? nombreConocido;
  const consultarCitasActivas = deps.consultarCitasActivas ?? consultarCitasActivasEspecialista;
  const cancelarCitaEspecialistaDep = deps.cancelarCitaEspecialista ?? cancelarCitaEspecialista;
  const especialistaPorIdDep = deps.especialistaPorId ?? especialistaPorId;
  const resolverCalendarIdDep = deps.resolverCalendarIdNylasDeEspecialista ?? resolverCalendarIdNylasDeEspecialista;
  const actualizarCitaReal = deps.actualizarCitaConNylas ?? actualizarCitaConNylas;
  const guardarNylasEventIdDep = deps.guardarNylasEventIdDeCita ?? guardarNylasEventIdDeCita;
  const obtenerNylasEventIdDep = deps.obtenerNylasEventIdDeCita ?? obtenerNylasEventIdDeCita;
  const borrarNylasEventIdDep = deps.borrarNylasEventIdDeCita ?? borrarNylasEventIdDeCita;

  const phoneNumberId = phoneNumberIdSintetico(params.idTenant);

  // FASE 8 (autorizado) -- helpers de gestión de citas, compartidos tanto
  // por el punto de entrada (sin sesión activa, trigger detectado) como por
  // la resolución de SG_SELECCIONAR_CITA/SG_CANCELAR_CONFIRMAR/
  // SG_REPROGRAMAR_CONFIRMAR_INICIO (sesión ya activa) -- nunca dos
  // implementaciones distintas de lo mismo.

  /** Datos cortos reales de una cita (servicio/profesional/fecha/hora), para los resúmenes de consultar/cancelar/reprogramar. `null` si el especialista ya no existe (nunca inventa). */
  async function datosCortosCita(
    cita: CitaEspecialista,
  ): Promise<{ servicioNombre: string; profesionalNombre: string; fechaEtiqueta: string; horaTexto: string; fechaIso: string; hora: string } | null> {
    const especialista = await especialistaPorIdDep(params.supabase, cita.especialista_id);
    if (!especialista) return null;
    const fechaIso = fechaColombiaDesdeIso(cita.inicio);
    const hora = horaColombiaDesdeIso(cita.inicio);
    return {
      servicioNombre: cita.servicio,
      profesionalNombre: especialista.nombre,
      fechaEtiqueta: formatearFechaLarga(fechaIso),
      horaTexto: formatearHoraAmPm(hora),
      fechaIso,
      hora,
    };
  }

  /** Arma el menú "encontré estas citas" para varias citas reales. `null` si algún especialista ya no existe (defensivo, nunca inventa). */
  async function construirMenuVariasCitas(citas: CitaEspecialista[]): Promise<CitaParaMenu[] | null> {
    const items: CitaParaMenu[] = [];
    for (const cita of citas) {
      const datos = await datosCortosCita(cita);
      if (!datos) return null;
      items.push({ citaId: cita.id, servicioNombre: datos.servicioNombre, profesionalNombre: datos.profesionalNombre, fechaEtiqueta: datos.fechaEtiqueta, horaTexto: datos.horaTexto });
    }
    return items;
  }

  /**
   * Ya se sabe CUÁL cita real y QUÉ acción (consultar/cancelar/reprogramar)
   * -- arma la respuesta/transición correspondiente. `sesionExistente` es la
   * sesión SG_SELECCIONAR_CITA ya creada (si venía de un menú de varias
   * citas) o `null` (camino rápido de una sola cita, sección
   * "IDENTIFICACIÓN DE LA CITA" del pedido: "Si existe una única cita
   * futura -> utilizarla directamente").
   */
  async function continuarGestionCita(
    cita: CitaEspecialista,
    accion: AccionGestionCitasDetectada,
    sesionExistente: { id: number } | null,
  ): Promise<ResultadoRouterAgendaV2> {
    const datos = await datosCortosCita(cita);
    if (!datos) {
      if (sesionExistente) await cerrarSesion(params.supabase, sesionExistente.id);
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_TECNICO_GESTION, origen: "automatico" });
      return { manejado: true };
    }

    if (accion === "consultar") {
      // Sección "CONSULTAR CITA" del pedido -- nunca crea sesión innecesaria:
      // si venía de SG_SELECCIONAR_CITA, se cierra (la consulta ya se resolvió).
      if (sesionExistente) await cerrarSesion(params.supabase, sesionExistente.id);
      const catalogo = await cargarCatalogo(params.supabase, params.idTenant);
      const servicioCatalogo = cita.servicio_id ? catalogo.find((s) => s.id === cita.servicio_id) : undefined;
      if (!servicioCatalogo || (cita.estado !== "pendiente" && cita.estado !== "confirmada")) {
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_TECNICO_GESTION, origen: "automatico" });
        return { manejado: true };
      }
      const duracionMin = Math.round((new Date(cita.fin).getTime() - new Date(cita.inicio).getTime()) / 60_000);
      await enviarMensaje({
        tenantId: params.idTenant,
        telefono: params.telefono,
        mensaje: renderizarConsultaCita({
          servicioNombre: datos.servicioNombre,
          profesionalNombre: datos.profesionalNombre,
          fechaEtiqueta: datos.fechaEtiqueta,
          horaTexto: datos.horaTexto,
          duracionMin,
          precio: servicioCatalogo.precio,
          estado: cita.estado,
        }),
        origen: "automatico",
      });
      return { manejado: true };
    }

    if (accion === "cancelar") {
      const opciones = OPCIONES_SI_NO;
      if (sesionExistente) {
        await actualizarSesion(params.supabase, sesionExistente.id, {
          step: "SG_CANCELAR_CONFIRMAR",
          citaObjetivoId: cita.id,
          opcionesMostradas: opciones,
          ultimoWamidProcesado: params.wamid,
        });
      } else {
        await crearSesion(params.supabase, {
          tenantId: params.idTenant,
          telefonoCliente: params.telefono,
          wamid: params.wamid,
          step: "SG_CANCELAR_CONFIRMAR",
          citaObjetivoId: cita.id,
          opcionesMostradas: opciones,
        });
      }
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: renderizarConfirmacionCancelar(datos), origen: "automatico" });
      return { manejado: true };
    }

    // accion === "reprogramar"
    const opcionesReprogramar = OPCIONES_SI_NO;
    if (sesionExistente) {
      await actualizarSesion(params.supabase, sesionExistente.id, {
        step: "SG_REPROGRAMAR_CONFIRMAR_INICIO",
        citaObjetivoId: cita.id,
        opcionesMostradas: opcionesReprogramar,
        ultimoWamidProcesado: params.wamid,
      });
    } else {
      await crearSesion(params.supabase, {
        tenantId: params.idTenant,
        telefonoCliente: params.telefono,
        wamid: params.wamid,
        step: "SG_REPROGRAMAR_CONFIRMAR_INICIO",
        citaObjetivoId: cita.id,
        opcionesMostradas: opcionesReprogramar,
      });
    }
    await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: renderizarConfirmacionReprogramarInicio(datos), origen: "automatico" });
    return { manejado: true };
  }

  /** Punto de entrada de un trigger de gestión SIN sesión activa (sección "IDENTIFICACIÓN DE LA CITA" del pedido). */
  async function iniciarGestionCitas(accion: AccionGestionCitasDetectada): Promise<ResultadoRouterAgendaV2> {
    const resultadoCitas = await consultarCitasActivas(params.supabase, { phoneNumberId, telefonoCliente: params.telefono });
    const citas = resultadoCitas.citas;

    if (citas.length === 0) {
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_SIN_CITAS_FUTURAS, origen: "automatico" });
      return { manejado: true };
    }

    if (citas.length === 1) {
      return await continuarGestionCita(citas[0]!, accion, null);
    }

    const items = await construirMenuVariasCitas(citas);
    if (!items) {
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_TECNICO_GESTION, origen: "automatico" });
      return { manejado: true };
    }
    const opciones = construirOpcionesCita(items);
    await crearSesion(params.supabase, {
      tenantId: params.idTenant,
      telefonoCliente: params.telefono,
      wamid: params.wamid,
      step: "SG_SELECCIONAR_CITA",
      accionGestion: accion,
      opcionesMostradas: opciones,
    });
    await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: renderizarMenuCitas(opciones), origen: "automatico" });
    return { manejado: true };
  }

  // Sección 7 del pedido -- el candado cubre EXACTAMENTE la lectura +
  // decisión + escritura de la sesión (nunca más que eso: si el mensaje NO
  // es de Agenda V2, se libera antes de que route.ts llame a
  // ejecutarBotWhatsAppQR, que sigue sin ningún candado, sin cambios).
  await adquirir(phoneNumberId, params.telefono, params.wamid);
  try {
    let sesion;
    try {
      sesion = await buscarSesionActiva(params.supabase, params.idTenant, params.telefono);
    } catch (err) {
      // Defensivo (mismo criterio EXACTO que adquirirCandadoChat, lib/chat-lock.ts,
      // para "la tabla todavía no existe") -- Agenda V2 es una capa ADITIVA
      // delante de TODO el tráfico de WhatsApp-QR de TODOS los tenants: si
      // esta consulta falla (ej. la migración de dulabs_agenda_v2_sesiones
      // todavía no se aplicó en producción), nunca debe romper el canal
      // completo. Se deja pasar al comportamiento normal -- el peor caso es
      // que Agenda V2 no intercepte ese mensaje puntual, nunca que AMORE (o
      // cualquier otro tenant) deje de responder por completo.
      console.error("[agenda-v2] error buscando sesión activa -- se deja pasar al comportamiento normal", err);
      return { manejado: false };
    }

    // Sección 14 del pedido -- mismo wamid ya procesado por esta sesión
    // (incluida la que la creó): nunca se reprocesa ni se reenvía nada.
    if (sesion && sesion.ultimoWamidProcesado === params.wamid) {
      return { manejado: true };
    }

    if (sesion) {
      // FASES 4/5 -- MISMO criterio exacto de resolución de Nylas que ya usa
      // lib/flow/executors/internal-action-executor.ts (nunca una segunda
      // forma): sin grant_id o sin API key, no hay forma de confirmar
      // disponibilidad real contra el calendario -- se trata como "sin
      // conexión con el calendario", nunca se ofrece un día/hora a ciegas.
      function construirNylasDeps(): DepsDisponibilidadNylas | null {
        const grantId = resolverGrantId(params.idTenant);
        const apiKey = resolverApiKey();
        if (!grantId || !apiKey) return null;
        return { nylasClient: crearNylasClient(apiKey), grantId };
      }

      // Defensivo -- nunca debería ocurrir (S2_PROFESIONAL/S3_DIA/S4_HORA
      // siempre llegan con servicioId/profesionalId ya fijados por la fase
      // anterior), pero si pasara, nunca se inventa nada: se reinicia la
      // sesión a categorías reales, igual que el resto de los casos
      // defensivos de Agenda V2.
      async function reiniciarPorEstadoInconsistente(motivo: string): Promise<ResultadoRouterAgendaV2> {
        console.error(`[agenda-v2] estado inconsistente (${motivo}) -- se reinicia a categorías`);
        const catalogo = await cargarCatalogo(params.supabase, params.idTenant);
        const categoriasActualizadas = construirOpcionesCategoria(catalogo);
        await actualizarSesion(params.supabase, sesion!.id, {
          step: "S1_SERVICIO",
          servicioId: null,
          profesionalId: null,
          fechaIso: null,
          slotSeleccionado: null,
          opcionesMostradas: categoriasActualizadas,
          ultimoWamidProcesado: params.wamid,
          // FASE 8 -- un reinicio defensivo es un reinicio COMPLETO: nunca
          // debe dejar un citaObjetivoId/accionGestion de una gestión de
          // citas a medias colgando de una sesión que ahora vuelve a ser una
          // reserva nueva desde cero (evitaría, por ejemplo, que un
          // confirmar posterior intente "reprogramar" una cita ajena a esta
          // nueva selección).
          citaObjetivoId: null,
          accionGestion: null,
        });
        await enviarMensaje({
          tenantId: params.idTenant,
          telefono: params.telefono,
          mensaje: `Ocurrió un problema con tu selección 😅 Empecemos de nuevo, elige una categoría:\n\n${renderizarMenuCategoria(categoriasActualizadas)}`,
          origen: "automatico",
        });
        return { manejado: true };
      }

      // FASE 4 (autorizado) -- reutilizada TAL CUAL tanto para avanzar
      // (profesional_seleccionado) como para retroceder desde S5_CONFIRMAR
      // (confirmacion_cambiar_fecha, FASE 6) -- "no duplicar lógica" del
      // pedido de la Fase 6. Calcula los días candidatos REALES para
      // `profesionalId` y, si no hay ninguno, revierte a S2_PROFESIONAL
      // mostrando los profesionales reales de nuevo (mismo criterio en
      // ambos casos de uso).
      async function mostrarMenuFechaOVolverAProfesional(servicioId: string, profesionalId: number): Promise<ResultadoRouterAgendaV2> {
        const nylasDeps = construirNylasDeps();
        const diasResultado = await calcularDias(params.supabase, { idTenant: params.idTenant, servicioId, profesionalId }, nylasDeps);

        if (!diasResultado.ok || diasResultado.opciones.length === 0) {
          if (sesion!.citaObjetivoId) {
            // FASE 8 (sección "CAMBIO DE PROFESIONAL" del pedido) -- una
            // reprogramación NUNCA cambia de profesional. Si no hay más días
            // reales disponibles con ESTA profesional, se informa y se deja
            // un punto muerto seguro -- la cita ORIGINAL nunca se toca.
            await actualizarSesion(params.supabase, sesion!.id, {
              step: "S3_DIA",
              fechaIso: null,
              slotSeleccionado: null,
              opcionesMostradas: [],
              ultimoWamidProcesado: params.wamid,
            });
            await enviarMensaje({
              tenantId: params.idTenant,
              telefono: params.telefono,
              mensaje: "No encontramos más días disponibles para reprogramar con esta profesional en este momento 😔 Tu cita original sigue intacta. Escribe *cancelar* y vuelve a intentarlo más tarde.",
              origen: "automatico",
            });
            return { manejado: true };
          }
          const resolucion = await resolverEspecialistas(params.supabase, params.idTenant, servicioId);
          const opcionesProfesional = construirOpcionesProfesional(resolucion.especialistas);
          await actualizarSesion(params.supabase, sesion!.id, {
            step: "S2_PROFESIONAL",
            profesionalId: null,
            fechaIso: null,
            slotSeleccionado: null,
            opcionesMostradas: opcionesProfesional,
            ultimoWamidProcesado: params.wamid,
          });
          await enviarMensaje({
            tenantId: params.idTenant,
            telefono: params.telefono,
            mensaje:
              opcionesProfesional.length > 0
                ? `No encontramos días disponibles con esa profesional en los próximos días 😔 Elige otra:\n\n${renderizarMenuProfesional(opcionesProfesional)}`
                : "No encontramos días disponibles en este momento 😔 Escribe *cancelar* y vuelve a intentarlo más tarde.",
            origen: "automatico",
          });
          return { manejado: true };
        }

        await actualizarSesion(params.supabase, sesion!.id, {
          step: "S3_DIA",
          profesionalId,
          fechaIso: null,
          slotSeleccionado: null,
          opcionesMostradas: diasResultado.opciones,
          ultimoWamidProcesado: params.wamid,
        });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: renderizarMenuFecha(diasResultado.opciones), origen: "automatico" });
        return { manejado: true };
      }

      // FASE 5 (autorizado) -- reutilizada TAL CUAL tanto para avanzar
      // (fecha_seleccionada) como para retroceder desde S5_CONFIRMAR
      // (confirmacion_cambiar_hora, FASE 6). Si la fecha ya no tiene ningún
      // horario real (protección, sección CASOS IMPORTANTES #8), recalcula
      // los días candidatos reales y vuelve a S3_DIA -- reutilizando
      // mostrarMenuFechaOVolverAProfesional en vez de duplicar ese cálculo.
      async function mostrarMenuHoraOVolverAFecha(
        servicioId: string,
        profesionalId: number,
        fechaIso: string,
        mensajePrevio?: string,
      ): Promise<ResultadoRouterAgendaV2> {
        const prefijo = mensajePrevio ? `${mensajePrevio}\n\n` : "";
        const nylasDeps = construirNylasDeps();
        const horariosResultado = await calcularHoras(params.supabase, { idTenant: params.idTenant, servicioId, profesionalId, fechaIso }, nylasDeps);

        if (!horariosResultado.ok) {
          const diasResultado = await calcularDias(params.supabase, { idTenant: params.idTenant, servicioId, profesionalId }, nylasDeps);
          const opcionesFecha = diasResultado.ok ? diasResultado.opciones : [];
          await actualizarSesion(params.supabase, sesion!.id, {
            step: "S3_DIA",
            fechaIso: null,
            slotSeleccionado: null,
            opcionesMostradas: opcionesFecha,
            ultimoWamidProcesado: params.wamid,
          });
          await enviarMensaje({
            tenantId: params.idTenant,
            telefono: params.telefono,
            mensaje:
              opcionesFecha.length > 0
                ? `${prefijo}Ese día ya no tiene horarios disponibles 😔 Elige otro:\n\n${renderizarMenuFecha(opcionesFecha)}`
                : `${prefijo}Ese día ya no tiene horarios disponibles y no encontramos otro con cupo por ahora 😔 Escribe *cancelar* y vuelve a intentarlo más tarde.`,
            origen: "automatico",
          });
          return { manejado: true };
        }

        const opcionesHora = construirOpcionesHora(fechaIso, horariosResultado.horarios);
        await actualizarSesion(params.supabase, sesion!.id, {
          step: "S4_HORA",
          fechaIso,
          slotSeleccionado: null,
          opcionesMostradas: opcionesHora,
          ultimoWamidProcesado: params.wamid,
        });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: `${prefijo}${renderizarMenuHora(opcionesHora)}`, origen: "automatico" });
        return { manejado: true };
      }

      const resultado = manejarMensajeAgendaV2(sesion, params.texto);

      if (resultado.accion === "categoria_seleccionada") {
        // Ajuste de UX (autorizado) -- la categoría ya fue elegida; se
        // construye el menú de servicios de ESA categoría con el catálogo
        // REAL del tenant (nunca inventado), y ese menú reemplaza a
        // `opcionesMostradas` -- el step sigue siendo S1_SERVICIO (ver
        // lib/agenda-v2/categorias.ts).
        const catalogo = await cargarCatalogo(params.supabase, params.idTenant);
        const serviciosDeCategoria = catalogo.filter((s) => s.categoria === resultado.categoria);
        if (serviciosDeCategoria.length === 0) {
          // Defensivo -- un servicio pudo desactivarse justo entre mostrar
          // las categorías y esta selección. Nunca se rompe ni se inventa un
          // servicio: se vuelve a mostrar categorías reales y actualizadas.
          const categoriasActualizadas = construirOpcionesCategoria(catalogo);
          await actualizarSesion(params.supabase, sesion.id, { opcionesMostradas: categoriasActualizadas, ultimoWamidProcesado: params.wamid });
          await enviarMensaje({
            tenantId: params.idTenant,
            telefono: params.telefono,
            mensaje: `Esa categoría ya no tiene servicios disponibles 😔 Elige otra:\n\n${renderizarMenuCategoria(categoriasActualizadas)}`,
            origen: "automatico",
          });
          return { manejado: true };
        }
        const opcionesServicio = construirOpcionesServicio(serviciosDeCategoria);
        await actualizarSesion(params.supabase, sesion.id, { opcionesMostradas: opcionesServicio, ultimoWamidProcesado: params.wamid });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: renderizarMenuServicio(opcionesServicio), origen: "automatico" });
        return { manejado: true };
      }

      if (resultado.accion === "servicio_seleccionado") {
        // FASE 3 (autorizado) -- el servicio ya fue elegido; se resuelven
        // los profesionales REALMENTE elegibles para ESE servicio con el
        // ÚNICO resolver real de elegibilidad (lib/asignacion-categoria.ts),
        // el mismo que ya usa el resto de la plataforma -- nunca una segunda
        // fuente de verdad. El step avanza a S2_PROFESIONAL en el mismo
        // update que guarda el menú (nunca dos escrituras separadas).
        const resolucion = await resolverEspecialistas(params.supabase, params.idTenant, resultado.servicioId);
        if (resolucion.especialistas.length === 0) {
          // Caso sin profesionales elegibles (sección "CASO SIN
          // PROFESIONALES" del pedido) -- NUNCA avanza a S2_PROFESIONAL con
          // un menú vacío ni deja la sesión en un estado inconsistente.
          // Mismo criterio de recuperación que "categoría sin servicios" de
          // la Fase 2A: se vuelve a mostrar el catálogo real desde
          // categorías, el step permanece en S1_SERVICIO (donde ya estaba).
          // Terminología reutilizada de internal-action-executor.ts (mismo
          // caso real, "ninguna profesional está habilitada todavía").
          const catalogo = await cargarCatalogo(params.supabase, params.idTenant);
          const categoriasActualizadas = construirOpcionesCategoria(catalogo);
          await actualizarSesion(params.supabase, sesion.id, { opcionesMostradas: categoriasActualizadas, ultimoWamidProcesado: params.wamid });
          await enviarMensaje({
            tenantId: params.idTenant,
            telefono: params.telefono,
            mensaje: `En este momento ninguna profesional está habilitada para ese servicio 😔 Elige otro:\n\n${renderizarMenuCategoria(categoriasActualizadas)}`,
            origen: "automatico",
          });
          return { manejado: true };
        }
        const opcionesProfesional = construirOpcionesProfesional(resolucion.especialistas);
        await actualizarSesion(params.supabase, sesion.id, {
          step: "S2_PROFESIONAL",
          servicioId: resultado.servicioId,
          opcionesMostradas: opcionesProfesional,
          ultimoWamidProcesado: params.wamid,
        });
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: renderizarMenuProfesional(opcionesProfesional), origen: "automatico" });
        return { manejado: true };
      }

      if (resultado.accion === "profesional_seleccionado") {
        // FASE 4 (autorizado) -- el profesional ya fue elegido; se calculan
        // los días candidatos REALES para ESE profesional y el servicio ya
        // elegido en la Fase 3 (ver mostrarMenuFechaOVolverAProfesional).
        if (!sesion.servicioId) return await reiniciarPorEstadoInconsistente("S2_PROFESIONAL sin servicioId");
        return await mostrarMenuFechaOVolverAProfesional(sesion.servicioId, resultado.profesionalId);
      }

      if (resultado.accion === "fecha_seleccionada") {
        // FASE 5 (autorizado) -- la fecha ya fue elegida; se calculan los
        // horarios REALES disponibles con UNA sola consulta (ver
        // mostrarMenuHoraOVolverAFecha).
        if (!sesion.servicioId || !sesion.profesionalId) {
          return await reiniciarPorEstadoInconsistente("S3_DIA sin servicioId/profesionalId");
        }
        return await mostrarMenuHoraOVolverAFecha(sesion.servicioId, sesion.profesionalId, resultado.fechaIso);
      }

      if (resultado.accion === "hora_seleccionada") {
        // FASE 6 (autorizado) -- la hora ya fue elegida; se arma el resumen
        // REAL (nombre del servicio, precio, duración, nombre del
        // profesional, fecha y hora ya formateadas) -- reutiliza
        // `cargarCatalogo` y `resolverEspecialistas`, ya inyectados, en vez
        // de crear una consulta nueva (sección "no duplicar lógica" del
        // pedido). NUNCA crea la cita todavía (eso es la Fase 7).
        if (!sesion.servicioId || !sesion.profesionalId) {
          return await reiniciarPorEstadoInconsistente("S4_HORA sin servicioId/profesionalId");
        }
        const catalogo = await cargarCatalogo(params.supabase, params.idTenant);
        const servicio = catalogo.find((s) => s.id === sesion.servicioId);
        const resolucion = await resolverEspecialistas(params.supabase, params.idTenant, sesion.servicioId);
        const profesional = resolucion.especialistas.find((e) => e.especialistaId === sesion.profesionalId);
        if (!servicio || !profesional) {
          // Defensivo -- el servicio se desactivó o el profesional dejó de
          // estar habilitado justo entre elegir la hora y armar el resumen.
          // Nunca se inventa un nombre/precio: se reinicia la sesión.
          return await reiniciarPorEstadoInconsistente("S4_HORA con servicio/profesional ya no válidos al armar el resumen");
        }

        const resumen: ResumenCitaAgendaV2 = {
          servicioNombre: servicio.nombre,
          servicioPrecio: servicio.precio,
          servicioDuracionMin: servicio.duracionMin,
          profesionalNombre: profesional.nombre,
          fechaEtiqueta: formatearFechaLarga(resultado.fechaIso),
          horaTexto: formatearHoraAmPm(resultado.hora),
        };
        await actualizarSesion(params.supabase, sesion.id, {
          step: "S5_CONFIRMAR",
          fechaIso: resultado.fechaIso,
          slotSeleccionado: { fechaIso: resultado.fechaIso, hora: resultado.hora },
          opcionesMostradas: OPCIONES_CONFIRMACION,
          ultimoWamidProcesado: params.wamid,
        });
        // FASE 8 -- si esto es una reprogramación (citaObjetivoId ya
        // fijado), el resumen se enmarca como "vas a cambiar tu cita",
        // reutilizando el MISMO menú de control de 4 opciones -- nunca un
        // mecanismo de confirmación nuevo.
        const mensajeResumen = sesion.citaObjetivoId ? renderizarResumenCambio(resumen) : renderizarResumenConfirmacion(resumen);
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: mensajeResumen, origen: "automatico" });
        return { manejado: true };
      }

      if (resultado.accion === "confirmacion_cambiar_fecha") {
        // FASE 6, Opción 2 (autorizado) -- reutiliza la Fase 4 TAL CUAL.
        if (!sesion.servicioId || !sesion.profesionalId) {
          return await reiniciarPorEstadoInconsistente("S5_CONFIRMAR sin servicioId/profesionalId (cambiar fecha)");
        }
        return await mostrarMenuFechaOVolverAProfesional(sesion.servicioId, sesion.profesionalId);
      }

      if (resultado.accion === "confirmacion_cambiar_hora") {
        // FASE 6, Opción 3 (autorizado) -- reutiliza la Fase 5 TAL CUAL,
        // manteniendo servicio/profesional/fecha ya elegidos (nunca vuelve a
        // pedir categoría/servicio/profesional).
        if (!sesion.servicioId || !sesion.profesionalId || !sesion.fechaIso) {
          return await reiniciarPorEstadoInconsistente("S5_CONFIRMAR sin servicioId/profesionalId/fechaIso (cambiar hora)");
        }
        return await mostrarMenuHoraOVolverAFecha(sesion.servicioId, sesion.profesionalId, sesion.fechaIso);
      }

      if (resultado.accion === "confirmacion_confirmar") {
        // FASE 7 (autorizado) -- crear la reserva REAL. Reutiliza
        // crearCitaConNylas TAL CUAL: esa función YA revalida disponibilidad
        // real (jornada + bloqueos + citas DuLabs + Nylas) inmediatamente
        // antes de crear, y el constraint EXCLUDE de Postgres sigue siendo
        // la ÚLTIMA autoridad real contra doble reserva -- nada de eso se
        // duplica acá. Nunca cierra la sesión antes de confirmar éxito real.
        if (!sesion.servicioId || !sesion.profesionalId || !sesion.fechaIso || !sesion.slotSeleccionado) {
          return await reiniciarPorEstadoInconsistente("S5_CONFIRMAR sin servicioId/profesionalId/fechaIso/slotSeleccionado al confirmar");
        }
        const slot = sesion.slotSeleccionado as { fechaIso: string; hora: string };

        // El precio real se necesita para el mensaje de éxito (nunca se
        // inventa) -- se resuelve ANTES de intentar crear nada; si el
        // servicio ya no es válido, se reinicia sin tocar Nylas/DB (mismo
        // criterio defensivo que hora_seleccionada).
        const catalogo = await cargarCatalogo(params.supabase, params.idTenant);
        const servicio = catalogo.find((s) => s.id === sesion.servicioId);
        if (!servicio) {
          return await reiniciarPorEstadoInconsistente("S5_CONFIRMAR con servicio ya no válido al confirmar");
        }

        const grantId = resolverGrantId(params.idTenant);
        const apiKey = resolverApiKey();
        if (!grantId || !apiKey) {
          console.error("[agenda-v2] sin conexión Nylas al intentar confirmar la reserva -- se informa sin cerrar la sesión");
          await actualizarSesion(params.supabase, sesion.id, { ultimoWamidProcesado: params.wamid });
          await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_TECNICO_CONFIRMACION, origen: "automatico" });
          return { manejado: true };
        }
        const nylasReadClient = crearNylasClient(apiKey);
        const nylasWriteClient = crearNylasWriteClient(apiKey);
        const inicio = new Date(`${slot.fechaIso}T${slot.hora}:00-05:00`);

        if (sesion.citaObjetivoId) {
          // FASE 8 (autorizado) -- esto es una REPROGRAMACIÓN: actualiza la
          // cita EXISTENTE (mismo id, nunca crea una fila nueva), vía
          // actualizarCitaConNylas -- MISMA revalidación real (jornada +
          // bloqueos + citas DuLabs + Nylas) que crearCitaConNylas, sin
          // duplicar ninguna lógica.
          const citaObjetivoId = sesion.citaObjetivoId;
          const nylasEventIdActual = await obtenerNylasEventIdDep(params.supabase, citaObjetivoId);
          const idempotencyKeyReprogramar = `agenda-v2:reprogramar:${sesion.id}:${params.wamid}`;

          let resultadoActualizar;
          try {
            resultadoActualizar = await actualizarCitaReal(
              params.supabase,
              { idTenant: params.idTenant, citaId: citaObjetivoId, nuevoInicio: inicio, idempotencyKey: idempotencyKeyReprogramar },
              { nylasReadClient, nylasWriteClient, grantId, nylasEventIdActual },
            );
          } catch (err) {
            console.error("[agenda-v2] error técnico reprogramando la cita real -- sesión NO se cierra, se permite reintentar:", err instanceof Error ? err.message : "error desconocido");
            await actualizarSesion(params.supabase, sesion.id, { ultimoWamidProcesado: params.wamid });
            await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_REPROGRAMACION, origen: "automatico" });
            return { manejado: true };
          }

          if (!resultadoActualizar.ok) {
            if (resultadoActualizar.motivo === "ocupado" || resultadoActualizar.motivo === "fuera_de_horario" || resultadoActualizar.motivo === "bloqueado") {
              // Revalidación real: el horario ya no está disponible -- NUNCA
              // se toca la cita original. Vuelve a S4_HORA reutilizando la
              // Fase 5 tal cual, sin perder servicio/profesional/fecha.
              return await mostrarMenuHoraOVolverAFecha(sesion.servicioId, sesion.profesionalId, sesion.fechaIso, MENSAJE_HORARIO_RECIEN_OCUPADO);
            }
            // Cualquier otro motivo -- la cita ORIGINAL sigue intacta
            // (actualizarCitaConNylas nunca la toca si algo falla). NUNCA se
            // marca éxito, NUNCA se cierra la sesión: se informa y se
            // permite reintentar.
            console.error(`[agenda-v2] no se pudo reprogramar la cita real (${resultadoActualizar.motivo}): ${resultadoActualizar.detalle}`);
            await actualizarSesion(params.supabase, sesion.id, { ultimoWamidProcesado: params.wamid });
            await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_REPROGRAMACION, origen: "automatico" });
            return { manejado: true };
          }

          // Éxito real -- la MISMA cita quedó movida (nunca una nueva).
          // Guardar el mapeo del NUEVO evento de Nylas es best-effort (nunca
          // deshace el éxito ya logrado en DuLabs/Nylas).
          await guardarNylasEventIdDep(params.supabase, resultadoActualizar.cita.id, resultadoActualizar.nylasEventId);
          await cerrarSesion(params.supabase, sesion.id);
          await enviarMensaje({
            tenantId: params.idTenant,
            telefono: params.telefono,
            mensaje: renderizarReprogramacionExitosa({
              servicioNombre: resultadoActualizar.servicio.nombre,
              profesionalNombre: resultadoActualizar.especialista.nombre,
              fechaEtiqueta: formatearFechaLarga(slot.fechaIso),
              horaTexto: formatearHoraAmPm(slot.hora),
            }),
            origen: "automatico",
          });
          return { manejado: true };
        }

        const nombreCliente = (await buscarNombreConocidoDep(params.supabase, phoneNumberId, params.telefono)) ?? params.telefono;
        // Idempotencia real (lib/idempotencia-reserva.ts, reutilizada TAL
        // CUAL dentro de crearCitaConNylas) -- atada a (sesión, wamid): el
        // wamid ya es único por mensaje entrante (el router nunca reprocesa
        // el MISMO wamid, ver la comprobación de arriba), así que cada
        // intento de confirmación real tiene su propia clave, y un
        // reintento genuino tras un error técnico (wamid nuevo) sí vuelve a
        // ejecutar la operación en vez de devolver un resultado cacheado.
        const idempotencyKey = `agenda-v2:confirmar:${sesion.id}:${params.wamid}`;

        let resultadoCita;
        try {
          resultadoCita = await crearCitaReal(
            params.supabase,
            {
              idTenant: params.idTenant,
              servicioId: sesion.servicioId,
              especialistaId: sesion.profesionalId,
              inicio,
              nombreCliente,
              telefonoCliente: params.telefono,
              idempotencyKey,
            },
            { nylasReadClient, nylasWriteClient, grantId },
          );
        } catch (err) {
          // Nunca imprime tokens/API keys/grants -- solo el mensaje de error.
          console.error("[agenda-v2] error técnico creando la cita real -- sesión NO se cierra, se permite reintentar:", err instanceof Error ? err.message : "error desconocido");
          await actualizarSesion(params.supabase, sesion.id, { ultimoWamidProcesado: params.wamid });
          await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_TECNICO_CONFIRMACION, origen: "automatico" });
          return { manejado: true };
        }

        if (!resultadoCita.ok) {
          if (resultadoCita.motivo === "ocupado" || resultadoCita.motivo === "fuera_de_horario" || resultadoCita.motivo === "bloqueado") {
            // Revalidación real: el horario ya no está disponible (recién
            // tomado, o cambió la jornada/un bloqueo) -- NUNCA se crea nada.
            // Vuelve a S4_HORA reutilizando la Fase 5 tal cual, sin perder
            // servicio/profesional/fecha.
            return await mostrarMenuHoraOVolverAFecha(sesion.servicioId, sesion.profesionalId, sesion.fechaIso, MENSAJE_HORARIO_RECIEN_OCUPADO);
          }
          // Cualquier otro motivo (config/técnico/idempotencia en conflicto)
          // -- NUNCA se marca éxito, NUNCA se cierra la sesión: se informa y
          // se permite reintentar (la idempotencyKey ya protege ESTE intento
          // puntual contra una doble creación).
          console.error(`[agenda-v2] no se pudo crear la cita real (${resultadoCita.motivo}): ${resultadoCita.detalle}`);
          await actualizarSesion(params.supabase, sesion.id, { ultimoWamidProcesado: params.wamid });
          await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_TECNICO_CONFIRMACION, origen: "automatico" });
          return { manejado: true };
        }

        // Éxito real -- la cita YA quedó persistida (crearCitaConNylas) y el
        // evento real ya existe en el calendario. Recién ACÁ se cierra la
        // sesión (nunca antes de confirmar éxito real), para que el
        // siguiente mensaje del cliente jamás continúe en S5_CONFIRMAR.
        // FASE 8 -- guarda el mapeo cita->evento real de Nylas (best-effort,
        // nunca bloquea el éxito ya logrado): sin esto, cancelar/reprogramar
        // esta cita más adelante no podría tocar su evento real de calendario.
        await guardarNylasEventIdDep(params.supabase, resultadoCita.cita.id, resultadoCita.nylasEventId);
        await cerrarSesion(params.supabase, sesion.id);
        await enviarMensaje({
          tenantId: params.idTenant,
          telefono: params.telefono,
          mensaje: renderizarConfirmacionExitosa({
            servicioNombre: resultadoCita.servicio.nombre,
            profesionalNombre: resultadoCita.especialista.nombre,
            fechaEtiqueta: formatearFechaLarga(slot.fechaIso),
            horaTexto: formatearHoraAmPm(slot.hora),
            valor: servicio.precio,
          }),
          origen: "automatico",
        });
        return { manejado: true };
      }

      if (resultado.accion === "cita_seleccionada_para_gestion") {
        // FASE 8 -- se resolvió cuál cita real (número exacto contra el menú
        // ya mostrado). Se revalida ownership de nuevo, FRESCA, contra la
        // MISMA fuente real (consultarCitasActivasEspecialista) -- nunca se
        // confía ciegamente en el citaId ya guardado en la sesión (sección
        // "SEGURIDAD" del pedido: "validar propiedad de la cita en servidor").
        if (!sesion.accionGestion) {
          return await reiniciarPorEstadoInconsistente("SG_SELECCIONAR_CITA sin accionGestion");
        }
        const resultadoCitas = await consultarCitasActivas(params.supabase, { phoneNumberId, telefonoCliente: params.telefono });
        const cita = resultadoCitas.citas.find((c) => c.id === resultado.citaId);
        if (!cita) {
          // La cita ya no está entre las activas de ESTE cliente (se
          // canceló mientras decidía, o el id ya no le pertenece) -- nunca
          // se actúa sobre ella. Se reinicia de forma segura.
          return await reiniciarPorEstadoInconsistente("SG_SELECCIONAR_CITA con citaId ya no válido/propio");
        }
        return await continuarGestionCita(cita, sesion.accionGestion, sesion);
      }

      if (resultado.accion === "cancelacion_confirmada") {
        // FASE 8 -- "Sí, cancelar". Reutiliza cancelarCitaEspecialista TAL
        // CUAL (especialistas-flow-adaptador.ts) -- ya revalida ownership
        // (citaPorIdYCliente) antes de tocar nada, mismo mecanismo EXACTO
        // que ya usa Daniela.
        if (!sesion.citaObjetivoId) {
          return await reiniciarPorEstadoInconsistente("SG_CANCELAR_CONFIRMAR sin citaObjetivoId");
        }
        const citaObjetivoId = sesion.citaObjetivoId;

        let resultadoCancelar;
        try {
          resultadoCancelar = await cancelarCitaEspecialistaDep(params.supabase, {
            phoneNumberId,
            telefonoCliente: params.telefono,
            confirmado: true,
            citaId: citaObjetivoId,
          });
        } catch (err) {
          console.error("[agenda-v2] error técnico cancelando la cita real:", err instanceof Error ? err.message : "error desconocido");
          resultadoCancelar = { ok: false as const, motivo: "error" as const, detalle: "excepción no capturada" };
        }

        if (!resultadoCancelar.ok) {
          console.error(`[agenda-v2] no se pudo cancelar la cita real (${resultadoCancelar.motivo}): ${resultadoCancelar.detalle}`);
          await cerrarSesion(params.supabase, sesion.id);
          await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_CANCELACION, origen: "automatico" });
          return { manejado: true };
        }

        // Éxito real en DuLabs (estado "cancelada", el horario ya quedó
        // libre para el constraint EXCLUDE) -- borrar el evento de Nylas
        // real es best-effort: la cancelación en DuLabs YA es el resultado
        // que importa, un evento huérfano en el calendario es una
        // inconsistencia menor y recuperable, nunca motivo para reportar un
        // fallo que no ocurrió.
        const nylasEventId = await obtenerNylasEventIdDep(params.supabase, citaObjetivoId);
        if (nylasEventId) {
          const grantId = resolverGrantId(params.idTenant);
          const apiKey = resolverApiKey();
          if (grantId && apiKey) {
            try {
              const calendarId = await resolverCalendarIdDep(params.supabase, params.idTenant, resultadoCancelar.cita.especialista_id);
              if (calendarId) {
                await crearNylasWriteClient(apiKey).deleteEvent({ grantId, calendarId, eventId: nylasEventId });
              }
            } catch (err) {
              console.error(
                `[agenda-v2] cita cancelada en DuLabs pero no se pudo borrar el evento de Nylas (${nylasEventId}) -- requiere revisión manual:`,
                err instanceof Error ? err.message : "error desconocido",
              );
            }
          }
          await borrarNylasEventIdDep(params.supabase, citaObjetivoId);
        }

        await cerrarSesion(params.supabase, sesion.id);
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_CITA_CANCELADA, origen: "automatico" });
        return { manejado: true };
      }

      if (resultado.accion === "reprogramar_confirmado_inicio") {
        // FASE 8 -- "Sí, reprogramar". Reutiliza la Fase 4 TAL CUAL para el
        // MISMO servicio/profesional de la cita actual (sección "CAMBIO DE
        // PROFESIONAL" del pedido: la reprogramación nunca cambia de
        // profesional). Se revalida ownership de nuevo, fresca.
        if (!sesion.citaObjetivoId) {
          return await reiniciarPorEstadoInconsistente("SG_REPROGRAMAR_CONFIRMAR_INICIO sin citaObjetivoId");
        }
        const resultadoCitas = await consultarCitasActivas(params.supabase, { phoneNumberId, telefonoCliente: params.telefono });
        const cita = resultadoCitas.citas.find((c) => c.id === sesion.citaObjetivoId);
        if (!cita || !cita.servicio_id) {
          // La cita ya no existe (se canceló mientras decidía) o no tiene un
          // servicio_id real asociado (no se puede revalidar su
          // disponibilidad real) -- nunca se inventa, se informa y se cierra.
          await cerrarSesion(params.supabase, sesion.id);
          await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_REPROGRAMACION, origen: "automatico" });
          return { manejado: true };
        }
        await actualizarSesion(params.supabase, sesion.id, {
          servicioId: cita.servicio_id,
          profesionalId: cita.especialista_id,
          ultimoWamidProcesado: params.wamid,
        });
        return await mostrarMenuFechaOVolverAProfesional(cita.servicio_id, cita.especialista_id);
      }

      if (resultado.accion === "cerrar_sesion") {
        await cerrarSesion(params.supabase, sesion.id);
      } else {
        // Aplica los cambios reales que decidió el controlador de forma
        // síncrona (ej. slotSeleccionado + step="S5_CONFIRMAR" al elegir un
        // horario válido, Fase 5), siempre junto con el wamid ya procesado.
        // Las transiciones que exigen datos reales async (categoría->
        // servicios, servicio->profesionales, profesional->días,
        // fecha->horas) se resuelven arriba, antes de llegar acá.
        await actualizarSesion(params.supabase, sesion.id, { ...resultado.cambios, ultimoWamidProcesado: params.wamid });
      }
      await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: resultado.respuesta, origen: "automatico" });
      return { manejado: true };
    }

    // FASE 8 -- sin sesión activa, ¿este mensaje dispara GESTIONAR una cita
    // existente (consultar/cancelar/reprogramar)? Frases FIJAS y controladas
    // (sección "DETECCIÓN DE INTENCIÓN" del pedido), revisado ANTES que el
    // inicio de una reserva nueva -- una sesión activa (verificado arriba)
    // ya tiene prioridad sobre esto, per la sección 1 del pedido.
    const intencionGestion = detectarIntencionGestionCitas(params.texto);
    if (intencionGestion) {
      try {
        return await iniciarGestionCitas(intencionGestion);
      } catch (err) {
        // Defensivo (mismo criterio EXACTO que buscarSesionActiva arriba) --
        // la migración de Fase 8 (columnas/step nuevos de
        // dulabs_agenda_v2_sesiones, tabla dulabs_agenda_v2_citas_nylas)
        // puede no estar aplicada todavía en producción: nunca se deja al
        // cliente sin respuesta, se informa un problema técnico real en vez
        // de dejar la excepción sin capturar.
        console.error("[agenda-v2] error técnico iniciando gestión de citas (¿migración de Fase 8 pendiente?):", err instanceof Error ? err.message : "error desconocido");
        await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: MENSAJE_ERROR_TECNICO_GESTION, origen: "automatico" });
        return { manejado: true };
      }
    }

    // Sin sesión activa -- ¿este mensaje dispara el inicio? (mismas
    // variantes reales de CODIGO_ESCENARIO_AGENDAMIENTO, nunca vocabulario
    // nuevo, ver lib/agenda-v2/entrada.ts).
    const escenarios = await cargarEscenarios(params.supabase, params.idTenant);
    if (!esInicioDeAgendaV2(params.texto, escenarios)) {
      return { manejado: false };
    }

    // Ajuste de UX (autorizado) -- el primer paso real es SIEMPRE el menú de
    // CATEGORÍAS reales (nunca los 28 servicios de un jalón), construido a
    // partir del catálogo REAL del tenant -- las opciones mostradas se
    // guardan tal cual en la sesión para resolver la próxima respuesta
    // determinísticamente (ver lib/agenda-v2/categorias.ts).
    const catalogo = await cargarCatalogo(params.supabase, params.idTenant);
    const opciones = construirOpcionesCategoria(catalogo);
    await crearSesion(params.supabase, {
      tenantId: params.idTenant,
      telefonoCliente: params.telefono,
      wamid: params.wamid,
      opcionesMostradas: opciones,
    });
    await enviarMensaje({ tenantId: params.idTenant, telefono: params.telefono, mensaje: renderizarMenuCategoria(opciones), origen: "automatico" });
    return { manejado: true };
  } finally {
    await liberar(phoneNumberId, params.telefono, params.wamid);
  }
}
