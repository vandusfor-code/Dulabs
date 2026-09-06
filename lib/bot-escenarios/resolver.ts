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
import { normalizeText } from "@/lib/flow-triggers/normalize-text";
import { esServicioDeCaballero, extraerEntidades } from "@/lib/bot-escenarios/entidades";
import { resolverEscenarioGanador } from "@/lib/bot-escenarios/matching";
import { elegirYRenderizarPlantilla } from "@/lib/bot-escenarios/plantillas";
import { cargarConocimientoReal } from "@/lib/bot-escenarios/store";
import {
  CODIGO_ESCENARIO_FALLBACK,
  CODIGO_ESCENARIO_PORTAL,
  type ConocimientoServicio,
  type ContextoConversacional,
  type EntidadesDetectadas,
  type EscenarioRow,
  type ReferenciaOpcionMostrada,
  type ResultadoResolucion,
} from "@/lib/bot-escenarios/tipos";

export interface ResolverEscenarioDeps {
  cargarEscenarios: (supabase: SupabaseClient, tenantId: string) => Promise<EscenarioRow[]>;
  cargarCatalogo?: typeof listarCatalogoServiciosReal;
  cargarProfesionales?: typeof listarProfesionalesServicioReal;
  cargarConocimiento?: typeof cargarConocimientoReal;
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

export async function resolverEscenario(params: {
  supabase: SupabaseClient;
  tenantId: string;
  mensaje: string;
  contexto: ContextoConversacional;
  turno: number;
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

  switch (escenario.modo) {
    case "ai":
      return resolverModoAi({ escenario, entidades, contexto: params.contexto, catalogo, conocimientoPorServicio });

    case "catalog":
      return resolverModoCatalog({
        escenario,
        entidades,
        contexto: params.contexto,
        catalogo,
        tenantId: params.tenantId,
        turno: params.turno,
        supabase: params.supabase,
        cargarProfesionales,
      });

    case "transfer": {
      const respuestaTexto = elegirYRenderizarPlantilla({
        respuestas: escenario.respuestas,
        tenantId: params.tenantId,
        escenarioCodigo: escenario.codigo,
        turno: params.turno,
        variables: {},
      });
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
      return {
        escenarioCodigo: escenario.codigo,
        modo: escenario.modo,
        respuestaTexto,
        requiereIA: false,
        contexto: params.contexto,
      };
    }
  }
}
