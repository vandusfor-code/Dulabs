/**
 * AGENDA V2 (autorizado) — controlador de mensajes para una sesión YA
 * activa. S1_SERVICIO tiene dos sub-fases (ver lib/agenda-v2/categorias.ts
 * para el porqué de no agregar un `step` nuevo): primero categoría, luego
 * servicio de esa categoría. FASE 3 implementa S2_PROFESIONAL. FASES 4/5
 * implementan S3_DIA y S4_HORA. S5_CONFIRMAR en adelante se agrega en fases
 * posteriores, cada una con su propia autorización -- por ahora, cualquier
 * mensaje en ese paso recibe la misma respuesta temporal de la Fase 1.
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import type { CambiosSesionAgendaV2, SesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import { resolverSeleccionServicio, textoSeleccionInvalidaServicio, type OpcionServicioAgendaV2 } from "@/lib/agenda-v2/servicios";
import { esOpcionCategoria, resolverSeleccionCategoria, textoSeleccionInvalidaCategoria, type OpcionCategoriaAgendaV2 } from "@/lib/agenda-v2/categorias";
import { resolverSeleccionProfesional, textoSeleccionInvalidaProfesional, type OpcionProfesionalAgendaV2 } from "@/lib/agenda-v2/profesionales";
import { resolverSeleccionFecha, textoSeleccionInvalidaFecha, type OpcionFechaAgendaV2 } from "@/lib/agenda-v2/fechas";
import { resolverSeleccionHora, textoSeleccionInvalidaHora, type OpcionHoraAgendaV2 } from "@/lib/agenda-v2/horas";

export const RESPUESTA_PLACEHOLDER_AGENDA_V2 = "Agenda V2 activa. Selecciona una opción.";
const RESPUESTA_CANCELACION = "Listo, cancelé tu proceso de agenda 💗 Escríbeme cuando quieras retomarlo.";
const RESPUESTA_HORA_SELECCIONADA = "Horario seleccionado correctamente.";
const RESPUESTA_MENU_PERDIDO = "Se perdió el menú 😅 Escribe *cancelar* y vuelve a intentarlo.";

/** Vocabulario cerrado, coincidencia EXACTA tras normalizar -- nunca "contains", mismo criterio que el resto del proyecto para comandos de control (ver esCancelacionExplicitaDeReserva). */
const COMANDO_CANCELAR = "cancelar";

export type ResultadoControladorAgendaV2 =
  | { accion: "cerrar_sesion"; respuesta: string }
  | { accion: "continuar"; respuesta: string; cambios?: CambiosSesionAgendaV2 }
  // La categoría fue elegida, pero construir el menú de servicios de ESA
  // categoría exige el catálogo real (async) -- eso vive en router.ts, que ya
  // tiene `cargarCatalogo` inyectado. El controlador se queda puro/síncrono.
  | { accion: "categoria_seleccionada"; categoria: string }
  // FASE 3 -- el servicio fue elegido, pero construir el menú de
  // profesionales elegibles exige resolverEspecialistasElegiblesParaServicio
  // (async, Supabase real) -- misma razón que categoria_seleccionada.
  | { accion: "servicio_seleccionado"; servicioId: string }
  // FASE 4 -- el profesional fue elegido, pero calcular los días candidatos
  // reales exige el motor de disponibilidad + Nylas (async) -- misma razón
  // que las dos anteriores. Ver lib/agenda-v2/disponibilidad.ts.
  | { accion: "profesional_seleccionado"; profesionalId: number }
  // FASE 5 -- la fecha fue elegida, pero calcular los horarios reales de ESE
  // día exige el mismo motor async. Ver lib/agenda-v2/disponibilidad.ts.
  | { accion: "fecha_seleccionada"; fechaIso: string };

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
    return manejarSeleccionServicioOCategoria(sesion, mensaje);
  }

  if (sesion.step === "S2_PROFESIONAL") {
    return manejarSeleccionProfesional(sesion, mensaje);
  }

  if (sesion.step === "S3_DIA") {
    return manejarSeleccionFecha(sesion, mensaje);
  }

  if (sesion.step === "S4_HORA") {
    return manejarSeleccionHora(sesion, mensaje);
  }

  // Sección "NO implementes todavía" del pedido -- S5_CONFIRMAR en adelante
  // no tiene lógica real todavía; cualquier mensaje en ese paso recibe la
  // misma respuesta temporal que ya usaba la Fase 1, sin avanzar ni
  // retroceder el step.
  return { accion: "continuar", respuesta: RESPUESTA_PLACEHOLDER_AGENDA_V2 };
}

/**
 * S1_SERVICIO cubre dos sub-fases: mientras `opcionesMostradas` contiene
 * categorías (ver esOpcionCategoria), resuelve una categoría; en cuanto
 * contiene servicios (Fase 2 original, y también cualquier sesión ya creada
 * antes de este ajuste), resuelve un servicio exactamente como antes -- nunca
 * se rompe una sesión real que haya quedado a mitad de camino.
 */
