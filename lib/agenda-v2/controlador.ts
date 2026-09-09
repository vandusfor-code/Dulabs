/**
 * AGENDA V2 (autorizado) — controlador de mensajes para una sesión YA
 * activa. S1_SERVICIO tiene dos sub-fases (ver lib/agenda-v2/categorias.ts
 * para el porqué de no agregar un `step` nuevo): primero categoría, luego
 * servicio de esa categoría. FASE 3 implementa S2_PROFESIONAL. FASES 4/5
 * implementan S3_DIA y S4_HORA. FASE 6 implementa S5_CONFIRMAR (resumen +
 * confirmar/cambiar fecha/cambiar hora/cancelar -- NUNCA crea la cita real
 * todavía, eso es la Fase 7).
 */
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import type { CambiosSesionAgendaV2, SesionAgendaV2 } from "@/lib/agenda-v2/sesiones";
import { resolverSeleccionMultiServicio, textoSeleccionInvalidaServicio, type OpcionServicioAgendaV2 } from "@/lib/agenda-v2/servicios";
import { esOpcionCategoria, resolverSeleccionCategoria, textoSeleccionInvalidaCategoria, type OpcionCategoriaAgendaV2 } from "@/lib/agenda-v2/categorias";
import { resolverSeleccionProfesional, textoSeleccionInvalidaProfesional, type OpcionProfesionalAgendaV2 } from "@/lib/agenda-v2/profesionales";
import { resolverSeleccionFecha, textoSeleccionInvalidaFecha, esSeleccionVerMasFechas, type OpcionFechaAgendaV2 } from "@/lib/agenda-v2/fechas";
import { resolverSeleccionHora, textoSeleccionInvalidaHora, type OpcionHoraAgendaV2 } from "@/lib/agenda-v2/horas";
import { resolverSeleccionConfirmacion, textoSeleccionInvalidaConfirmacion, type OpcionConfirmacionAgendaV2 } from "@/lib/agenda-v2/confirmacion";
import {
  resolverSeleccionCita,
  textoSeleccionInvalidaCitas,
  resolverSeleccionSiNo,
  textoSeleccionInvalidaSiNo,
  MENSAJE_CANCELACION_ABANDONADA,
  MENSAJE_REPROGRAMACION_ABANDONADA,
  type OpcionCitaAgendaV2,
  type OpcionSiNoAgendaV2,
} from "@/lib/agenda-v2/gestion-citas";

