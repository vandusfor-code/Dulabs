/**
 * AMORE (Fase 2, autorizado) — puente entre el Flow Engine y el modelo
 * ESTRUCTURADO de reservas (dulabs_servicios / dulabs_servicio_especialista
 * / lib/disponibilidad-servicio.ts), ya construido y validado en la Fase 1
 * de AMORE y ya usado en producción real por el portal de Daniela
 * (app/api/reservar/[tenant]/route.ts).
 *
 * Por qué un adaptador NUEVO en vez de reutilizar
 * lib/especialistas-flow-adaptador.ts (las acciones que ya usa el Flow de
 * Daniela: listar_servicios_especialista, resolver_seleccion_servicio,
 * listar_horarios_disponibles_especialista): verificado antes de escribir
 * una sola línea -- ESE adaptador no lee dulabs_servicios/
 * dulabs_servicio_especialista en absoluto. Lee dulabs_especialistas.servicio
 * (un string de especialidad ÚNICO por persona) y el catálogo de precios lo
 * parsea de dulabs_clientes_config.base_conocimiento (texto libre). Ninguno
 * de los dos representa "una profesional puede hacer VARIOS servicios"
 * (Mary/Jessica: todos; Cristal: solo uñas; Nata: uñas y cepillados) --
 * forzar a AMORE por ese camino habría exigido duplicar su catálogo real en
 * un blob de texto y reducir a cada profesional a una sola especialidad,
 * perdiendo exactamente la elegibilidad N:N que la Fase 1 ya modeló bien.
 *
 * Este archivo NO reimplementa ninguna regla de negocio: listarCatalogoServiciosReal
 * es una simple lectura de dulabs_servicios (igual de directa que
 * app/api/reservar/[tenant]/route.ts::GET), consultarDisponibilidadCatalogoReal
 * es un envoltorio fino sobre listarHorariosDisponiblesPorServicio (EL MISMO
 * resolver que ya usa el portal, sin tocarlo), y resolverServicioCatalogoReal
 * REUTILIZA la función pura resolverSeleccionServicio de
 * especialistas-flow-adaptador.ts (matching por índice/nombre, con su misma
 * lógica de ambigüedad ya probada) en vez de reescribirla.
 *
 * Ningún archivo de Daniela/Solo Talento se modifica para esto -- es
 * estrictamente aditivo (un archivo nuevo + nuevos actionType en el
 * executor, ver internal-action-executor.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarHorariosDisponiblesPorServicio,
  type EspecialistaConHorarios,
} from "@/lib/disponibilidad-servicio";
import { resolverSeleccionServicio, formatearPrecioCop, formatearHoraAmPm } from "@/lib/especialistas-flow-adaptador";

export type ServicioCatalogoReal = {
  id: string;
  nombre: string;
  precio: number;
  duracionMin: number;
  categoria: string | null;
};

export async function listarCatalogoServiciosReal(
  supabase: SupabaseClient,
  idTenant: string,
): Promise<ServicioCatalogoReal[]> {
  const { data } = await supabase
    .from("dulabs_servicios")
    .select("id, nombre, precio, duracion_min, categoria")
    .eq("id_tenant", idTenant)
    .eq("activo", true)
    .order("categoria", { ascending: true, nullsFirst: true })
    .order("nombre", { ascending: true });

  return ((data ?? []) as { id: string; nombre: string; precio: number | null; duracion_min: number; categoria: string | null }[]).map(
    (s) => ({ id: s.id, nombre: s.nombre, precio: s.precio ?? 0, duracionMin: s.duracion_min, categoria: s.categoria }),
  );
}

/** "15" -> "15 min"; "60" -> "1 h"; "90" -> "1 h 30 min". Determinista, nunca redactado por IA. */
export function formatearDuracion(min: number): string {
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  const resto = min % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** Texto legible determinista del catálogo real, con precio Y duración (nunca solo el nombre). */
export function formatearCatalogoReal(servicios: ServicioCatalogoReal[]): string {
  const NUMEROS_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  return servicios
    .map((s, i) => `${NUMEROS_EMOJI[i] ?? `${i + 1}.`} ${s.nombre} — ${formatearPrecioCop(s.precio)} (${formatearDuracion(s.duracionMin)})`)
    .join("\n");
}

export type ResultadoResolverServicioCatalogoReal =
  | { ok: true; servicio: ServicioCatalogoReal }
  | { ok: false; motivo: "fuera_de_lista" | "ambiguo"; detalle: string };

/**
 * ÚNICA función que decide qué servicio real quedó seleccionado -- reutiliza
 * la lógica de matching YA probada de resolverSeleccionServicio (índice 1-based
 * o nombre, con su misma detección de ambigüedad) y solo agrega de vuelta el
 * id/duración/categoría reales que esa función genérica no conoce.
 */
export function resolverServicioCatalogoReal(params: {
  servicios: ServicioCatalogoReal[];
  seleccionTipo?: string;
  seleccionIndice?: number;
  seleccionNombre?: string;
}): ResultadoResolverServicioCatalogoReal {
  const resultado = resolverSeleccionServicio({
    servicios: params.servicios,
    seleccionTipo: params.seleccionTipo,
    seleccionIndice: params.seleccionIndice,
    seleccionNombre: params.seleccionNombre,
  });
  if (!resultado.ok) return resultado;
  const completo = params.servicios.find((s) => s.nombre === resultado.nombre);
  if (!completo) {
    // Defensivo -- no debería pasar nunca (resultado.nombre siempre viene de
    // params.servicios), pero nunca se inventa un servicio a medias.
    return { ok: false, motivo: "fuera_de_lista", detalle: "No se pudo recuperar el servicio real seleccionado." };
  }
  return { ok: true, servicio: completo };
}

export type DisponibilidadCatalogoReal =
  | { ok: true; servicio: { id: string; nombre: string; duracionMin: number }; especialistas: EspecialistaConHorarios[]; texto: string }
  | { ok: false; motivo: "servicio_no_encontrado" | "sin_especialistas_habilitados"; detalle: string };

/**
 * Envoltorio fino sobre listarHorariosDisponiblesPorServicio (EL MISMO
 * resolver de disponibilidad que ya usa el portal de reservas real) -- no
 * reimplementa ninguna regla de horario/elegibilidad/bloqueo, solo agrega el
 * texto legible que necesita el mensaje de WhatsApp.
 */
export async function consultarDisponibilidadCatalogoReal(
  supabase: SupabaseClient,
  params: { idTenant: string; servicioId: string; fecha: string },
): Promise<DisponibilidadCatalogoReal> {
  const resultado = await listarHorariosDisponiblesPorServicio(supabase, params);
  if (!resultado.ok) return resultado;

  const conCupo = resultado.especialistas.filter((e) => e.horarios.length > 0);
  const texto =
    conCupo.length === 0
      ? "No encontré horarios disponibles ese día 😔 ¿Quieres intentar con otra fecha?"
      : conCupo
          .map((e) => `👩‍🦰 ${e.nombre}:\n${e.horarios.map((h) => `  • ${formatearHoraAmPm(h)}`).join("\n")}`)
          .join("\n\n");

  return { ok: true, servicio: resultado.servicio, especialistas: resultado.especialistas, texto };
}
