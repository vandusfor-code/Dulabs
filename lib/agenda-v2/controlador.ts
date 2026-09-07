/**
 * AGENDA V2 (autorizado) — controlador de mensajes para una sesión YA
 * activa. FASE 2 implementa S1_SERVICIO; los pasos siguientes
 * (S2_PROFESIONAL en adelante) se agregan en fases posteriores, cada una
 * con su propia autorización -- por ahora, cualquier mensaje en esos pasos
 * recibe la misma respuesta temporal de la Fase 1.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import type { CambiosSesionAgendaV2, SesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import { resolverSeleccionServicio, textoSeleccionInvalidaServicio, type OpcionServicioAgendaV2 } from "@/lib/agenda-v2/servicios";

export const RESPUESTA_PLACEHOLDER_AGENDA_V2 = "Agenda V2 activa. Selecciona una opción.";
const RESPUESTA_CANCELACION = "Listo, cancelé tu proceso de agenda 💗 Escríbeme cuando quieras retomarlo.";
const RESPUESTA_SERVICIO_SELECCIONADO = "Servicio seleccionado correctamente.";

/** Vocabulario cerrado, coincidencia EXACTA tras normalizar -- nunca "contains", mismo criterio que el resto del proyecto para comandos de control (ver esCancelacionExplicitaDeReserva). */
const COMANDO_CANCELAR = "cancelar";

export type ResultadoControladorAgendaV2 =
  | { accion: "cerrar_sesion"; respuesta: string }
  | { accion: "continuar"; respuesta: string; cambios?: CambiosSesionAgendaV2 };

/**
 * Procesa UN mensaje ya sabido perteneciente a una sesión activa. Nunca
 * llama a resolverEscenario, ejecutarBotWhatsAppQR, Gemini/Claude, ni
 * ningún otro escenario -- el mensaje entero queda resuelto acá.
 */
export function manejarMensajeAgendaV2(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const normalizado = normalizeText(mensaje);
  if (normalizado === COMANDO_CANCELAR) {
    return { accion: "cerrar_sesion", respuesta: RESPUESTA_CANCELACION };
  }

  if (sesion.step === "S1_SERVICIO") {
    return manejarSeleccionServicio(sesion, mensaje);
  }

  // Sección "NO implementes todavía" del pedido -- S2_PROFESIONAL en
  // adelante no tiene lógica real todavía; cualquier mensaje en esos pasos
  // recibe la misma respuesta temporal que ya usaba la Fase 1, sin avanzar
  // ni retroceder el step.
  return { accion: "continuar", respuesta: RESPUESTA_PLACEHOLDER_AGENDA_V2 };
}

function manejarSeleccionServicio(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  // Defensivo -- toda sesión en S1_SERVICIO debe tener opciones reales
  // guardadas (el router las arma al crear la sesión, ver router.ts). Si
  // por alguna razón faltan, no hay nada determinístico contra qué
  // resolver -- se informa sin inventar ni avanzar.
  const opciones = (sesion.opcionesMostradas as OpcionServicioAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: "Se perdió el menú de servicios 😅 Escribe *cancelar* y vuelve a intentarlo." };
  }

  const seleccion = resolverSeleccionServicio(mensaje, opciones);
  if (!seleccion) {
    // Sección "ENTRADAS INVÁLIDAS" del pedido -- NUNCA avanza, NUNCA cambia
    // el servicio, NUNCA llama a nada externo. Vuelve a mostrar EXACTAMENTE
    // las mismas opciones ya guardadas (nunca una consulta nueva al catálogo).
    return { accion: "continuar", respuesta: textoSeleccionInvalidaServicio(opciones) };
  }

  return {
    accion: "continuar",
    respuesta: RESPUESTA_SERVICIO_SELECCIONADO,
    cambios: {
      step: "S2_PROFESIONAL",
      servicioId: seleccion.servicioId,
      // Se limpia -- esas opciones eran del paso de servicio, ya no
      // corresponden al paso siguiente. servicioId (columna real, ya
      // existente) es suficiente para recuperar nombre/precio/duración con
      // una consulta fresca en cualquier fase posterior -- nunca se
      // arriesga a mostrar un precio desactualizado por haberlo cacheado acá.
      opcionesMostradas: null,
    },
  };
}
