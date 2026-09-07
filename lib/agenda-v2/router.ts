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
import { createNylasEventsClient, resolveNylasApiKeyFromEnv } from "@/lib/nylas/nylas-client";
import type { DepsDisponibilidadNylas } from "@/lib/disponibilidad-servicio-nylas";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";
import { esInicioDeAgendaV2 } from "@/lib/agenda-v2/entrada";
import { manejarMensajeAgendaV2 } from "@/lib/agenda-v2/controlador";
import { construirOpcionesServicio, renderizarMenuServicio } from "@/lib/agenda-v2/servicios";
import { construirOpcionesCategoria, renderizarMenuCategoria } from "@/lib/agenda-v2/categorias";
import { construirOpcionesProfesional, renderizarMenuProfesional } from "@/lib/agenda-v2/profesionales";
import { renderizarMenuFecha } from "@/lib/agenda-v2/fechas";
import { construirOpcionesHora, renderizarMenuHora } from "@/lib/agenda-v2/horas";
import { calcularDiasCandidatosReales, calcularHorariosParaFecha } from "@/lib/agenda-v2/disponibilidad";
import { buscarSesionActivaAgendaV2, crearSesionAgendaV2, cerrarSesionAgendaV2, actualizarSesionAgendaV2 } from "@/lib/agenda-v2/sesiones";

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

  const phoneNumberId = phoneNumberIdSintetico(params.idTenant);

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
        });
        await enviarMensaje({
          tenantId: params.idTenant,
          telefono: params.telefono,
          mensaje: `Ocurrió un problema con tu selección 😅 Empecemos de nuevo, elige una categoría:\n\n${renderizarMenuCategoria(categoriasActualizadas)}`,
          origen: "automatico",
        });
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
        // los días candidatos REALES (horario real + bloqueos + huecos
        // reales de Nylas, ver lib/agenda-v2/disponibilidad.ts) para ESE
        // profesional y el servicio ya elegido en la Fase 3.
        if (!sesion.servicioId) return await reiniciarPorEstadoInconsistente("S2_PROFESIONAL sin servicioId");

        const nylasDeps = construirNylasDeps();
        const diasResultado = await calcularDias(
          params.supabase,
          { idTenant: params.idTenant, servicioId: sesion.servicioId, profesionalId: resultado.profesionalId },
          nylasDeps,
        );

        if (!diasResultado.ok || diasResultado.opciones.length === 0) {
          // Caso "sin días disponibles" (sección CASOS IMPORTANTES #7 del
          // pedido) -- NUNCA avanza a S3_DIA con un menú vacío. Se revierte
          // UN nivel (mismo criterio que "sin profesionales elegibles" de la
          // Fase 3): se vuelve a mostrar los profesionales reales elegibles
          // para este servicio, para que la clienta intente con otra persona.
          const resolucion = await resolverEspecialistas(params.supabase, params.idTenant, sesion.servicioId);
          const opcionesProfesional = construirOpcionesProfesional(resolucion.especialistas);
          await actualizarSesion(params.supabase, sesion.id, {
            step: "S2_PROFESIONAL",
            profesionalId: null,
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

        await actualizarSesion(params.supabase, sesion.id, {
          step: "S3_DIA",
          profesionalId: resultado.profesionalId,
          opcionesMostradas: diasResultado.opciones,
          ultimoWamidProcesado: params.wamid,
        });
        await enviarMensaje({
          tenantId: params.idTenant,
          telefono: params.telefono,
          mensaje: renderizarMenuFecha(diasResultado.opciones),
          origen: "automatico",
        });
        return { manejado: true };
      }

      if (resultado.accion === "fecha_seleccionada") {
        // FASE 5 (autorizado) -- la fecha ya fue elegida; se calculan los
        // horarios REALES disponibles con UNA sola consulta (el loop de
        // días candidatos ya se hizo en la Fase 4, nunca se repite acá).
        if (!sesion.servicioId || !sesion.profesionalId) {
          return await reiniciarPorEstadoInconsistente("S3_DIA sin servicioId/profesionalId");
        }

        const nylasDeps = construirNylasDeps();
        const horariosResultado = await calcularHoras(
          params.supabase,
          { idTenant: params.idTenant, servicioId: sesion.servicioId, profesionalId: sesion.profesionalId, fechaIso: resultado.fechaIso },
          nylasDeps,
        );

        if (!horariosResultado.ok) {
          // Caso "protección" (sección CASOS IMPORTANTES #8 del pedido) --
          // esta fecha nunca debió mostrarse sin horarios reales; si igual
          // ocurre (huecos que se llenaron justo entre construir el menú de
          // días y elegir uno), nunca se rompe: se recalculan los días
          // candidatos reales y se vuelve a mostrar S3_DIA actualizado.
          const diasResultado = await calcularDias(
            params.supabase,
            { idTenant: params.idTenant, servicioId: sesion.servicioId, profesionalId: sesion.profesionalId },
            nylasDeps,
          );
          const opcionesFecha = diasResultado.ok ? diasResultado.opciones : [];
          await actualizarSesion(params.supabase, sesion.id, {
            step: "S3_DIA",
            fechaIso: null,
            opcionesMostradas: opcionesFecha,
            ultimoWamidProcesado: params.wamid,
          });
          await enviarMensaje({
            tenantId: params.idTenant,
            telefono: params.telefono,
            mensaje:
              opcionesFecha.length > 0
                ? `Ese día ya no tiene horarios disponibles 😔 Elige otro:\n\n${renderizarMenuFecha(opcionesFecha)}`
                : "Ese día ya no tiene horarios disponibles y no encontramos otro con cupo por ahora 😔 Escribe *cancelar* y vuelve a intentarlo más tarde.",
            origen: "automatico",
          });
          return { manejado: true };
        }

        const opcionesHora = construirOpcionesHora(resultado.fechaIso, horariosResultado.horarios);
        await actualizarSesion(params.supabase, sesion.id, {
          step: "S4_HORA",
          fechaIso: resultado.fechaIso,
          opcionesMostradas: opcionesHora,
          ultimoWamidProcesado: params.wamid,
        });
        await enviarMensaje({
          tenantId: params.idTenant,
          telefono: params.telefono,
          mensaje: renderizarMenuHora(opcionesHora),
          origen: "automatico",
        });
        return { manejado: true };
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