export const RESPUESTA_PLACEHOLDER_AGENDA_V2 = "Agenda V2 activa. Selecciona una opción.";
const RESPUESTA_CANCELACION = "Listo, cancelé tu proceso de agenda 💗 Escríbeme cuando quieras retomarlo.";
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
  // FASE 3 (multi-servicio, autorizado) -- `servicioIds` siempre es un
  // array de 1 a 3 elementos (nunca vacío) -- una selección de un solo
  // servicio es simplemente un array de un elemento, mismo dato que antes.
  | { accion: "servicio_seleccionado"; servicioIds: string[] }
  // FASE 4 -- el profesional fue elegido, pero calcular los días candidatos
  // reales exige el motor de disponibilidad + Nylas (async) -- misma razón
  // que las dos anteriores. Ver lib/agenda-v2/disponibilidad.ts.
  | { accion: "profesional_seleccionado"; profesionalId: number }
  // FASE 5 -- la fecha fue elegida, pero calcular los horarios reales de ESE
  // día exige el mismo motor async. Ver lib/agenda-v2/disponibilidad.ts.
  | { accion: "fecha_seleccionada"; fechaIso: string }
  // Corrección post-deploy (autorizada, "Ver más fechas") -- se pidió ver
  // fechas posteriores a las ya mostradas, para el MISMO servicio(s)/
  // profesional ya elegidos. Calcular esas fechas exige el mismo motor
  // async de disponibilidad (Fase 4) -- router.ts resuelve la transición,
  // el controlador se queda puro/síncrono.
  | { accion: "ver_mas_fechas_solicitado" }
  // FASE 6 -- la hora fue elegida, pero armar el resumen real (nombre del
  // servicio/profesional, precio, duración) exige datos async -- router.ts
  // termina la transición a S5_CONFIRMAR con el resumen ya armado.
  | { accion: "hora_seleccionada"; fechaIso: string; hora: string }
  // FASE 6 -- desde S5_CONFIRMAR, "cambiar fecha"/"cambiar hora" exigen
  // recalcular disponibilidad real (async, reutilizando el mismo motor de
  // las Fases 4/5) -- router.ts resuelve ambas transiciones.
  | { accion: "confirmacion_cambiar_fecha" }
  | { accion: "confirmacion_cambiar_hora" }
  // FASE 7 -- "Confirmar cita" fue elegido; crear la reserva real exige
  // revalidar disponibilidad + crearCitaConNylas (async, Supabase + Nylas
  // reales) -- router.ts resuelve toda esta transición. FASE 8 reutiliza
  // ESTA MISMA acción para el paso final de una reprogramación (si
  // sesion.citaObjetivoId está fijado, router.ts llama actualizarCitaConNylas
  // en vez de crearCitaConNylas -- el controlador nunca lo decide).
  | { accion: "confirmacion_confirmar" }
  // FASE 8 -- se eligió (número exacto) cuál de varias citas gestionar;
  // según sesion.accionGestion, router.ts decide si consulta/pide confirmar
  // cancelación/pide confirmar inicio de reprogramación (async, requiere los
  // datos reales de servicio/profesional de esa cita).
  | { accion: "cita_seleccionada_para_gestion"; citaId: number }
  // FASE 8 -- "Sí, cancelar" fue elegido; ejecutar la cancelación real
  // (async, Supabase + best-effort Nylas) vive en router.ts.
  | { accion: "cancelacion_confirmada" }
  // FASE 8 -- "Sí, reprogramar" fue elegido; calcular los días candidatos
  // reales para el MISMO servicio/profesional de la cita (async, reutiliza
  // la Fase 4 tal cual) vive en router.ts.
  | { accion: "reprogramar_confirmado_inicio" };

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

  if (sesion.step === "S5_CONFIRMAR") {
    return manejarConfirmacion(sesion, mensaje);
  }

  // FASE 8 -- gestión de citas existentes.
  if (sesion.step === "SG_SELECCIONAR_CITA") {
    return manejarSeleccionCitaGestion(sesion, mensaje);
  }

  if (sesion.step === "SG_CANCELAR_CONFIRMAR") {
    return manejarConfirmacionCancelar(sesion, mensaje);
  }

  if (sesion.step === "SG_REPROGRAMAR_CONFIRMAR_INICIO") {
    return manejarConfirmacionReprogramarInicio(sesion, mensaje);
  }

  // Defensivo -- red de seguridad exhaustiva (mismo criterio que el resto de
  // Agenda V2: nunca inventar, nunca romper) para cualquier step futuro que
  // todavía no tenga manejador propio.
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
  // FASE 3 (multi-servicio, autorizado) -- resolverSeleccionMultiServicio
  // acepta "1", "1 y 2", "1,2", "1 + 2", "1 y 2 y 3" (máximo 3, sin
  // duplicados, solo números que existan en las opciones ya mostradas). Con
  // un solo número el resultado es un array de un elemento -- el
  // comportamiento de un solo servicio queda idéntico en la práctica.
  const seleccion = resolverSeleccionMultiServicio(mensaje, opcionesServicio);
  if (!seleccion) {
    // Sección "ENTRADAS INVÁLIDAS" del pedido -- NUNCA avanza, NUNCA cambia
    // el servicio, NUNCA llama a nada externo. Vuelve a mostrar EXACTAMENTE
    // las mismas opciones ya guardadas (nunca una consulta nueva al catálogo).
    return { accion: "continuar", respuesta: textoSeleccionInvalidaServicio(opcionesServicio) };
  }

  // FASE 3 -- ya no se responde con un texto temporal: el siguiente mensaje
  // real es el menú de profesionales elegibles para ESTOS servicios. Eso
  // exige resolverEspecialistasElegiblesParaServicio/resolverEspecialistasParaMultiServicio
  // (async), así que router.ts termina la transición (step, servicioId(s), opcionesMostradas).
  return { accion: "servicio_seleccionado", servicioIds: seleccion.map((s) => s.servicioId) };
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
 *
 * Corrección post-deploy (autorizada, "Ver más fechas") -- `opcionesMostradas`
 * para este paso ya no es un arreglo plano, sino
 * `{ opciones, numeroVerMasFechas }` -- las fechas reales ya mostradas más,
 * si corresponde, el número real de "Ver más fechas" (`null` si no hay más
 * fechas dentro del horizonte). Los demás pasos de Agenda V2 conservan su
 * propio arreglo plano tal cual, sin ningún cambio.
 */
