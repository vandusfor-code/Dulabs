/**
 * Resolver genérico del banco de escenarios (autorizado, AMORE primer
 * tenant). Orquesta: cargar escenarios activos + catálogo real -> extraer
 * entidades deterministas -> decidir escenario ganador (prioridad) ->
 * producir la respuesta (o los datos para el único nodo IA del flow).
 * Pura respecto a I/O real: recibe funciones de carga inyectables (mismo
 * patrón `deps` ya usado en internal-action-executor.ts) para poder
 * probarse sin Supabase real.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatearDuracion,
  listarCatalogoServiciosReal,
  listarProfesionalesServicioReal,
  type ServicioCatalogoReal,
} from "@/lib/catalogo-servicios-flow-adaptador";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { fechaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import { esServicioDeCaballero, extraerEntidades } from "@/lib/bot-escenarios/entidades";
import { resolverEscenarioGanador } from "@/lib/bot-escenarios/matching";
import { elegirYRenderizarPlantilla } from "@/lib/bot-escenarios/plantillas";
import { cargarConocimientoReal } from "@/lib/bot-escenarios/store";
import {
  detectarEspecialistaMencionada,
  esCancelacionExplicitaDeReserva,
  esConfirmacionExplicitaDeReserva,
  extraerFechaMencionada,
  extraerHoraOBloqueMencionado,
} from "@/lib/bot-escenarios/agendamiento-entidades";
import { especialistasDelTenant } from "@/lib/especialistas";
import { nombreConocido, recordarNombreCliente } from "@/lib/clientes-conocidos";
import { parseCumpleanosNatural } from "@/lib/cumpleanos/parse-cumpleanos-natural";
import {
  CODIGO_ESCENARIO_AGENDAMIENTO,
  CODIGO_ESCENARIO_FALLBACK,
  CODIGO_ESCENARIO_PORTAL,
  type AgendamientoEnCurso,
  type ConocimientoServicio,
  type ContextoConversacional,
  type EntidadesDetectadas,
  type EscenarioRow,
  type ReferenciaOpcionMostrada,
  type ResultadoResolucion,
} from "@/lib/bot-escenarios/tipos";

/** Especialista real mínimo para detección de menciones -- FASE 1 (autorizado). */
export interface EspecialistaBasico {
  id: number;
  nombre: string;
}

async function cargarEspecialistasReal(supabase: SupabaseClient, tenantId: string): Promise<EspecialistaBasico[]> {
  const especialistas = await especialistasDelTenant(supabase, tenantId);
  return especialistas.filter((e) => e.activo).map((e) => ({ id: e.id, nombre: e.nombre }));
}

export interface ResolverEscenarioDeps {
  cargarEscenarios: (supabase: SupabaseClient, tenantId: string) => Promise<EscenarioRow[]>;
  cargarCatalogo?: typeof listarCatalogoServiciosReal;
  cargarProfesionales?: typeof listarProfesionalesServicioReal;
  cargarConocimiento?: typeof cargarConocimientoReal;
  /** FASE 1 -- Agendamiento conversacional (autorizado). Default real: cargarEspecialistasReal (envoltorio de especialistasDelTenant, lib/especialistas.ts, sin duplicar). */
  cargarEspecialistas?: (supabase: SupabaseClient, tenantId: string) => Promise<EspecialistaBasico[]>;
  /** FASE 1 -- inyectable para tests, default real: nombreConocido (lib/clientes-conocidos.ts). */
  buscarNombreConocido?: typeof nombreConocido;
  /** Revisión (autorizada, sección 14) -- inyectable para tests, default real: recordarNombreCliente (lib/clientes-conocidos.ts). Guarda el registro inicial (nombre + cumpleaños) de un cliente genuinamente nuevo. */
  guardarNombreCliente?: typeof recordarNombreCliente;
}

