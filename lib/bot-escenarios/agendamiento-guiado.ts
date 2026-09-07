/**
 * MODO AGENDA GUIADA (autorizado) — selección de servicio/profesional/fecha/
 * horario/confirmación mediante MENÚS DE TEXTO NUMERADOS, resueltos 100%
 * determinísticamente (número real u opción exacta ya mostrada). Gemini
 * NUNCA interviene en esta resolución -- ver decidirPasoGuiado en resolver.ts.
 *
 * Motivo de usar menús de texto (y no botones/listas nativas de WhatsApp):
 * el canal real de AMORE (WhatsApp-QR/Baileys, worker/) solo soporta
 * texto/emoji/audio hoy (ver lib/whatsapp-qr-bot.ts, comentario junto a
 * enviarBotones) -- confirmado con auditoría de código, no supuesto. El
 * mecanismo de resolución determinista por texto (número o label exacto)
 * logra el mismo objetivo arquitectónico (Gemini fuera del camino crítico,
 * decisiones basadas en IDs reales) sin tocar el worker de Baileys.
 *
 * Cada opción real (`MenuOpcionAgendamiento`) lleva su `id` real (UUID de
 * servicio, especialista_id como texto, fechaISO real, o un id de control
 * cerrado) y sus `sinonimos` (formas normalizadas contra las que se compara
 * texto libre) -- el `label` visible (con precio/duración/decoración) NUNCA
 * se usa tal cual para comparar, porque nunca coincidiría con lo que un
 * cliente realmente escribe (ej. "Dipping" vs "Dipping — $60.000 · 2 h").
 */