function manejarSeleccionFecha(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const datos = sesion.opcionesMostradas as { opciones: OpcionFechaAgendaV2[]; numeroVerMasFechas: number | null } | null;
  if (!datos || !Array.isArray(datos.opciones) || datos.opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  if (esSeleccionVerMasFechas(mensaje, datos.numeroVerMasFechas)) {
    // Corrección post-deploy (autorizada) -- "Ver más fechas" exige volver a
    // consultar el motor real de disponibilidad (nunca inventa fechas), así
    // que router.ts resuelve la transición -- el controlador se queda
    // puro/síncrono, mismo patrón EXACTO que el resto de Agenda V2.
    return { accion: "ver_mas_fechas_solicitado" };
  }

  const seleccion = resolverSeleccionFecha(mensaje, datos.opciones);
  if (!seleccion) {
    return { accion: "continuar", respuesta: textoSeleccionInvalidaFecha(datos.opciones, datos.numeroVerMasFechas) };
  }

  // FASE 5 -- la fecha fue elegida, pero calcular los horarios reales de ESE
  // día exige el motor de disponibilidad + Nylas (async, UNA sola consulta,
  // ver lib/agenda-v2/disponibilidad.ts) -- router.ts termina la transición.
  return { accion: "fecha_seleccionada", fechaIso: seleccion.fechaIso };
}

/**
 * FASE 5 -- S4_HORA. Mismo patrón EXACTO que los pasos anteriores.
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

  // FASE 6 -- ya no se responde con un texto temporal: el siguiente mensaje
  // real es el resumen de la cita (servicio/profesional/fecha/hora reales).
  // Eso exige datos async (nombre del servicio, precio, duración, nombre
  // del profesional), así que router.ts termina la transición a
  // S5_CONFIRMAR con el resumen ya armado.
  return { accion: "hora_seleccionada", fechaIso: seleccion.fechaIso, hora: seleccion.hora };
}

/**
 * FASE 6 -- S5_CONFIRMAR. Mismo patrón EXACTO: solo número exacto (1-4)
 * contra el menú de control guardado en la sesión (ver
 * lib/agenda-v2/confirmacion.ts) -- nunca fuzzy matching, nunca "sí"/"dale"/
 * "confirmo", nunca interpretación semántica.
 */
function manejarConfirmacion(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const opciones = (sesion.opcionesMostradas as OpcionConfirmacionAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  const seleccion = resolverSeleccionConfirmacion(mensaje, opciones);
  if (!seleccion) {
    // Sección "VALIDACIONES" del pedido -- número inválido: se mantiene en
    // S5_CONFIRMAR y se reenvía EXACTAMENTE el mismo menú de control.
    return { accion: "continuar", respuesta: textoSeleccionInvalidaConfirmacion() };
  }

  switch (seleccion.accion) {
    case "confirmar":
      // FASE 7 (autorizado) -- ya NO es un placeholder: la creación real
      // (revalidación + crearCitaConNylas + idempotencia) vive en router.ts,
      // el único lugar con acceso a Supabase/Nylas reales. El controlador
      // sigue puro/síncrono, nunca decide él mismo si la cita se crea.
      return { accion: "confirmacion_confirmar" };
    case "cambiar_fecha":
      // Opción 2 -- exige recalcular días candidatos reales (async,
      // reutilizando la Fase 4 tal cual) -- router.ts lo resuelve.
      return { accion: "confirmacion_cambiar_fecha" };
    case "cambiar_hora":
      // Opción 3 -- exige recalcular horarios reales para la fecha YA
      // elegida (async, reutilizando la Fase 5 tal cual) -- router.ts lo resuelve.
      return { accion: "confirmacion_cambiar_hora" };
    case "cancelar":
      // Opción 4 -- mismo cierre EXACTO que el comando global "cancelar"
      // (sección COMPORTAMIENTO -- Opción 4: nunca modifica ninguna cita
      // existente, solo cierra esta sesión de Agenda V2).
      return { accion: "cerrar_sesion", respuesta: RESPUESTA_CANCELACION };
  }
}

/**
 * FASE 8 -- SG_SELECCIONAR_CITA. La clienta tenía varias citas activas; se
 * resuelve cuál, contra las opciones REALES ya guardadas (ver
 * lib/agenda-v2/gestion-citas.ts) -- mismo patrón EXACTO de todo Agenda V2:
 * solo número exacto, nunca fuzzy.
 */
function manejarSeleccionCitaGestion(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const opciones = (sesion.opcionesMostradas as OpcionCitaAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  const seleccion = resolverSeleccionCita(mensaje, opciones);
  if (!seleccion) {
    return { accion: "continuar", respuesta: textoSeleccionInvalidaCitas(opciones) };
  }

  // router.ts decide qué hacer con esta cita (consultar/pedir confirmación de
  // cancelar/pedir confirmación de reprogramar) según sesion.accionGestion --
  // exige datos reales async (servicio/profesional de ESA cita puntual).
  return { accion: "cita_seleccionada_para_gestion", citaId: seleccion.citaId };
}

/**
 * FASE 8 -- SG_CANCELAR_CONFIRMAR. Resolución estricta 1 (sí)/2 (no) contra
 * el menú binario ya guardado -- nunca "sí"/"dale"/interpretación semántica.
 */
function manejarConfirmacionCancelar(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const opciones = (sesion.opcionesMostradas as OpcionSiNoAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  const seleccion = resolverSeleccionSiNo(mensaje, opciones);
  if (!seleccion) {
    return { accion: "continuar", respuesta: textoSeleccionInvalidaSiNo() };
  }

  if (seleccion.accion === "no") {
    // Nunca modifica ninguna cita existente -- solo cierra esta sesión de gestión.
    return { accion: "cerrar_sesion", respuesta: MENSAJE_CANCELACION_ABANDONADA };
  }
  // "sí" -- ejecutar la cancelación real (async, Supabase + best-effort Nylas) vive en router.ts.
  return { accion: "cancelacion_confirmada" };
}

/**
 * FASE 8 -- SG_REPROGRAMAR_CONFIRMAR_INICIO. Mismo patrón EXACTO que
 * manejarConfirmacionCancelar -- resolución estricta 1 (sí)/2 (no).
 */
function manejarConfirmacionReprogramarInicio(sesion: SesionAgendaV2, mensaje: string): ResultadoControladorAgendaV2 {
  const opciones = (sesion.opcionesMostradas as OpcionSiNoAgendaV2[] | null) ?? [];
  if (opciones.length === 0) {
    return { accion: "continuar", respuesta: RESPUESTA_MENU_PERDIDO };
  }

  const seleccion = resolverSeleccionSiNo(mensaje, opciones);
  if (!seleccion) {
    return { accion: "continuar", respuesta: textoSeleccionInvalidaSiNo() };
  }

  if (seleccion.accion === "no") {
    // Nunca modifica ninguna cita existente -- solo cierra esta sesión de gestión.
    return { accion: "cerrar_sesion", respuesta: MENSAJE_REPROGRAMACION_ABANDONADA };
  }
  // "sí" -- calcular los días candidatos reales para el MISMO servicio/profesional (async) vive en router.ts.
  return { accion: "reprogramar_confirmado_inicio" };
}
