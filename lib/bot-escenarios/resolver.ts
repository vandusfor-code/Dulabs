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

function resolverModoAi(params: {
  escenario: EscenarioRow;
  entidades: EntidadesDetectadas;
  contexto: ContextoConversacional;
  catalogo: ServicioCatalogoReal[];
}): ResultadoResolucion {
  const { escenario, entidades, contexto, catalogo } = params;
  const categoria = entidades.categoria ?? contexto.ultimaCategoria;
  const datosFiltrados = filtrarCatalogo(catalogo, {
    categoria,
    presupuestoMax: entidades.presupuestoMax,
    duracionMaxMin: entidades.duracionMaxMin,
  });
  // Nunca se manda el catálogo completo a la IA si un filtro real ya lo
  // redujo -- si nada aplicó, se manda igual acotado a la categoría (o todo,
  // si tampoco hay categoría) para que la respuesta siga siendo honesta.
  const datosIA = (datosFiltrados.length > 0 ? datosFiltrados : catalogo).map((s) => ({
    nombre: s.nombre,
    precio: s.precio,
    precioTexto: formatearPrecioCop(s.precio),
    duracionMin: s.duracionMin,
    duracionTexto: formatearDuracion(s.duracionMin),
    categoria: s.categoria,
    descripcion: s.descripcion,
  }));

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

  // Continuidad contextual (sección 32/74): una afirmación corta que no trae
  // ninguna entidad propia hereda el último servicio/categoría mencionado --
  // así "Sí" tras "¿Te cuento del Dipping?" responde sobre Dipping, nunca
  // vuelve a preguntar "¿qué servicio?".
  const entidades: EntidadesDetectadas =
    entidadesBase.esAfirmacionCorta && !entidadesBase.servicioId && !entidadesBase.categoria
      ? { ...entidadesBase, servicioId: params.contexto.ultimoServicioId, servicioNombre: params.contexto.ultimoServicioNombre, categoria: params.contexto.ultimaCategoria }
      : entidadesBase;

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
