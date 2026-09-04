import type { SupabaseClient } from "@supabase/supabase-js";
import { configBotPorPhoneNumberId } from "@/lib/config-bot";

/**
 * Fase 8A.5 (autorizado) — resolución de especialistas elegibles para un
 * servicio POR CATEGORÍA, cuando no existe una asociación explícita en
 * dulabs_servicio_especialista.
 *
 * Causa real del bug reportado: listarHorariosDisponiblesPorServicio
 * (lib/disponibilidad-servicio.ts) SOLO resolvía especialistas vía
 * dulabs_servicio_especialista -- documentado a propósito así en su día
 * ("un especialista sin esa relación explícita NUNCA aparece"), pero solo 3
 * de los 11 servicios reales de Daniela tienen esa fila (Cejas x2,
 * Hidralips, Fase 8A.4). Los otros 8 (Semipermanente, Dipping, Base Rubber,
 * Forrado, Press on, Acrílicas) no tienen ninguna asociación explícita
 * porque la asignación real de Daniela es por CATEGORÍA (manos/pies), no
 * por servicio puntual -- confirmado por Daniela vía config-bot
 * (dulabs_config_bot.respuestas.reglas), NO inferido.
 *
 * Este módulo NO reemplaza la asociación explícita (sigue siendo la
 * PRIMERA fuente de verdad, sin cambios) -- solo cubre el hueco cuando esa
 * tabla no tiene ninguna fila para el servicio, y solo con reglas que
 * Daniela confirmó explícitamente, nunca inventadas.
 */

export type ReglaCategoria = {
  categoria: string;
  /**
   * "prioridad": lista ORDENADA -- el siguiente de la lista SOLO se
   * considera si el/los anteriores no tienen NINGÚN horario libre ese día
   * (ver el loop real en listarHorariosDisponiblesPorServicio). "todos":
   * todas las personas de la lista son candidatas por igual, cada una con
   * su disponibilidad real e independiente -- mismo comportamiento que ya
   * tenía una asociación explícita en dulabs_servicio_especialista.
   */
  modo: "prioridad" | "todos";
  /** Nombres reales de dulabs_especialistas.nombre, en el orden de prioridad si modo="prioridad". */
  personas: string[];
};