function manejarSeleccionServicioOCategoria(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  // Defensivo -- toda sesión en S1_SERVICIO debe tener opciones reales
  // guardadas (el router las arma al crear la sesión / al resolver una
  // categoría, ver router.ts). Si por alguna razón faltan, no hay nada
  // determinístico contra qué resolver -- se informa sin inventar ni avanzar.
  const opciones = (sesion.opcionesMostradas as unknown[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  if (esOpcionCategoria(opciones[0])) {
    const categorias = opciones as OpcionCategoriaAgendaV2[];
    const seleccion = resolverSeleccionCategoria(mensaje, categorias);
    if (!seleccion) {
      // Igual criterio que "ENTRADAS INVÁLIDAS" de servicio -- NUNCA avanza,
      // reenvía EXACTAMENTE las mismas categorías ya guardadas.
      return { accion: "continuar", respuesta: textoSeleccionInvalidaCategoria(categorias) };
    }
    return { accion: "categoria_seleccionada", categoria: seleccion.categoria };
  }

  const opcionesServicio = opciones as OpcionServicioAgendaV2[];
  const seleccion = resolverSeleccionServicio(mensaje, opcionesServicio);
  if (!seleccion) {
    // Sección "ENTRADAS INVÁLIDAS" del pedido -- NUNCA avanza, NUNCA cambia
    // el servicio, NUNCA llama a nada externo. Vuelve a mostrar EXACTAMENTE
    // las mismas opciones ya guardadas (nunca una consulta nueva al catálogo).
    return { accion: "continuar", respuesta: textoSeleccionInvalidaServicio(opcionesServicio) };
  }

  // FASE 3 -- ya no se responde con un texto temporal: el siguiente mensaje
  // real es el menú de profesionales elegibles para ESTE servicio. Eso
  // exige resolverEspecialistasElegiblesParaServicio (async), así que
  // router.ts termina la transición (step, servicioId, opcionesMostradas).
  return { accion: "servicio_seleccionado", servicioId: seleccion.servicioId };
}

/**
 * FASE 3 -- S2_PROFESIONAL. Mismo patrón EXACTO que manejarSeleccionServicioOCategoria:
 * solo número exacto contra las opciones ya guardadas en la sesión (las
 * construyó router.ts con resolverEspecialistasElegiblesParaServicio, nunca
 * inventadas ni hardcodeadas acá).
 */
function manejarSeleccionProfesional(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const opciones = (sesion.opcionesMostradas as OpcionProfesionalAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  const seleccion = resolverSeleccionProfesional(mensaje, opciones);
  if (!seleccion) {
    // Sección "ENTRADAS INVÁLIDAS" del pedido -- NUNCA avanza, NUNCA cambia
    // profesional_id, NUNCA llama a nada externo. Vuelve a mostrar
    // EXACTAMENTE las mismas opciones ya guardadas.
    return { accion: "continuar", respuesta: textoSeleccionInvalidaProfesional(opciones) };
  }

  // FASE 4 -- ya no se responde con un texto temporal: el siguiente mensaje
  // real es el menú de días candidatos reales para ESTE profesional. Eso
  // exige el motor de disponibilidad + Nylas (async), así que router.ts
  // termina la transición (step, servicioId, opcionesMostradas).
  return { accion: "profesional_seleccionado", profesionalId: seleccion.profesionalId };
}

/**
 * FASE 4 -- S3_DIA. Mismo patrón EXACTO que los pasos anteriores: solo
 * número exacto contra las opciones ya guardadas en la sesión (las
 * construyó router.ts con el motor real de disponibilidad + Nylas, ver
 * lib/agenda-v2/disponibilidad.ts -- nunca inventadas ni hardcodeadas acá,
 * nunca se parsea texto libre como "el sábado" o "mañana").
 */
function manejarSeleccionFecha(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const opciones = (sesion.opcionesMostradas as OpcionFechaAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  const seleccion = resolverSeleccionFecha(mensaje, opciones);
  if (!seleccion) {
    return { accion: "continuar", respuesta: textoSeleccionInvalidaFecha(opciones) };
  }

  // FASE 5 -- la fecha fue elegida, pero calcular los horarios reales de ESE
  // día exige el motor de disponibilidad + Nylas (async, UNA sola consulta,
  // ver lib/agenda-v2/disponibilidad.ts) -- router.ts termina la transición.
  return { accion: "fecha_seleccionada", fechaIso: seleccion.fechaIso };
}

/**
 * FASE 5 -- S4_HORA. Mismo patrón EXACTO. Guarda el slot elegido
 * (fecha_iso + hora) en slot_seleccionado y avanza a S5_CONFIRMAR -- esa
 * fase todavía no existe (autorizado explícitamente a no implementarla
 * acá), así que por ahora sí responde con el texto de confirmación pedido,
 * sin construir ningún menú nuevo.
 */
function manejarSeleccionHora(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const opciones = (sesion.opcionesMostradas as OpcionHoraAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  const seleccion = resolverSeleccionHora(mensaje, opciones);
  if (!seleccion) {
    return { accion: "continuar", respuesta: textoSeleccionInvalidaHora(opciones) };
  }

  return {
    accion: "continuar",
    respuesta: RESPUESTA_HORA_SELECCIONADA,
    cambios: {
      step: "S5_CONFIRMAR",
      slotSeleccionado: { fechaIso: seleccion.fechaIso, hora: seleccion.hora },
      // Se limpia -- esas opciones eran del paso de hora, ya no
      // corresponden al paso siguiente (todavía sin implementar).
      opcionesMostradas: null,
    },
  };
}