function construirSinonimos(escenarios: EscenarioRow[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  for (const e of escenarios) {
    if (e.config.filtroCategoria && e.config.sinonimos?.length) {
      mapa.set(e.config.filtroCategoria, e.config.sinonimos);
    }
  }
  return mapa;
}

function filtrarCatalogo(
  catalogo: ServicioCatalogoReal[],
  params: {
    categoria?: string;
    /** OR: cualquiera de estas palabras en el nombre. */
    nombreContiene?: string[];
    /** AND: TODAS estas palabras deben aparecer en el nombre (ej. "manos y pies" -- prueba real de WhatsApp). */
    nombreContieneTodas?: string[];
    presupuestoMax?: number;
    duracionMaxMin?: number;
  },
): ServicioCatalogoReal[] {
  return catalogo.filter((s) => {
    if (params.categoria && s.categoria !== params.categoria) return false;
    if (params.nombreContiene?.length && !params.nombreContiene.some((n) => s.nombre.toLowerCase().includes(n.toLowerCase()))) return false;
    if (params.nombreContieneTodas?.length && !params.nombreContieneTodas.every((n) => s.nombre.toLowerCase().includes(n.toLowerCase()))) return false;
    if (params.presupuestoMax !== undefined && s.precio > params.presupuestoMax) return false;
    if (params.duracionMaxMin !== undefined && s.duracionMin > params.duracionMaxMin) return false;
    return true;
  });
}

/**
 * Prueba real de WhatsApp (autorizado) — "Quiero arreglarme las uñas" NUNCA
 * debe asumir un servicio de caballero sin evidencia explícita ("caballero",
 * "hombre", "masculino") en el propio mensaje. Se aplica SIEMPRE que se
 * listan opciones reales de una categoría (nunca al resolver un servicio
 * puntual ya nombrado explícitamente, ni a la comparación entre 2 servicios
 * ya identificados) -- si el filtro deja la lista vacía (categoría que solo
 * tiene servicios marcados), se muestra igual la lista sin filtrar, en vez
 * de dejar a la clienta sin ninguna opción real.
 */
function aplicarFiltroGenero(items: ServicioCatalogoReal[], indicaGeneroMasculino: boolean): ServicioCatalogoReal[] {
  const filtrados = items.filter((s) => esServicioDeCaballero(s.nombre) === indicaGeneroMasculino);
  return filtrados.length > 0 ? filtrados : items;
}

function contextoLimpio(): ContextoConversacional {
  return {};
}

/**
 * Prueba real de WhatsApp (autorizado) — resuelve una referencia ("la de 30
 * mil", "la segunda", "la más barata"...) contra las opciones REALES que el
 * bot ya mostró (nunca contra el catálogo completo). Ambigüedad real (dos
 * opciones con el mismo precio/duración) nunca se adivina -- se pide
 * aclaración explícita.
 */
type ResultadoReferenciaOpcion =
  | { tipo: "resuelto"; servicio: ServicioCatalogoReal }
  | { tipo: "ambiguo"; empatados: ServicioCatalogoReal[] }
  | { tipo: "no_encontrado" };

function resolverReferenciaOpcion(
  referencia: ReferenciaOpcionMostrada,
  opciones: ServicioCatalogoReal[],
): ResultadoReferenciaOpcion {
  if (opciones.length === 0) return { tipo: "no_encontrado" };

  switch (referencia.tipo) {
    case "ordinal": {
      const indice = referencia.posicion === -1 ? opciones.length - 1 : referencia.posicion - 1;
      const servicio = opciones[indice];
      return servicio ? { tipo: "resuelto", servicio } : { tipo: "no_encontrado" };
    }
    case "precio": {
      const coincidencias = opciones.filter((s) => s.precio === referencia.monto);
      if (coincidencias.length === 0) return { tipo: "no_encontrado" };
      if (coincidencias.length > 1) return { tipo: "ambiguo", empatados: coincidencias };
      return { tipo: "resuelto", servicio: coincidencias[0]! };
    }
    case "duracion": {
      const coincidencias = opciones.filter((s) => s.duracionMin === referencia.minutos);
      if (coincidencias.length === 0) return { tipo: "no_encontrado" };
      if (coincidencias.length > 1) return { tipo: "ambiguo", empatados: coincidencias };
      return { tipo: "resuelto", servicio: coincidencias[0]! };
    }
    case "extremo": {
      const ordenados = [...opciones].sort((a, b) => (referencia.cual === "barata" ? a.precio - b.precio : b.precio - a.precio));
      const mejorPrecio = ordenados[0]!.precio;
      const empatados = ordenados.filter((s) => s.precio === mejorPrecio);
      if (empatados.length > 1) return { tipo: "ambiguo", empatados };
      return { tipo: "resuelto", servicio: ordenados[0]! };
    }
    case "demostrativo":
      return opciones.length === 1 ? { tipo: "resuelto", servicio: opciones[0]! } : { tipo: "no_encontrado" };
  }
}

/**
 * Continuación comparativa corta (sección 5 del pedido, autorizado): "¿Y el
 * Press On?" tras hablar de Dipping. Vocabulario cerrado de español (función
 * gramatical, no dato de negocio), mismo criterio que
 * AFIRMACIONES_CORTAS/NEGACIONES_CORTAS de entidades.ts.
 */
const PATRON_CONTINUACION_COMPARATIVA = /(^|[\s¿¡])(y|que tal|y que tal|y que hay de)\s/;
function pareceContinuacionComparativa(mensaje: string): boolean {
  return PATRON_CONTINUACION_COMPARATIVA.test(normalizeText(mensaje));
}

async function resolverModoCatalog(params: {
  escenario: EscenarioRow;
  entidades: EntidadesDetectadas;
  contexto: ContextoConversacional;
  catalogo: ServicioCatalogoReal[];
  tenantId: string;
  turno: number;
  supabase: SupabaseClient;
  cargarProfesionales: typeof listarProfesionalesServicioReal;
}): Promise<ResultadoResolucion> {
  const { escenario, entidades, contexto, catalogo, tenantId, turno } = params;

  // Nota (autorizado) — la comparación entre 2 servicios reales YA NO se
  // resuelve acá: 051_comparacion pasa a modo=ai (ver resolverModoAi) para
  // que la IA redacte naturalmente en vez de un disclaimer fijo. Esta
  // función (modo=catalog) nunca recibe en la práctica
  // entidades.serviciosDetectados.length>=2, porque el único escenario con
  // la variante dos_servicios_detectados (051) siempre gana esa prioridad.

  const servicioId = entidades.servicioId ?? (entidades.esAfirmacionCorta ? undefined : contexto.ultimoServicioId);
  const servicio = servicioId ? catalogo.find((s) => s.id === servicioId) : undefined;

  if (servicio) {
    let profesionalesTexto = "";
    if (escenario.config.necesitaProfesionales) {
      const resultado = await params.cargarProfesionales(params.supabase, tenantId, servicio.id);
      profesionalesTexto = resultado.profesionales.length > 0 ? resultado.profesionales.join(", ") : "";
    }
    const variables = {
      servicio: servicio.nombre,
      precio: servicio.precio,
      precioTexto: formatearPrecioCop(servicio.precio),
      duracionTexto: formatearDuracion(servicio.duracionMin),
      profesionalesTexto,
      descripcion: servicio.descripcion ?? "",
      // Nunca se afirma una descripción cuando no existe (regla de
      // honestidad) -- vacío cuando descripcion es null, así una plantilla
      // que la referencia al final nunca inventa ni deja un hueco raro.
      descripcionExtra: servicio.descripcion ? `\n\n${servicio.descripcion}` : "",
    };
    const respuestaTexto = elegirYRenderizarPlantilla({
      respuestas: escenario.respuestas,
      tenantId,
      escenarioCodigo: escenario.codigo,
      turno,
      variables,
    });
    return {
      escenarioCodigo: escenario.codigo,
      modo: "catalog",
      respuestaTexto,
      requiereIA: false,
      contexto: {
        ultimoServicioId: servicio.id,
        ultimoServicioNombre: servicio.nombre,
        ultimaCategoria: servicio.categoria ?? undefined,
        ultimaAccionSugerida: "ofrecer_portal",
        ultimasOpcionesIds: [servicio.id],
      },
    };
  }

  // Sin servicio puntual: si la categoría (propia o detectada) sí resuelve,
  // se muestran 2-3 opciones reales de esa categoría -- NUNCA el catálogo
  // completo (regla explícita del pedido). Prueba real de WhatsApp
  // (autorizado) -- nunca asume género: excluye servicios marcados de
  // caballero salvo evidencia explícita en el mensaje.
  const categoria = escenario.config.filtroCategoria ?? entidades.categoria ?? contexto.ultimaCategoria;
  if (categoria) {
    const candidatos = filtrarCatalogo(catalogo, {
      categoria,
      nombreContiene: escenario.config.filtroNombreContiene,
      nombreContieneTodas: escenario.config.filtroNombreContieneTodas,
      presupuestoMax: entidades.presupuestoMax,
      duracionMaxMin: entidades.duracionMaxMin,
    });
    const opciones = aplicarFiltroGenero(candidatos, entidades.indicaGeneroMasculino).slice(0, 3);
    if (opciones.length > 0) {
      const opcionesTexto = opciones
        .map((s) => `${s.nombre} — ${formatearPrecioCop(s.precio)} (${formatearDuracion(s.duracionMin)})`)
        .join("\n");
      const respuestaTexto = elegirYRenderizarPlantilla({
        respuestas: escenario.respuestas,
        tenantId,
        escenarioCodigo: escenario.codigo,
        turno,
        variables: { opcionesTexto, categoria },
      });
      return {
        escenarioCodigo: escenario.codigo,
        modo: "catalog",
        respuestaTexto,
        requiereIA: false,
        contexto: { ultimaCategoria: categoria, ultimasOpcionesIds: opciones.map((o) => o.id) },
      };
    }
  }

  return {
    escenarioCodigo: escenario.codigo,
    modo: "catalog",
    respuestaTexto: escenario.config.respuestaSinServicio,
    requiereIA: false,
    contexto,
  };
}

function mapearServicioParaIA(s: ServicioCatalogoReal) {
  return {
    nombre: s.nombre,
    precio: s.precio,
    precioTexto: formatearPrecioCop(s.precio),
    duracionMin: s.duracionMin,
    duracionTexto: formatearDuracion(s.duracionMin),
    categoria: s.categoria,
    descripcion: s.descripcion,
  };
}

/**
 * Ficha de conocimiento GENERAL de un servicio -- SIEMPRE con su `fuente`
 * declarada, para que la IA nunca la confunda con un hecho confirmado de
 * AMORE (esos viven en mapearServicioParaIA/datosIA, nunca acá). Cuando el
 * servicio no tiene ficha sembrada, se devuelve honesto (todo null,
 * fuente="no_confirmado") -- nunca se omite la entrada ni se inventa texto.
 */
function mapearConocimientoParaIA(s: ServicioCatalogoReal, porServicio: Map<string, ConocimientoServicio>) {
  const ficha = porServicio.get(s.id);
  return {
    servicio: s.nombre,
    queEs: ficha?.queEs ?? null,
    paraQueSirve: ficha?.paraQueSirve ?? null,
    limites: ficha?.limites ?? null,
    fuente: ficha?.fuente ?? "no_confirmado",
  };
}

function resolverModoAi(params: {
  escenario: EscenarioRow;
  entidades: EntidadesDetectadas;
  contexto: ContextoConversacional;
  catalogo: ServicioCatalogoReal[];
  conocimientoPorServicio: Map<string, ConocimientoServicio>;
}): ResultadoResolucion {
  const { escenario, entidades, contexto, catalogo, conocimientoPorServicio } = params;

  // Prueba real de WhatsApp (autorizado) — comparación entre 2 servicios
  // reales SIEMPRE se resuelve ANTES que cualquier otra rama: "¿Qué
  // diferencia hay entre Dipping y Press On?" nunca debe responder solo del
  // más específico de los dos (bug real encontrado). Se le entrega a la IA
  // el conocimiento general de AMBOS, por separado de los hechos
  // confirmados -- 051_comparacion (modo=ai) redacta naturalmente, nunca un
  // disclaimer fijo.
  if (entidades.serviciosDetectados.length >= 2) {
    const [a, b] = entidades.serviciosDetectados;
    const servicioA = catalogo.find((s) => s.id === a!.id);
    const servicioB = catalogo.find((s) => s.id === b!.id);
    if (servicioA && servicioB) {
      return {
        escenarioCodigo: escenario.codigo,
        modo: "ai",
        requiereIA: true,
        instruccionIA: escenario.config.instruccionIA ?? "",
        datosIA: [mapearServicioParaIA(servicioA), mapearServicioParaIA(servicioB)],
        conocimientoGeneral: [
          mapearConocimientoParaIA(servicioA, conocimientoPorServicio),
          mapearConocimientoParaIA(servicioB, conocimientoPorServicio),
        ],
        contexto: {
          ultimoServicioId: servicioA.id,
          ultimoServicioNombre: servicioA.nombre,
          ultimoServicioBId: servicioB.id,
          ultimoServicioBNombre: servicioB.nombre,
          ultimaCategoria: servicioA.categoria ?? undefined,
          ultimaAccionSugerida: "comparando",
          ultimasOpcionesIds: [servicioA.id, servicioB.id],
        },
      };
    }
  }

  // Sección 5 del pedido (autorizado) — "¿Cuál me recomiendas?" después de
  // una comparación activa ("Me interesa el Dipping" -> "¿Y el Press On?")
  // debe recomendar ENTRE ESOS DOS, nunca reabrir a todo el catálogo. Solo
  // aplica si el mensaje actual no trae una categoría/servicio nuevo que
  // reemplace la comparación en curso.
  if (contexto.ultimoServicioBId && !entidades.categoria && entidades.serviciosDetectados.length === 0) {
    const a = catalogo.find((s) => s.id === contexto.ultimoServicioId);
    const b = catalogo.find((s) => s.id === contexto.ultimoServicioBId);
    if (a && b) {
      return {
        escenarioCodigo: escenario.codigo,
        modo: "ai",
        requiereIA: true,
        instruccionIA: escenario.config.instruccionIA ?? "",
        datosIA: [mapearServicioParaIA(a), mapearServicioParaIA(b)],
        conocimientoGeneral: [mapearConocimientoParaIA(a, conocimientoPorServicio), mapearConocimientoParaIA(b, conocimientoPorServicio)],
        contexto,
      };
    }
  }

  // Genérico (nunca depende del código del escenario) — un ÚNICO servicio
  // real ya resuelto (nombrado en este mensaje o heredado del contexto) y
  // sin una categoría nueva que lo reemplace: se trata como "explicación de
  // un servicio puntual" (029_explicacion_servicio y cualquier otro
  // escenario ai que reciba esta misma forma de entidades).
  //
  // OJO: `entidades.categoria` se autocompleta con la categoría del propio
  // servicio cuando el mensaje nombra ESE único servicio (ver entidades.ts,
  // servicioUnico?.categoria) -- así que nunca debe bloquear esta rama
  // cuando el servicio viene DIRECTO del mensaje actual (entidades.servicioId).
  // Solo bloquea heredar el servicio del CONTEXTO (turno anterior) cuando
  // este turno sí trae una categoría nueva (cambio de tema real, ej. "qué
  // tienen para uñas" tras haber hablado de un servicio de otra categoría) --
  // mismo criterio, sin categoría propia, que resolverModoCatalog ya usa.
  const servicioIdResuelto = entidades.servicioId ?? (entidades.categoria ? undefined : contexto.ultimoServicioId);
  const servicioResuelto = servicioIdResuelto ? catalogo.find((s) => s.id === servicioIdResuelto) : undefined;
  if (servicioResuelto) {
    return {
      escenarioCodigo: escenario.codigo,
      modo: "ai",
      requiereIA: true,
      instruccionIA: escenario.config.instruccionIA ?? "",
      datosIA: [mapearServicioParaIA(servicioResuelto)],
      conocimientoGeneral: [mapearConocimientoParaIA(servicioResuelto, conocimientoPorServicio)],
      contexto: {
        ultimoServicioId: servicioResuelto.id,
        ultimoServicioNombre: servicioResuelto.nombre,
        ultimaCategoria: servicioResuelto.categoria ?? undefined,
        ultimaAccionSugerida: "ofrecer_portal",
        ultimasOpcionesIds: [servicioResuelto.id],
      },
    };
  }

  const categoria = entidades.categoria ?? contexto.ultimaCategoria;
  const datosFiltrados = filtrarCatalogo(catalogo, {
    categoria,
    presupuestoMax: entidades.presupuestoMax,
    duracionMaxMin: entidades.duracionMaxMin,
  });
  // Nunca se manda el catálogo completo a la IA si un filtro real ya lo
  // redujo -- si nada aplicó, se manda igual acotado a la categoría (o todo,
  // si tampoco hay categoría) para que la respuesta siga siendo honesta.
  // Mismo filtro de género que el camino determinista (prueba real de
  // WhatsApp) -- la IA tampoco debe recomendar servicios de caballero sin
  // evidencia explícita.
  const base = datosFiltrados.length > 0 ? datosFiltrados : catalogo;
  const candidatos = aplicarFiltroGenero(base, entidades.indicaGeneroMasculino);
  const datosIA = candidatos.map(mapearServicioParaIA);
  const conocimientoGeneral = candidatos.map((s) => mapearConocimientoParaIA(s, conocimientoPorServicio));

  return {
    escenarioCodigo: escenario.codigo,
    modo: "ai",
    requiereIA: true,
    instruccionIA: escenario.config.instruccionIA ?? "",
    datosIA,
    conocimientoGeneral,
    contexto: { ...contexto, ultimaCategoria: categoria },
  };
}

// ---------------------------------------------------------------------------
// FASE 1 -- Agendamiento conversacional (autorizado). ACUMULADOR de datos,
// nunca una secuencia rígida: cada llamada toma el `agendamiento` ya
// acumulado en el contexto, extrae lo que ESTE mensaje aporta de nuevo
// (determinista, nunca por IA), decide qué falta, y produce SOLO el
// siguiente paso natural -- pedir un dato, consultar disponibilidad real
// (modo="agendar_buscar_disponibilidad", delega a una acción nueva del
// Flow), pedir confirmación, o ejecutar la reserva real
// (modo="agendar_crear_cita", delega a crearCitaConNylas() vía otra acción
// nueva). Gemini NUNCA decide nada de esto -- solo redacta el texto final a
// partir de instruccionIA/datosIA, exactamente igual que el resto del bot.
//
// Escenarios informativos que SIEMPRE pueden responder aunque haya un
// agendamiento en curso (sección 11 del pedido: preguntas de precio,
// explicación, comparación, etc. no deben destruir el estado) -- el
// agendamiento se conserva automáticamente porque NO se toca su llave en el
// contexto devuelto por ninguno de estos modos (ver el fix centralizado más
// abajo, al final de resolverEscenario).
// ---------------------------------------------------------------------------
const ESCENARIOS_INFORMATIVOS_PERMITIDOS_DURANTE_AGENDAMIENTO = new Set([
  "003_info_general",
  "028_servicio_info",
  "029_explicacion_servicio",
  "034_profesionales",
  "037_servicio_inexistente_unas",
  "040_recomendacion",
  "051_comparacion",
  "080_horario",
  "084_direccion",
  "090_info_general_no_disponible",
  "110_hablar_con_persona",
]);

/** Datos mínimos y ya reales para ofrecer al nodo IA en cada paso del agendamiento -- nunca listas completas del catálogo. */
function resumenAgendamientoParaIA(actual: AgendamientoEnCurso) {
  return {
    servicio: actual.servicioNombre ?? null,
    fecha: actual.fechaISO ?? null,
    especialistaMencionada: actual.especialistaNombre ?? null,
    opcionesOfrecidas: actual.opcionesOfrecidas ?? [],
    horarioSeleccionado:
      actual.horarioSeleccionadoISO && actual.especialistaSeleccionadaNombre
        ? { horaISO: actual.horarioSeleccionadoISO, especialista: actual.especialistaSeleccionadaNombre }
        : null,
  };
}

type ResultadoFusionAgendamiento =
  | { tipo: "actualizado"; actual: AgendamientoEnCurso }
  | { tipo: "responder"; resultado: ResultadoResolucion };

/**
 * Extrae lo que ESTE mensaje aporta de nuevo y lo fusiona con el
 * acumulador -- SIEMPRE se ejecuta mientras haya un agendamiento activo,
 * SIN IMPORTAR qué escenario terminó respondiendo el turno (sección 11 del
 * pedido: "Quiero Dipping" mencionado durante un agendamiento activo debe
 * quedar capturado como el servicio elegido, aunque 028_servicio_info sea
 * quien responda el precio ese mismo turno). Nunca decide QUÉ decir --
 * solo qué cambia en los datos; un caso realmente ambiguo (fecha/hora/
 * selección) sí puede cortar con una respuesta propia, porque es una
 * aclaración directa sobre lo que la clienta acaba de decir, no una
 * decisión de flujo.
 */
// Distingue "no, mejor Press On" (cambio de opinión real, sección 12) de
// "¿y qué es el Press On?" (pregunta informativa, sección 11) -- ambas
// mencionan un servicio distinto al ya elegido y ambas pueden ganar el mismo
// escenario informativo (028/029/051, por su variante servicio_detectado),
// así que el propio escenario ganador no alcanza para diferenciarlas. Un
// marcador léxico explícito de decisión sí distingue: sin él, se asume
// pregunta y el servicio elegido NO cambia.
const PATRON_CAMBIO_DE_OPINION_SERVICIO = /\b(mejor|prefiero|preferiria|cambia|cambio|en vez de)\b/;
function pareceCambioDeOpinionDeServicio(mensaje: string): boolean {
  const normalizado = mensaje.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  return PATRON_CAMBIO_DE_OPINION_SERVICIO.test(normalizado);
}

function fusionarDatosAgendamiento(params: {
  actual: AgendamientoEnCurso;
  mensaje: string;
  entidades: EntidadesDetectadas;
  catalogo: ServicioCatalogoReal[];
  especialistasReales: EspecialistaBasico[];
  hoyISO: string;
  escenarioCodigo: string;
  contextoBase: ContextoConversacional;
}): ResultadoFusionAgendamiento {
  const actual: AgendamientoEnCurso = { ...params.actual };
  const responderAqui = (respuestaTexto: string): ResultadoFusionAgendamiento => ({
    tipo: "responder",
    resultado: {
      escenarioCodigo: params.escenarioCodigo,
      modo: "deterministic",
      respuestaTexto,
      requiereIA: false,
      contexto: { ...params.contextoBase, agendamiento: actual },
    },
  });

  // Revisión (autorizada, sección 14) -- mientras se espera la respuesta a
  // "¿cuál es tu fecha de cumpleaños?", el mensaje entrante NUNCA debe
  // pasar por la extracción normal de servicio/fecha/hora/profesional: una
  // fecha como "15 de marzo" matchea el mismo patrón que una fecha de
  // CITA (extraerFechaMencionada) y podría pisar fechaISO ya elegido. Se
  // difiere 100% la interpretación de este mensaje a
  // decidirSiguientePasoAgendamiento (que sí tiene acceso a Supabase para
  // guardar el dato), sin tocar ningún otro campo del acumulador.
  if (actual.cumpleanosPendiente) {
    return { tipo: "actualizado", actual };
  }

  const servicioDetectado = params.entidades.servicioId ? params.catalogo.find((s) => s.id === params.entidades.servicioId) : undefined;
  let huboCambioQueInvalidaSeleccion = false;

  if (servicioDetectado) {
    const cambioDeServicio = actual.servicioId !== undefined && actual.servicioId !== servicioDetectado.id;
    // Sección 11 del pedido: preguntar POR otro servicio ("¿y qué es el
    // Press On?") es una interrupción informativa, nunca un cambio de
    // opinión -- solo una frase de cambio real ("no, mejor Press On", que ni
    // siquiera matchea estos escenarios informativos) debe reemplazar el
    // servicio ya elegido (sección 12). Si YA había un servicio elegido y el
    // escenario ganador es uno de los puramente informativos, se ignora la
    // mención para el acumulador (pero 028/029/051 igual responden la
    // pregunta con normalidad). Si todavía no había servicio elegido
    // (arranque del agendamiento), cualquier mención sí lo fija -- test B.
    const esSoloUnaPreguntaSobreOtroServicio =
      cambioDeServicio &&
      ESCENARIOS_INFORMATIVOS_PERMITIDOS_DURANTE_AGENDAMIENTO.has(params.escenarioCodigo) &&
      !pareceCambioDeOpinionDeServicio(params.mensaje);
    if (!esSoloUnaPreguntaSobreOtroServicio) {
      actual.servicioId = servicioDetectado.id;
      actual.servicioNombre = servicioDetectado.nombre;
      actual.duracionMin = servicioDetectado.duracionMin;
      if (cambioDeServicio) {
        actual.especialistaId = undefined;
        actual.especialistaNombre = undefined;
        huboCambioQueInvalidaSeleccion = true;
      }
    }
  }

  const especialistaDetectada = detectarEspecialistaMencionada(params.mensaje, params.especialistasReales);
  if (especialistaDetectada && especialistaDetectada.id !== actual.especialistaId) {
    actual.especialistaId = especialistaDetectada.id;
    actual.especialistaNombre = especialistaDetectada.nombre;
    huboCambioQueInvalidaSeleccion = true;
  }

  const fechaDetectada = extraerFechaMencionada(params.mensaje, params.hoyISO);
  if (fechaDetectada && !fechaDetectada.ok) {
    return responderAqui(fechaDetectada.message);
  }
  if (fechaDetectada?.ok && fechaDetectada.fecha !== actual.fechaISO) {
    if (actual.fechaISO) huboCambioQueInvalidaSeleccion = true;
    actual.fechaISO = fechaDetectada.fecha;
  }

  const horaDetectada = extraerHoraOBloqueMencionado(params.mensaje);
  if (horaDetectada?.tipo === "hora" && !horaDetectada.resultado.ok && horaDetectada.resultado.kind === "ambiguous") {
    return responderAqui(horaDetectada.resultado.message);
  }
  if (horaDetectada) {
    if (horaDetectada.tipo === "bloque") {
      actual.bloquePreferido = horaDetectada.bloque;
      actual.horaPreferidaHHMM = undefined;
    } else if (horaDetectada.resultado.ok) {
      actual.horaPreferidaHHMM = horaDetectada.resultado.hhmm;
      actual.bloquePreferido = undefined;
    }
    huboCambioQueInvalidaSeleccion = true;
  }

  if (huboCambioQueInvalidaSeleccion) {
    actual.opcionesOfrecidas = undefined;
    actual.horarioSeleccionadoISO = undefined;
    actual.especialistaSeleccionadaId = undefined;
    actual.especialistaSeleccionadaNombre = undefined;
    actual.esperandoConfirmacion = undefined;
  }

  // Nombre pendiente: si el bot ya preguntó "¿a nombre de quién?" y este
  // mensaje no aportó ningún otro dato reconocible, se toma tal cual como
  // el nombre -- nunca se asume un nombre que la clienta no haya escrito.
  if (
    actual.nombrePendiente &&
    !servicioDetectado &&
    !especialistaDetectada &&
    !fechaDetectada &&
    !horaDetectada &&
    !esConfirmacionExplicitaDeReserva(params.mensaje)
  ) {
    const posibleNombre = params.mensaje.trim();
    if (posibleNombre.length >= 2 && posibleNombre.length <= 60) {
      actual.nombreCliente = posibleNombre;
      actual.nombrePendiente = false;
    }
  }

  // Selección de una opción ya ofrecida (hora y/o profesional).
  if (actual.opcionesOfrecidas?.length && !actual.horarioSeleccionadoISO) {
    let elegida = actual.especialistaId ? actual.opcionesOfrecidas.find((o) => o.especialistaId === actual.especialistaId) : undefined;
    if (!elegida && actual.horaPreferidaHHMM) {
      const candidatas = actual.opcionesOfrecidas.filter((o) => o.horaTexto === actual.horaPreferidaHHMM);
      if (candidatas.length === 1) elegida = candidatas[0];
      else if (candidatas.length > 1) {
        return responderAqui(`Tengo un par de opciones a esa hora 💗 ¿Con ${candidatas.map((c) => c.especialistaNombre).join(" o ")}?`);
      }
    }
    if (!elegida && actual.opcionesOfrecidas.length === 1) elegida = actual.opcionesOfrecidas[0];
    if (elegida) {
      actual.horarioSeleccionadoISO = elegida.horaISO;
      actual.especialistaSeleccionadaId = elegida.especialistaId;
      actual.especialistaSeleccionadaNombre = elegida.especialistaNombre;
    }
  }

  return { tipo: "actualizado", actual };
}

async function decidirSiguientePasoAgendamiento(params: {
  escenario: EscenarioRow;
  mensaje: string;
  actual: AgendamientoEnCurso;
  contextoBase: ContextoConversacional;
  supabase: SupabaseClient;
  tenantId: string;
  telefonoCliente?: string;
  buscarNombreConocido: typeof nombreConocido;
  guardarNombreCliente: typeof recordarNombreCliente;
}): Promise<ResultadoResolucion> {
  const actual: AgendamientoEnCurso = { ...params.actual };
  const responder = (resto: Partial<ResultadoResolucion> & { modo: ResultadoResolucion["modo"] }): ResultadoResolucion => ({
    escenarioCodigo: params.escenario.codigo,
    requiereIA: resto.modo === "ai",
    contexto: { ...params.contextoBase, agendamiento: actual },
    ...resto,
  });

  // Cancelación explícita -- nunca "contains", vocabulario cerrado exacto.
  if (esCancelacionExplicitaDeReserva(params.mensaje)) {
    return {
      escenarioCodigo: params.escenario.codigo,
      modo: "deterministic",
      respuestaTexto: "Listo, no reservo nada por ahora 💗 Cuando quieras retomarlo, aquí estoy.",
      requiereIA: false,
      contexto: { ...params.contextoBase, agendamiento: undefined },
    };
  }

  // Confirmación explícita -- SOLO cuenta si de verdad se está esperando una
  // (nunca fuera de ese momento puntual, para no reservar por accidente).
  if (actual.esperandoConfirmacion && esConfirmacionExplicitaDeReserva(params.mensaje)) {
    return responder({ modo: "agendar_crear_cita" });
  }

  // --- Determinar qué falta y actuar en consecuencia ---
  if (!actual.servicioId) {
    return responder({
      modo: "ai",
      instruccionIA:
        "La clienta quiere agendar una cita pero todavía no dijo qué servicio. Pregúntale amablemente qué servicio desea, UNA sola pregunta, sin listar el catálogo completo.",
      datosIA: [],
      conocimientoGeneral: [],
    });
  }

  if (!actual.fechaISO) {
    return responder({
      modo: "ai",
      instruccionIA: `Ya sabes que la clienta quiere "${actual.servicioNombre}". Pregúntale para qué día, UNA sola pregunta, de forma natural.`,
      datosIA: [{ servicio: actual.servicioNombre }],
      conocimientoGeneral: [],
    });
  }

  if (actual.horarioSeleccionadoISO && actual.especialistaSeleccionadaNombre) {
    if (!actual.nombreCliente) {
      const nombreYaConocido = params.telefonoCliente
        ? await params.buscarNombreConocido(params.supabase, `whatsapp-qr:${params.tenantId}`, params.telefonoCliente)
        : null;
      if (nombreYaConocido) {
        actual.nombreCliente = nombreYaConocido;
        // Cliente YA existente -- nunca pedir cumpleaños de nuevo (sección
        // 14 del pedido), sin importar si alguna vez lo dio o no.
        actual.cumpleanosCapturado = true;
      } else {
        actual.nombrePendiente = true;
        actual.esClienteNuevo = true;
        return responder({
          modo: "ai",
          instruccionIA: "Ya se eligió el horario. Pregunta de forma natural a nombre de quién se deja la reserva, UNA sola pregunta.",
          datosIA: [resumenAgendamientoParaIA(actual)],
          conocimientoGeneral: [],
        });
      }
    }

    // Revisión (autorizada, sección 14 del pedido) -- registro inicial de
    // un cliente genuinamente NUEVO: se pide su fecha de cumpleaños UNA
    // sola vez, como parte de crear su registro (nunca a un cliente ya
    // existente). `esClienteNuevo` solo queda true cuando recién se
    // determinó, arriba, que dulabs_clientes_conocidos no tenía nada para
    // este número -- por eso alcanza como única condición acá.
    if (actual.esClienteNuevo && !actual.cumpleanosCapturado) {
      if (!actual.cumpleanosPendiente) {
        actual.cumpleanosPendiente = true;
        return responder({
          modo: "ai",
          instruccionIA: `Es la primera vez que ${actual.nombreCliente} agenda -- como parte de registrarla, pregúntale de forma natural y breve su fecha de cumpleaños (día y mes), explicando en una frase que es para saludarla ese día especial. UNA sola pregunta, nunca le pidas el año.`,
          datosIA: [{ nombreCliente: actual.nombreCliente }],
          conocimientoGeneral: [],
        });
      }

      const cumpleanos = parseCumpleanosNatural(params.mensaje);
      if (!cumpleanos.ok) {
        return responder({
          modo: "ai",
          instruccionIA:
            "No se entendió la fecha de cumpleaños. Pídesela de nuevo con calidez, dando un ejemplo claro de formato (ej. \"15 de marzo\" o \"15/03\"), UNA sola pregunta. Nunca le pidas el año.",
          datosIA: [],
          conocimientoGeneral: [],
        });
      }

      if (params.telefonoCliente) {
        await params.guardarNombreCliente(params.supabase, {
          idTenant: params.tenantId,
          phoneNumberId: `whatsapp-qr:${params.tenantId}`,
          telefonoCliente: params.telefonoCliente,
          nombre: actual.nombreCliente,
          cumpleDia: cumpleanos.dia,
          cumpleMes: cumpleanos.mes,
        });
      }
      actual.cumpleanosPendiente = false;
      actual.cumpleanosCapturado = true;
      // Cae al siguiente paso (pedir confirmación) en el MISMO turno --
      // nunca hace falta un mensaje aparte solo para agradecer el dato.
    }

    if (!actual.esperandoConfirmacion) {
      actual.esperandoConfirmacion = true;
      return responder({
        modo: "ai",
        instruccionIA:
          "Presenta el resumen real (servicio, profesional, fecha y hora exactos de datosIA) y pide CONFIRMACIÓN EXPLÍCITA antes de reservar -- nunca reserves todavía, solo pregunta si confirma.",
        datosIA: [resumenAgendamientoParaIA(actual)],
        conocimientoGeneral: [],
      });
    }

    // Ya se pidió confirmación antes y este mensaje no fue ni un sí ni un no
    // claro (esConfirmacionExplicitaDeReserva/esCancelacionExplicitaDeReserva
    // ya se evaluaron arriba) -- se vuelve a preguntar, nunca se asume nada.
    return responder({
      modo: "ai",
      instruccionIA: "La clienta no confirmó con claridad. Pregunta de nuevo, breve, si quiere que reserves esa hora o prefiere otra cosa.",
      datosIA: [resumenAgendamientoParaIA(actual)],
      conocimientoGeneral: [],
    });
  }

  if (!actual.opcionesOfrecidas?.length) {
    return responder({ modo: "agendar_buscar_disponibilidad" });
  }

  return responder({
    modo: "ai",
    instruccionIA: "Presenta de nuevo, de forma natural, las opciones reales de datosIA y pregunta cuál prefiere -- nunca inventes otra hora distinta.",
    datosIA: [resumenAgendamientoParaIA(actual)],
    conocimientoGeneral: [],
  });
}

export async function resolverEscenario(params: {
  supabase: SupabaseClient;
  tenantId: string;
  mensaje: string;
  contexto: ContextoConversacional;
  turno: number;
  /** FASE 1 -- Agendamiento conversacional (autorizado). Necesario para resolver el nombre ya conocido de la clienta (dulabs_clientes_conocidos) antes de pedirlo de nuevo. Opcional: si se omite, simplemente siempre se pregunta el nombre. */
  telefonoCliente?: string;
  deps?: ResolverEscenarioDeps;
}): Promise<ResultadoResolucion> {
  const cargarEscenarios = params.deps?.cargarEscenarios;
  if (!cargarEscenarios) throw new Error("resolverEscenario requiere deps.cargarEscenarios");
  const cargarCatalogo = params.deps?.cargarCatalogo ?? listarCatalogoServiciosReal;
  const cargarProfesionales = params.deps?.cargarProfesionales ?? listarProfesionalesServicioReal;
  const cargarConocimiento = params.deps?.cargarConocimiento ?? cargarConocimientoReal;

  const [escenarios, catalogo, conocimiento] = await Promise.all([
    cargarEscenarios(params.supabase, params.tenantId),
    cargarCatalogo(params.supabase, params.tenantId),
    cargarConocimiento(params.supabase, params.tenantId),
  ]);
  const conocimientoPorServicio = new Map(conocimiento.map((c) => [c.servicioId, c]));

  const sinonimosPorCategoria = construirSinonimos(escenarios);
  const entidadesBase = extraerEntidades({ mensaje: params.mensaje, catalogo, sinonimosPorCategoria });

  // Sección 5 del pedido (autorizado) — continuación comparativa: un ÚNICO
  // servicio real nuevo detectado + frase de continuación ("¿Y el Press
  // On?") + un servicio DISTINTO ya en contexto, de la MISMA categoría, =
  // comparación entre ambos, nunca "servicio específico" del nuevo aislado.
  // La exigencia de MISMA categoría es lo que distingue esto de un cambio de
  // tema real ("y también cuánto cuesta el maquillaje" tras hablar de
  // Dipping -- Maquillaje es otra categoría, así que NUNCA se compara con
  // Dipping, se resuelve como su propia pregunta de precio/duración, ver
  // resolverModoCatalog). Tiene prioridad sobre la herencia de afirmación
  // corta de abajo (son mutuamente excluyentes: esta exige un servicio nuevo
  // real, esa exige que NO haya ninguno).
  let entidades: EntidadesDetectadas = entidadesBase;
  if (
    entidadesBase.serviciosDetectados.length === 1 &&
    params.contexto.ultimoServicioId &&
    params.contexto.ultimoServicioId !== entidadesBase.serviciosDetectados[0]!.id &&
    entidadesBase.serviciosDetectados[0]!.categoria !== null &&
    entidadesBase.serviciosDetectados[0]!.categoria === params.contexto.ultimaCategoria &&
    pareceContinuacionComparativa(params.mensaje)
  ) {
    entidades = {
      ...entidadesBase,
      servicioId: undefined,
      servicioNombre: undefined,
      serviciosDetectados: [
        { id: params.contexto.ultimoServicioId, nombre: params.contexto.ultimoServicioNombre ?? "", categoria: params.contexto.ultimaCategoria ?? null },
        entidadesBase.serviciosDetectados[0]!,
      ],
    };
  } else if (entidadesBase.esAfirmacionCorta && !entidadesBase.servicioId && !entidadesBase.categoria) {
    // Continuidad contextual (sección 32/74): una afirmación corta que no
    // trae ninguna entidad propia hereda el último servicio/categoría
    // mencionado -- así "Sí" tras "¿Te cuento del Dipping?" responde sobre
    // Dipping, nunca vuelve a preguntar "¿qué servicio?".
    entidades = {
      ...entidadesBase,
      servicioId: params.contexto.ultimoServicioId,
      servicioNombre: params.contexto.ultimoServicioNombre,
      categoria: params.contexto.ultimaCategoria,
    };
  }

  // Prueba real de WhatsApp (autorizado) — referencia a una opción de la
  // ÚLTIMA lista real mostrada ("la de 30 mil", "la segunda", "la más
  // barata"...). Se resuelve contra esos ids reales (nunca el catálogo
  // completo); un empate real (mismo precio/duración en 2+ opciones) nunca
  // se adivina -- se pide aclaración explícita y se conserva la MISMA lista
  // para que la respuesta a esa aclaración ("la primera") siga resolviendo.
  if (entidadesBase.referenciaOpcion && params.contexto.ultimasOpcionesIds?.length) {
    const opcionesMostradas = catalogo.filter((s) => params.contexto.ultimasOpcionesIds!.includes(s.id));
    const resultadoReferencia = resolverReferenciaOpcion(entidadesBase.referenciaOpcion, opcionesMostradas);
    if (resultadoReferencia.tipo === "resuelto") {
      entidades = {
        ...entidadesBase,
        servicioId: resultadoReferencia.servicio.id,
        servicioNombre: resultadoReferencia.servicio.nombre,
        serviciosDetectados: [
          { id: resultadoReferencia.servicio.id, nombre: resultadoReferencia.servicio.nombre, categoria: resultadoReferencia.servicio.categoria },
        ],
      };
    } else if (resultadoReferencia.tipo === "ambiguo") {
      const nombres = resultadoReferencia.empatados.map((s) => s.nombre);
      const referencia = entidadesBase.referenciaOpcion;
      const calificador = referencia.tipo === "precio" ? ` de ${formatearPrecioCop(referencia.monto)}` : "";
      const respuestaTexto =
        nombres.length === 2
          ? `Veo dos opciones${calificador} 💗 ¿Te refieres a ${nombres[0]} o a ${nombres[1]}?`
          : `Veo varias opciones${calificador} 💗 ¿Cuál de estas: ${nombres.join(", ")}?`;
      return {
        escenarioCodigo: "referencia_ambigua",
        modo: "deterministic",
        respuestaTexto,
        requiereIA: false,
        contexto: params.contexto,
      };
    }
    // "no_encontrado": no se pudo resolver contra la lista mostrada -- se
    // deja `entidades` tal cual y el flujo normal decide (honestamente).
  }

  // Atajo determinista (sección 39/97): si el turno anterior ya ofreció
  // agendar un servicio puntual y esta respuesta es un "sí" corto, se salta
  // directo al portal para ESE servicio -- nunca se vuelve a evaluar como
  // "servicio específico" (que repetiría precio/duración en vez de agendar).
  if (entidadesBase.esAfirmacionCorta && params.contexto.ultimaAccionSugerida === "ofrecer_portal") {
    const escenarioPortal = escenarios.find((e) => e.codigo === CODIGO_ESCENARIO_PORTAL);
    if (escenarioPortal) {
      const respuestaTexto = elegirYRenderizarPlantilla({
        respuestas: escenarioPortal.respuestas,
        tenantId: params.tenantId,
        escenarioCodigo: escenarioPortal.codigo,
        turno: params.turno,
        variables: { servicio: params.contexto.ultimoServicioNombre ?? "" },
      });
      return {
        escenarioCodigo: escenarioPortal.codigo,
        modo: "portal",
        respuestaTexto,
        requiereIA: false,
        contexto: contextoLimpio(),
      };
    }
  }

  const ganador = resolverEscenarioGanador(escenarios, params.mensaje, entidades);
  const escenario = ganador ?? escenarios.find((e) => e.codigo === CODIGO_ESCENARIO_FALLBACK);
  if (!escenario) {
    throw new Error(`Tenant ${params.tenantId} no tiene sembrado el escenario de fallback (${CODIGO_ESCENARIO_FALLBACK})`);
  }

  // FASE 1 -- Agendamiento conversacional (autorizado). Un agendamiento
  // activo SIEMPRE fusiona lo que ESTE mensaje aporta (servicio/fecha/hora/
  // profesional/nombre), SIN IMPORTAR qué escenario terminó respondiendo el
  // turno -- sección 11 del pedido: "Quiero Dipping" mencionado a mitad de
  // un agendamiento debe quedar capturado como el servicio elegido, aunque
  // 028_servicio_info sea quien conteste el precio ese mismo turno. Solo
  // cuando el ganador NO es uno de los escenarios puramente informativos
  // permitidos (o es el propio 070_agendamiento) se le cede el turno
  // completo a decidirSiguientePasoAgendamiento.
  let agendamientoParaCarryForward = params.contexto.agendamiento;
  const agendamientoActivo = Boolean(params.contexto.agendamiento) && !params.contexto.agendamiento?.completado;
  const esEscenarioAgendamiento = escenario.codigo === CODIGO_ESCENARIO_AGENDAMIENTO;
  if (agendamientoActivo || esEscenarioAgendamiento) {
    const cargarEspecialistas = params.deps?.cargarEspecialistas ?? cargarEspecialistasReal;
    const buscarNombreConocido = params.deps?.buscarNombreConocido ?? nombreConocido;
    const guardarNombreCliente = params.deps?.guardarNombreCliente ?? recordarNombreCliente;
    const especialistasReales = await cargarEspecialistas(params.supabase, params.tenantId);
    const hoyISO = fechaColombiaDesdeIso(new Date().toISOString());

    const fusion = fusionarDatosAgendamiento({
      actual: params.contexto.agendamiento ?? {},
      mensaje: params.mensaje,
      entidades,
      catalogo,
      especialistasReales,
      hoyISO,
      escenarioCodigo: escenario.codigo,
      contextoBase: params.contexto,
    });
    if (fusion.tipo === "responder") return fusion.resultado;
    agendamientoParaCarryForward = fusion.actual;

    // Caso especial: 028_servicio_info matchea con solo NOMBRAR un servicio
    // real (variante "servicio_detectado"), sin distinguir si el mensaje es
    // una simple pregunta de precio ("¿Cuánto vale el Dipping?") o el propio
    // arranque de una reserva ("Quiero Dipping el viernes a las 4 con
    // Mary"). Cuando el MISMO mensaje también trae fecha/hora/profesional
    // (señal real de que se está agendando, no solo preguntando), se le cede
    // el turno a decidirSiguientePasoAgendamiento en vez de responder el
    // precio -- así el ejemplo literal del pedido avanza directo a
    // disponibilidad. Una mención aislada del servicio (sin esos datos)
    // sigue respondiendo el precio con normalidad (test B).
    const mencionaFechaHoraOProfesionalEsteMensaje =
      Boolean(extraerFechaMencionada(params.mensaje, hoyISO)) ||
      Boolean(extraerHoraOBloqueMencionado(params.mensaje)) ||
      Boolean(detectarEspecialistaMencionada(params.mensaje, especialistasReales));

    const esInformativoPermitido =
      !esEscenarioAgendamiento &&
      ESCENARIOS_INFORMATIVOS_PERMITIDOS_DURANTE_AGENDAMIENTO.has(escenario.codigo) &&
      !(escenario.codigo === "028_servicio_info" && mencionaFechaHoraOProfesionalEsteMensaje);
    if (!esInformativoPermitido) {
      return decidirSiguientePasoAgendamiento({
        escenario,
        mensaje: params.mensaje,
        actual: fusion.actual,
        contextoBase: params.contexto,
        supabase: params.supabase,
        tenantId: params.tenantId,
        telefonoCliente: params.telefonoCliente,
        buscarNombreConocido,
        guardarNombreCliente,
      });
    }
    // Informativo permitido: el switch normal de abajo responde (precio,
    // explicación, comparación...) -- el agendamiento YA fusionado se
    // reañade al final vía agendamientoParaCarryForward.
  }

  let resultado: ResultadoResolucion;
  switch (escenario.modo) {
    case "ai":
      resultado = resolverModoAi({ escenario, entidades, contexto: params.contexto, catalogo, conocimientoPorServicio });
      break;

    case "catalog":
      resultado = await resolverModoCatalog({
        escenario,
        entidades,
        contexto: params.contexto,
        catalogo,
        tenantId: params.tenantId,
        turno: params.turno,
        supabase: params.supabase,
        cargarProfesionales,
      });
      break;

    case "transfer": {
      const respuestaTexto = elegirYRenderizarPlantilla({
        respuestas: escenario.respuestas,
        tenantId: params.tenantId,
        escenarioCodigo: escenario.codigo,
        turno: params.turno,
        variables: {},
      });
      // Transferencia a humano: el agendamiento en curso NO se conserva a
      // propósito -- una persona real toma la conversación desde cero.
      return {
        escenarioCodigo: escenario.codigo,
        modo: "transfer",
        respuestaTexto,
        requiereIA: false,
        contexto: contextoLimpio(),
      };
    }

    case "portal": {
      const respuestaTexto = elegirYRenderizarPlantilla({
        respuestas: escenario.respuestas,
        tenantId: params.tenantId,
        escenarioCodigo: escenario.codigo,
        turno: params.turno,
        variables: { servicio: entidades.servicioNombre ?? params.contexto.ultimoServicioNombre ?? "" },
      });
      // La clienta eligió explícitamente el portal -- el agendamiento
      // conversacional en curso (si había uno) se descarta a propósito,
      // nunca se mezclan las dos vías de reserva.
      return {
        escenarioCodigo: escenario.codigo,
        modo: "portal",
        respuestaTexto,
        requiereIA: false,
        contexto: contextoLimpio(),
      };
    }

    case "faq":
    case "deterministic":
    default: {
      const respuestaTexto = elegirYRenderizarPlantilla({
        respuestas: escenario.respuestas,
        tenantId: params.tenantId,
        escenarioCodigo: escenario.codigo,
        turno: params.turno,
        variables: {},
      });
      resultado = {
        escenarioCodigo: escenario.codigo,
        modo: escenario.modo,
        respuestaTexto,
        requiereIA: false,
        contexto: params.contexto,
      };
      break;
    }
  }

  // FASE 1 -- Agendamiento conversacional (autorizado). Fix centralizado
  // (único punto, en vez de tocar cada rama de resolverModoAi/resolverModoCatalog):
  // cualquier escenario informativo que ganó DURANTE un agendamiento activo
  // (sección 11 del pedido) nunca debe perder el estado YA FUSIONADO este
  // mismo turno solo porque su propia rama no menciona `agendamiento` en el
  // contexto que construye.
  if (resultado.contexto.agendamiento === undefined && agendamientoParaCarryForward) {
    resultado = { ...resultado, contexto: { ...resultado.contexto, agendamiento: agendamientoParaCarryForward } };
  }
  return resultado;
}