import type { ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import { formatearDuracion } from "@/lib/catalogo-servicios-flow-adaptador";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { sumarDias } from "@/lib/parse-fecha-colombia";
import { normalizarBasico } from "@/lib/bot-escenarios/agendamiento-entidades";
import { esCancelacionExplicitaDeReserva, esConfirmacionExplicitaDeReserva } from "@/lib/bot-escenarios/agendamiento-entidades";
import type { AgendamientoEnCurso, MenuAgendamiento, MenuOpcionAgendamiento, TipoMenuAgendamiento } from "@/lib/bot-escenarios/tipos";
import type { EspecialistaBasico } from "@/lib/bot-escenarios/resolver";

/** Sección 1/8/9 (autorizado) -- el backend decide cuántas opciones reales caben en un mensaje, nunca Gemini. Mismo criterio en los 4 menús paginables. */
const MAX_OPCIONES_MENU = 4;

type EntradaPaginable = { id: string; label: string; sinonimos: string[] };

/**
 * Pagina una lista real finita (servicios/profesionales/horarios) en
 * bloques de MAX_OPCIONES_MENU, agregando "Ver más..." cuando sobran
 * entradas -- reutilizado por los 3 menús de lista finita (fechas se genera
 * bajo demanda, no pagina una lista precomputada).
 */
function construirMenuPaginado(params: {
  tipo: TipoMenuAgendamiento;
  entradas: EntradaPaginable[];
  idVerMas: string;
  labelVerMas: string;
  /** Opción fija que SIEMPRE aparece al final de la página actual (ej. "Cualquier profesional") -- nunca queda oculta detrás de "Ver más". */
  opcionFinalFija?: EntradaPaginable;
}): MenuAgendamiento {
  const pagina = params.entradas.slice(0, MAX_OPCIONES_MENU);
  const resto = params.entradas.slice(MAX_OPCIONES_MENU);

  const opciones: MenuOpcionAgendamiento[] = pagina.map((e, i) => ({ numero: i + 1, ...e }));
  if (resto.length > 0) {
    opciones.push({ numero: opciones.length + 1, id: params.idVerMas, label: params.labelVerMas, sinonimos: [normalizarBasico(params.labelVerMas)] });
  }
  if (params.opcionFinalFija) {
    opciones.push({ numero: opciones.length + 1, ...params.opcionFinalFija });
  }

  return { tipo: params.tipo, opciones, pendientes: resto.length > 0 ? resto : undefined };
}

// ---------------------------------------------------------------------------
// Menú de servicios (paso 1)
// ---------------------------------------------------------------------------

/** Sección 2 (autorizado) -- EXCLUSIVAMENTE servicios reales y activos del catálogo del tenant (nunca inventados). */
export function construirMenuServicios(catalogo: ServicioCatalogoReal[]): MenuAgendamiento {
  const entradas: EntradaPaginable[] = catalogo.map((s) => ({
    id: s.id,
    label: `${s.nombre} — ${formatearPrecioCop(s.precio)} · ${formatearDuracion(s.duracionMin)}`,
    sinonimos: [normalizarBasico(s.nombre)],
  }));
  return construirMenuPaginado({ tipo: "servicio", entradas, idVerMas: "VER_MAS_SERVICIOS", labelVerMas: "Ver más servicios" });
}

/** Continúa la paginación de un menú de servicios ya mostrado ("Ver más servicios"). */
export function continuarMenuServicios(pendientes: EntradaPaginable[]): MenuAgendamiento {
  return construirMenuPaginado({ tipo: "servicio", entradas: pendientes, idVerMas: "VER_MAS_SERVICIOS", labelVerMas: "Ver más servicios" });
}

// ---------------------------------------------------------------------------
// Menú de profesionales (paso 2)
// ---------------------------------------------------------------------------

const OPCION_CUALQUIER_PROFESIONAL: EntradaPaginable = {
  id: "ANY",
  label: "Cualquier profesional",
  sinonimos: [normalizarBasico("Cualquier profesional"), normalizarBasico("cualquiera")],
};

/** Sección 4 (autorizado) -- EXCLUSIVAMENTE especialistas reales elegibles para el servicio ya elegido (resolverEspecialistasElegiblesParaServicio, nunca hardcodeado). "Cualquier profesional" es un id de control fijo, nunca un UUID inventado. */
export function construirMenuProfesionales(especialistas: EspecialistaBasico[]): MenuAgendamiento {
  const entradas: EntradaPaginable[] = especialistas.map((e) => ({
    id: String(e.id),
    label: e.nombre,
    sinonimos: [normalizarBasico(e.nombre)],
  }));
  return construirMenuPaginado({
    tipo: "profesional",
    entradas,
    idVerMas: "VER_MAS_PROFESIONALES",
    labelVerMas: "Ver más profesionales",
    opcionFinalFija: OPCION_CUALQUIER_PROFESIONAL,
  });
}

export function continuarMenuProfesionales(pendientes: EntradaPaginable[]): MenuAgendamiento {
  return construirMenuPaginado({
    tipo: "profesional",
    entradas: pendientes,
    idVerMas: "VER_MAS_PROFESIONALES",
    labelVerMas: "Ver más profesionales",
    opcionFinalFija: OPCION_CUALQUIER_PROFESIONAL,
  });
}

// ---------------------------------------------------------------------------
// Menú de fechas (paso 3)
// ---------------------------------------------------------------------------

function capitalizar(texto: string): string {
  return texto.length > 0 ? texto[0]!.toUpperCase() + texto.slice(1) : texto;
}

/** "viernes 11 de septiembre" (America/Bogota) a partir de un fechaISO YYYY-MM-DD ya resuelto -- nunca calculado por Gemini. */
export function formatearFechaLarga(fechaISO: string): string {
  const ancla = new Date(`${fechaISO}T12:00:00-05:00`);
  const texto = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(ancla);
  return capitalizar(texto.replace(",", ""));
}

/**
 * Sección 5 (autorizado) -- fechas reales generadas determinísticamente en
 * America/Bogota a partir de `hoyISO`, nunca interpretadas por Gemini.
 * `offsetDias` (0 = empieza hoy) permite continuar con "Ver más fechas" sin
 * repetir las ya mostradas.
 */
export function construirMenuFechas(hoyISO: string, offsetDias = 0): MenuAgendamiento {
  const opciones: MenuOpcionAgendamiento[] = [];
  for (let i = 0; i < MAX_OPCIONES_MENU; i++) {
    const fechaISO = sumarDias(hoyISO, offsetDias + i);
    const label = formatearFechaLarga(fechaISO);
    opciones.push({ numero: i + 1, id: fechaISO, label, sinonimos: [normalizarBasico(label)] });
  }
  opciones.push({
    numero: MAX_OPCIONES_MENU + 1,
    id: "VER_MAS_FECHAS",
    label: "Ver más fechas",
    sinonimos: [normalizarBasico("Ver más fechas"), normalizarBasico("ver mas")],
  });
  return { tipo: "fecha", opciones, offsetFechas: offsetDias + MAX_OPCIONES_MENU };
}

// ---------------------------------------------------------------------------
// Menú de horarios (paso 4)
// ---------------------------------------------------------------------------

export interface SlotHorarioReal {
  especialistaId: number;
  especialistaNombre: string;
  horaTexto: string;
  horaISO: string;
}

/** Exportada (autorizado, MODO AGENDA GUIADA) -- reutilizada por crearCitaNylasAction para redactar la confirmación real sin duplicar el formato AM/PM. */
export function formatearHora12(hhmm: string): string {
  const [horaStr, minStr] = hhmm.split(":");
  const hora = Number(horaStr);
  const periodo = hora >= 12 ? "PM" : "AM";
  let hora12 = hora % 12;
  if (hora12 === 0) hora12 = 12;
  return `${hora12}:${minStr} ${periodo}`;
}

/**
 * El id de una opción de horario NUNCA puede ser solo `horaISO`: dos
 * especialistas distintas pueden tener libre exactamente la misma hora
 * (ej. Cristal y Mary ambas a las 8:00), y dos opciones con el mismo id
 * romperían la resolución determinista. Se compone especialistaId+horaISO
 * (separador que nunca aparece en ninguno de los dos) para que cada slot
 * real tenga un id único, y se puede reconstruir el slot completo con
 * `parseSlotHorarioId` -- nunca se re-consulta Nylas para recuperarlo.
 */
function idDeSlot(slot: SlotHorarioReal): string {
  return `${slot.especialistaId}::${slot.horaISO}`;
}

export function parseSlotHorarioId(id: string): { especialistaId: number; horaISO: string } | null {
  const [especialistaIdTexto, horaISO] = id.split("::");
  const especialistaId = Number(especialistaIdTexto);
  if (!especialistaIdTexto || !horaISO || !Number.isFinite(especialistaId)) return null;
  return { especialistaId, horaISO };
}

function slotAEntrada(slot: SlotHorarioReal): EntradaPaginable {
  return {
    id: idDeSlot(slot),
    label: `${slot.especialistaNombre} — ${formatearHora12(slot.horaTexto)}`,
    sinonimos: [normalizarBasico(`${slot.especialistaNombre} ${slot.horaTexto}`)],
  };
}

/**
 * Sección 7/8/9 (autorizado) -- slots REALES ya resueltos por Nylas
 * (disponibilidad-servicio-nylas.ts, sin cambios), ordenados cronológicamente
 * por el caller. Máximo 4 por menú; "Ver más horarios" nunca le pide a
 * Gemini que resuma, el backend controla exactamente la paginación.
 */
export function construirMenuHorarios(slotsOrdenados: SlotHorarioReal[]): MenuAgendamiento {
  const entradas = slotsOrdenados.map(slotAEntrada);
  return construirMenuPaginado({ tipo: "horario", entradas, idVerMas: "VER_MAS_HORARIOS", labelVerMas: "Ver más horarios" });
}

export function continuarMenuHorarios(pendientes: Array<{ id: string; label: string; sinonimos: string[] }>): MenuAgendamiento {
  return construirMenuPaginado({ tipo: "horario", entradas: pendientes, idVerMas: "VER_MAS_HORARIOS", labelVerMas: "Ver más horarios" });
}

// ---------------------------------------------------------------------------
// Menú de confirmación (paso 5)
// ---------------------------------------------------------------------------

export const ID_CONFIRMAR_CITA = "CONFIRM_APPOINTMENT";
export const ID_CAMBIAR_HORARIO = "CAMBIAR_HORARIO";
export const ID_CANCELAR = "CANCELAR";

/** Sección 11 (autorizado) -- 3 opciones fijas, siempre las mismas. La confirmación real es un ID estructurado (ID_CONFIRMAR_CITA), nunca la interpretación de "sí" por Gemini. */
export function construirMenuConfirmacion(): MenuAgendamiento {
  return {
    tipo: "confirmacion",
    opciones: [
      { numero: 1, id: ID_CONFIRMAR_CITA, label: "Confirmar cita", sinonimos: [normalizarBasico("Confirmar cita"), normalizarBasico("confirmar")] },
      { numero: 2, id: ID_CAMBIAR_HORARIO, label: "Cambiar horario", sinonimos: [normalizarBasico("Cambiar horario")] },
      { numero: 3, id: ID_CANCELAR, label: "Cancelar", sinonimos: [normalizarBasico("Cancelar")] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Resolución determinista de la respuesta del cliente contra el menú real
// ---------------------------------------------------------------------------

/**
 * Resuelve la respuesta del cliente contra el menú REALMENTE mostrado.
 * Orden de resolución (nunca aproximado, nunca semántico):
 * 1. Número exacto ("1", "2"...) contra `numero`.
 * 2. Coincidencia exacta contra `id` (defensivo -- un caller estructurado
 *    podría pasar el id real directamente).
 * 3. Coincidencia EXACTA (tras normalizar) contra alguno de los `sinonimos`
 *    de la opción -- nunca "contains", nunca difuso.
 * 4. SOLO para tipo="confirmacion": el vocabulario cerrado ya existente
 *    (esConfirmacionExplicitaDeReserva/esCancelacionExplicitaDeReserva)
 *    también resuelve, para que "sí"/"cancela" sigan funcionando como
 *    atajos naturales sin dejar de ser determinista (sección 11 del pedido).
 * Si nada de esto coincide de forma inequívoca -> undefined (el caller pide
 * de nuevo, nunca inventa ni infiere).
 */
export function resolverSeleccionMenu(mensaje: string, menu: MenuAgendamiento): MenuOpcionAgendamiento | undefined {
  const texto = mensaje.trim();
  if (!texto) return undefined;

  if (/^\d+$/.test(texto)) {
    const numero = Number(texto);
    const porNumero = menu.opciones.find((o) => o.numero === numero);
    if (porNumero) return porNumero;
  }

  const porId = menu.opciones.find((o) => o.id === texto);
  if (porId) return porId;

  const normalizado = normalizarBasico(texto);
  const porSinonimo = menu.opciones.find((o) => o.sinonimos.includes(normalizado));
  if (porSinonimo) return porSinonimo;

  if (menu.tipo === "confirmacion") {
    if (esConfirmacionExplicitaDeReserva(mensaje)) return menu.opciones.find((o) => o.id === ID_CONFIRMAR_CITA);
    if (esCancelacionExplicitaDeReserva(mensaje)) return menu.opciones.find((o) => o.id === ID_CANCELAR);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Renderizado de texto (nunca redactado por Gemini)
// ---------------------------------------------------------------------------

function renderizarOpciones(menu: MenuAgendamiento): string {
  return menu.opciones.map((o) => `${o.numero}. ${o.label}`).join("\n");
}

/**
 * Construye el resumen de confirmación (sección 11) a partir de los campos
 * YA reales del acumulador -- nunca vuelve a consultar el catálogo/Nylas,
 * nunca redactado por Gemini.
 */
function renderizarResumenConfirmacion(actual: AgendamientoEnCurso): string {
  const lineas = [
    "Perfecto 💗",
    "",
    `Servicio: ${actual.servicioNombre ?? ""}`,
    `Profesional: ${actual.especialistaSeleccionadaNombre ?? ""}`,
  ];
  if (actual.horarioSeleccionadoISO) {
    const [fechaISO, horaConOffset] = actual.horarioSeleccionadoISO.split("T");
    const hhmm = (horaConOffset ?? "").slice(0, 5);
    lineas.push(`Fecha: ${formatearFechaLarga(fechaISO!)}`);
    lineas.push(`Hora: ${formatearHora12(hhmm)}`);
  }
  if (actual.duracionMin) lineas.push(`Duración: ${formatearDuracion(actual.duracionMin)}`);
  if (actual.precio !== undefined) lineas.push(`Valor: ${formatearPrecioCop(actual.precio)}`);
  lineas.push("", "¿Deseas confirmar tu cita?");
  return lineas.join("\n");
}

const ENCABEZADO_POR_TIPO: Record<Exclude<TipoMenuAgendamiento, "horario" | "confirmacion">, string> = {
  servicio: "¿Qué servicio deseas realizarte? 💗",
  profesional: "¿Tienes alguna profesional de preferencia?",
  fecha: "¿Qué día prefieres?",
};

/**
 * Único punto de renderizado de texto para el modo guiado -- se reconstruye
 * SIEMPRE a partir de `menu`/`actual` (nunca se persiste texto ya armado),
 * así que reenviar el mismo menú tras una interrupción informativa (sección
 * 21) o una selección inválida (sección "RESPUESTAS DE TEXTO") es siempre
 * exactamente el mismo mensaje.
 */
export function renderizarMenu(menu: MenuAgendamiento, actual: AgendamientoEnCurso): string {
  if (menu.tipo === "horario") {
    const fecha = actual.fechaISO ? ` para el ${formatearFechaLarga(actual.fechaISO)}` : "";
    return `Estos son los horarios disponibles${fecha} 💗\n\n${renderizarOpciones(menu)}`;
  }
  if (menu.tipo === "confirmacion") {
    return `${renderizarResumenConfirmacion(actual)}\n\n${renderizarOpciones(menu)}`;
  }
  return `${ENCABEZADO_POR_TIPO[menu.tipo]}\n\n${renderizarOpciones(menu)}`;
}

export function textoSeleccionInvalida(menu: MenuAgendamiento, actual: AgendamientoEnCurso): string {
  return `Por favor selecciona una de las opciones disponibles 💗\n\n${renderizarMenu(menu, actual)}`;
}
