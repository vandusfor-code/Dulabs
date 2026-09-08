/**
 * AGENDA V2 (autorizado, Fase 3 multi-servicio) — resuelve qué
 * profesionales pueden realizar TODOS los servicios de una combinación
 * (máximo 3, ver lib/agenda-v2/servicios.ts). Reutiliza TAL CUAL
 * resolverEspecialistasElegiblesParaServicio (lib/asignacion-categoria.ts)
 * -- el ÚNICO resolver real de "quién puede atender este servicio" -- una
 * vez por cada servicioId, y calcula la intersección por especialistaId.
 * Nunca reimplementa ninguna regla de elegibilidad nueva.
 *
 * Auditado (Fase 0/3): los 28 servicios reales de AMORE están TODOS en modo
 * "explicita" (dulabs_servicio_especialista) -- nunca caen al fallback por
 * categoría de Daniela. La intersección acá es deliberadamente simple
 * (por especialistaId) porque para AMORE eso es exactamente lo que importa;
 * el `modo` ("prioridad"/"todos") de cada resolución individual no se
 * propaga -- una combinación de servicios siempre se ofrece en modo "todos"
 * (cada profesional elegible, con su propia disponibilidad real), nunca en
 * modo prioridad, para no inventar una regla de prioridad combinada que
 * nadie pidió.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolverEspecialistasElegiblesParaServicio, type EspecialistaElegible } from "@/lib/asignacion-categoria";

export interface ResolucionMultiServicio {
  /** Profesionales elegibles para TODOS los servicios a la vez, en el orden en que aparecen en la resolución del PRIMER servicio. Vacío si la intersección no tiene a nadie -- el caller nunca debe ofrecer una combinación imposible. */
  especialistas: EspecialistaElegible[];
}

export interface DepsMultiServicio {
  resolverEspecialistas?: typeof resolverEspecialistasElegiblesParaServicio;
}

/**
 * Interseca los especialistas elegibles de CADA servicioId dado. Con un solo
 * servicioId, devuelve exactamente lo mismo que
 * resolverEspecialistasElegiblesParaServicio (comportamiento de un solo
 * servicio 100% preservado, nunca una segunda implementación divergente).
 */
export async function resolverEspecialistasParaMultiServicio(
  supabase: SupabaseClient,
  idTenant: string,
  servicioIds: string[],
  deps: DepsMultiServicio = {},
): Promise<ResolucionMultiServicio> {
  const resolverEspecialistas = deps.resolverEspecialistas ?? resolverEspecialistasElegiblesParaServicio;

  if (servicioIds.length === 0) {
    return { especialistas: [] };
  }

  const resoluciones = await Promise.all(servicioIds.map((servicioId) => resolverEspecialistas(supabase, idTenant, servicioId)));

  const [primera, ...resto] = resoluciones;
  const idsDelResto = resto.map((r) => new Set(r.especialistas.map((e) => e.especialistaId)));

  const interseccion = primera!.especialistas.filter((e) => idsDelResto.every((ids) => ids.has(e.especialistaId)));

  return { especialistas: interseccion };
}

/**
 * Fase 3 (autorizado, multi-servicio) — lista ordenada de servicio_id de una
 * cita ya creada, leyendo dulabs_cita_servicios (fuente de verdad real).
 * Devuelve `[]` para una cita de un solo servicio (nunca tiene fila ahí, o
 * tiene exactamente una -- en ambos casos el caller debe tratarla como "un
 * solo servicio", igual que antes de esta fase). Usado por
 * lib/agenda-v2/router.ts al iniciar una reprogramación (Bloque 8) para que
 * una cita multi-servicio conserve TODOS sus servicios, nunca solo el
 * primero.
 */
export async function obtenerServiciosDeCita(supabase: SupabaseClient, citaId: number): Promise<string[]> {
  const { data } = await supabase.from("dulabs_cita_servicios").select("servicio_id, orden").eq("cita_id", citaId).order("orden", { ascending: true });
  const filas = (data ?? []) as { servicio_id: string; orden: number }[];
  return filas.length > 1 ? filas.map((f) => f.servicio_id) : [];
}

/**
 * Fase 3 (autorizado, multi-servicio) — nombres reales (no ids) de los
 * servicios de una cita, para mostrar en recordatorios/confirmaciones sin
 * volver a resolver el id manualmente. Mismo criterio EXACTO de "[] para un
 * solo servicio" que obtenerServiciosDeCita.
 */
export async function obtenerNombresServiciosDeCita(supabase: SupabaseClient, citaId: number): Promise<string[]> {
  const { data } = await supabase
    .from("dulabs_cita_servicios")
    .select("orden, dulabs_servicios(nombre)")
    .eq("cita_id", citaId)
    .order("orden", { ascending: true });
  const filas = (data ?? []) as unknown as { dulabs_servicios: { nombre: string } | null }[];
  return filas.length > 1 ? filas.map((f) => f.dulabs_servicios?.nombre).filter((n): n is string => Boolean(n)) : [];
}
