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
import { extraerEntidades } from "@/lib/bot-escenarios/entidades";
import { resolverEscenarioGanador } from "@/lib/bot-escenarios/matching";
import { elegirYRenderizarPlantilla } from "@/lib/bot-escenarios/plantillas";
import {
  CODIGO_ESCENARIO_FALLBACK,
  CODIGO_ESCENARIO_PORTAL,
  type ContextoConversacional,
  type EntidadesDetectadas,
  type EscenarioRow,
  type ResultadoResolucion,
} from "@/lib/bot-escenarios/tipos";

export interface ResolverEscenarioDeps {
  cargarEscenarios: (supabase: SupabaseClient, tenantId: string) => Promise<EscenarioRow[]>;
  cargarCatalogo?: typeof listarCatalogoServiciosReal;
  cargarProfesionales?: typeof listarProfesionalesServicioReal;
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
  params: { categoria?: string; nombreContiene?: string[]; presupuestoMax?: number; duracionMaxMin?: number },
): ServicioCatalogoReal[] {
  return catalogo.filter((s) => {
    if (params.categoria && s.categoria !== params.categoria) return false;
    if (params.nombreContiene?.length && !params.nombreContiene.some((n) => s.nombre.toLowerCase().includes(n.toLowerCase()))) return false;
    if (params.presupuestoMax !== undefined && s.precio > params.presupuestoMax) return false;
    if (params.duracionMaxMin !== undefined && s.duracionMin > params.duracionMaxMin) return false;
    return true;
  });
}

function contextoLimpio(): ContextoConversacional {
  return {};
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

  // Prueba real de WhatsApp (autorizado) — comparación entre 2 servicios
  // reales SIEMPRE se resuelve ANTES que "servicio puntual": "¿Qué diferencia
  // hay entre Dipping y Press On?" nunca debe responder solo del más
  // específico de los dos (bug real encontrado). Nunca afirma diferencias
  // técnicas que no existen en el catálogo real -- solo precio/duración de
  // AMBOS + honestidad explícita sobre lo que no está confirmado (el propio
  // texto de la plantilla, verificado con Claim Security antes de sembrarse).
  if (entidades.serviciosDetectados.length >= 2) {
    const [a, b] = entidades.serviciosDetectados;
    const servicioA = catalogo.find((s) => s.id === a!.id);
    const servicioB = catalogo.find((s) => s.id === b!.id);
    if (servicioA && servicioB) {
      const variables = {
        servicioA: servicioA.nombre,
        precioTextoA: formatearPrecioCop(servicioA.precio),
        duracionTextoA: formatearDuracion(servicioA.duracionMin),
        servicioB: servicioB.nombre,
        precioTextoB: formatearPrecioCop(servicioB.precio),
        duracionTextoB: formatearDuracion(servicioB.duracionMin),
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
          ultimoServicioId: servicioA.id,
          ultimoServicioNombre: servicioA.nombre,
          ultimoServicioBId: servicioB.id,
          ultimoServicioBNombre: servicioB.nombre,
          ultimaCategoria: servicioA.categoria ?? undefined,
          ultimaAccionSugerida: "comparando",
        },
      };
    }
  }

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
      contexto: { ultimoServicioId: servicio.id, ultimoServicioNombre: servicio.nombre, ultimaCategoria: servicio.categoria ?? undefined, ultimaAccionSugerida: "ofrecer_portal" },
    };
  }

  // Sin servicio puntual: si la categoría (propia o detectada) sí resuelve,
  // se muestran 2-3 opciones reales de esa categoría -- NUNCA el catálogo
  // completo (regla explícita del pedido).
  const categoria = escenario.config.filtroCategoria ?? entidades.categoria ?? contexto.ultimaCategoria;
  if (categoria) {
    const opciones = filtrarCatalogo(catalogo, {
      categoria,
      nombreContiene: escenario.config.filtroNombreContiene,
      presupuestoMax: entidades.presupuestoMax,
      duracionMaxMin: entidades.duracionMaxMin,
    }).slice(0, 3);
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
        contexto: { ultimaCategoria: categoria },
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

function resolverModoAi(params: {
  escenario: EscenarioRow;
  entidades: EntidadesDetectadas;
  contexto: ContextoConversacional;
  catalogo: ServicioCatalogoReal[];
}): ResultadoResolucion {
  const { escenario, entidades, contexto, catalogo } = params;

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
        contexto,
      };
    }
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
  const datosIA = (datosFiltrados.length > 0 ? datosFiltrados : catalogo).map(mapearServicioParaIA);

  return {
    escenarioCodigo: escenario.codigo,
    modo: "ai",
    requiereIA: true,
    instruccionIA: escenario.config.instruccionIA ?? "",
    datosIA,
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

  const [escenarios, catalogo] = await Promise.all([
    cargarEscenarios(params.supabase, params.tenantId),
    cargarCatalogo(params.supabase, params.tenantId),
  ]);

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
      return resolverModoAi({ escenario, entidades, contexto: params.contexto, catalogo });

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