function comoObjeto(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function comoTexto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Función PURA -- parsea dulabs_config_bot.respuestas (mismo JSON libre que
 * ya usa lib/asistente-daniela-ia.ts::construirContextoOperativoDesdeConfigBot)
 * a reglas estructuradas por categoría. Nunca inventa una categoría/persona
 * que Daniela no haya confirmado en `reglas`.
 *
 * "Pies: Kelly fija, Carla de respaldo" es una premisa fija del propio
 * cuestionario (Card 3 de app/config-bot/[token]/page.tsx la presenta como
 * ya decidida, con una Nota -- no como una pregunta editable) -- por eso NO
 * es un campo de `reglas` como prioridadManos, y se declara acá como
 * constante en vez de leerse del JSON. Lo único configurable de Pies es si
 * Daniela entra como último recurso (`reglas.danielaPies`).
 */
export function resolverReglasCategoriaDesdeConfigBot(respuestas: unknown): ReglaCategoria[] {
  const reglas = comoObjeto(comoObjeto(respuestas).reglas);
  const resultado: ReglaCategoria[] = [];

  const prioridadManos = comoTexto(reglas.prioridadManos);
  if (prioridadManos === "carla_primero") {
    resultado.push({ categoria: "Manos", modo: "prioridad", personas: ["Carla", "Daniela"] });
  } else if (prioridadManos === "daniela_primero") {
    resultado.push({ categoria: "Manos", modo: "prioridad", personas: ["Daniela", "Carla"] });
  } else if (prioridadManos === "cualquiera") {
    resultado.push({ categoria: "Manos", modo: "todos", personas: ["Carla", "Daniela"] });
  }

  const danielaPies = comoTexto(reglas.danielaPies);
  if (danielaPies === "no") {
    resultado.push({ categoria: "Pies", modo: "prioridad", personas: ["Kelly", "Carla"] });
  } else if (danielaPies === "si") {
    resultado.push({ categoria: "Pies", modo: "prioridad", personas: ["Kelly", "Carla", "Daniela"] });
  }

  return resultado;
}

/**
 * Único punto que toca Supabase en este módulo: resuelve el phone_number_id
 * real de un tenant para poder leer su fila de dulabs_config_bot (esa tabla
 * se identifica por phone_number_id, no por id_tenant -- ver
 * lib/config-bot.ts). Defensivo a propósito: si el tenant tiene CERO o MÁS
 * DE UN phone_number_id en dulabs_clientes_config, devuelve null y el
 * caller simplemente no aplica ningún fallback por categoría -- nunca
 * adivina cuál usar. Para Daniela (y cualquier tenant de un solo número)
 * esto siempre resuelve exactamente una fila.
 */
async function resolverPhoneNumberIdUnicoDelTenant(supabase: SupabaseClient, idTenant: string): Promise<string | null> {
  const { data } = await supabase.from("dulabs_clientes_config").select("phone_number_id").eq("id_tenant", idTenant);
  const filas = data ?? [];
  return filas.length === 1 ? (filas[0]!.phone_number_id as string) : null;
}

export type EspecialistasPorCategoria = { modo: "prioridad" | "todos"; especialistaIds: number[] };

/**
 * Resuelve los especialistas elegibles para una `categoria` de servicio
 * (ej. "Manos", "Pies") según las reglas reales confirmadas por este
 * tenant. Devuelve null si el tenant no tiene configuración operativa, o si
 * no hay ninguna regla para esa categoría puntual -- en ambos casos el
 * caller (listarHorariosDisponiblesPorServicio) sigue exactamente con su
 * comportamiento actual ("sin_especialistas_habilitados"), sin ningún
 * cambio para tenants sin config-bot.
 */
export async function resolverEspecialistasPorCategoria(
  supabase: SupabaseClient,
  idTenant: string,
  categoria: string | null
): Promise<EspecialistasPorCategoria | null> {
  if (!categoria) return null;

  const phoneNumberId = await resolverPhoneNumberIdUnicoDelTenant(supabase, idTenant);
  if (!phoneNumberId) return null;

  const configBot = await configBotPorPhoneNumberId(supabase, phoneNumberId);
  if (!configBot) return null;

  const reglas = resolverReglasCategoriaDesdeConfigBot(configBot.respuestas);
  const regla = reglas.find((r) => r.categoria.toLowerCase() === categoria.toLowerCase());
  if (!regla || regla.personas.length === 0) return null;

  const { data: especialistas } = await supabase
    .from("dulabs_especialistas")
    .select("id, nombre")
    .eq("id_tenant", idTenant)
    .eq("activo", true)
    .in("nombre", regla.personas);
  const idPorNombre = new Map((especialistas ?? []).map((e) => [e.nombre as string, e.id as number]));

  // Preserva el ORDEN de `regla.personas` (importante para modo="prioridad")
  // -- `.in()` de Postgres no garantiza ningún orden.
  const especialistaIds = regla.personas.map((nombre) => idPorNombre.get(nombre)).filter((id): id is number => id !== undefined);
  if (especialistaIds.length === 0) return null;

  return { modo: regla.modo, especialistaIds };
}

export type EspecialistaElegible = { especialistaId: number; nombre: string };
export type ResolucionEspecialistasServicio = { modo: "explicita" | "prioridad" | "todos"; especialistas: EspecialistaElegible[] };

/**
 * Fase 8A.8.1 (autorizado) — ÚNICO resolver de "qué especialistas pueden
 * atender este servicio, y en qué orden", para que el endpoint de listado
 * (app/api/reservar/[tenant]/especialistas/route.ts), el motor de
 * disponibilidad (lib/disponibilidad-servicio.ts::listarHorariosDisponiblesPorServicio)
 * y la reserva (reservarCitaPorServicio) usen EXACTAMENTE el mismo criterio
 * -- antes existían dos implementaciones separadas (el endpoint de listado
 * solo miraba dulabs_servicio_especialista, sin el fallback por categoría
 * de la Fase 8A.5, lo que causaba "No hay profesionales disponibles" para
 * cualquier servicio sin asociación explícita).
 *
 * Prioridad de fuentes (sin cambios respecto a la Fase 8A.5):
 * 1. Asociación EXPLÍCITA en dulabs_servicio_especialista -- si existe
 *    alguna fila, GANA sobre cualquier regla por categoría (modo "explicita",
 *    equivalente a "todos": cada quien con su disponibilidad real).
 * 2. Si no hay ninguna fila explícita: fallback por categoría del servicio
 *    (resolverEspecialistasPorCategoria) según las reglas reales de
 *    dulabs_config_bot.respuestas -- nunca inventadas.
 *
 * Esta función NO calcula disponibilidad de ningún día (no recibe fecha) --
 * solo responde "quién es candidato, y con qué prioridad". El corte real
 * "Daniela solo si Carla no tiene NINGÚN cupo ESE DÍA" sigue siendo
 * responsabilidad exclusiva de listarHorariosDisponiblesPorServicio (Fase
 * 8A.5/8A.6, sin tocar), que toma esta MISMA lista ordenada como punto de
 * partida y prueba a cada quien en orden contra su disponibilidad real de
 * ese día concreto.
 */
export async function resolverEspecialistasElegiblesParaServicio(
  supabase: SupabaseClient,
  idTenant: string,
  servicioId: string
): Promise<ResolucionEspecialistasServicio> {
  const { data: relaciones } = await supabase
    .from("dulabs_servicio_especialista")
    .select("especialista_id")
    .eq("id_tenant", idTenant)
    .eq("servicio_id", servicioId);
  const idsExplicitos = ((relaciones ?? []) as { especialista_id: number }[]).map((r) => r.especialista_id);

  if (idsExplicitos.length > 0) {
    const { data: especialistas } = await supabase
      .from("dulabs_especialistas")
      .select("id, nombre")
      .eq("id_tenant", idTenant)
      .eq("activo", true)
      .in("id", idsExplicitos);
    return {
      modo: "explicita",
      especialistas: ((especialistas ?? []) as { id: number; nombre: string }[]).map((e) => ({ especialistaId: e.id, nombre: e.nombre })),
    };
  }

  const { data: servicio } = await supabase.from("dulabs_servicios").select("categoria").eq("id_tenant", idTenant).eq("id", servicioId).maybeSingle();
  const porCategoria = await resolverEspecialistasPorCategoria(supabase, idTenant, (servicio?.categoria as string | null) ?? null);
  if (!porCategoria) return { modo: "todos", especialistas: [] };

  const { data: especialistas } = await supabase
    .from("dulabs_especialistas")
    .select("id, nombre")
    .eq("id_tenant", idTenant)
    .eq("activo", true)
    .in("id", porCategoria.especialistaIds);
  const porId = new Map(((especialistas ?? []) as { id: number; nombre: string }[]).map((e) => [e.id, e]));
  // Preserva el orden de prioridad de porCategoria.especialistaIds.
  const ordenados = porCategoria.especialistaIds.map((id) => porId.get(id)).filter((e): e is { id: number; nombre: string } => e !== undefined);

  return { modo: porCategoria.modo, especialistas: ordenados.map((e) => ({ especialistaId: e.id, nombre: e.nombre })) };
}
