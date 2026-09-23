/**
 * AMORE -- datos REALES del negocio para que la IA responda consultas ("¿cuánto cuesta?", "¿cuánto demora?", "¿qué
 * es el dipping?", "¿quién lo hace?") sin inventar nada.
 *
 * Causa raíz que corrige: Gemini respondía las consultas SOLO con el mensaje y el historial -- sin catálogo, sin
 * precios, sin duraciones, sin profesionales. Su propia instrucción decía "si no conoces un precio, sugiere
 * confirmarlo al agendar": no podía contestar lo más básico y, sin la lista de servicios, podía afirmar que AMORE hace
 * algo que no está en el catálogo.
 *
 * Fuentes (las mismas que usa el resto de la plataforma, nunca una copia):
 * - listarCatalogoServiciosReal -- servicios activos con precio/duración/categoría (lo mismo que ofrece Agenda V2).
 * - cargarConocimientoReal (dulabs_bot_conocimiento) -- fichas "qué es / para qué sirve / límites" tomadas del
 *   documento oficial de AMORE, ligadas por FK al catálogo.
 * - dulabs_servicio_especialista + dulabs_especialistas -- quién realiza cada servicio (asociación EXPLÍCITA, la que
 *   usa AMORE en el 100 % de sus servicios; si un servicio no la tiene, no se afirma nada sobre quién lo hace).
 *
 * La disponibilidad NUNCA va aquí: días y horarios solo los ofrece Agenda V2 consultando la agenda real.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listarCatalogoServiciosReal, type ServicioCatalogoReal } from "@/lib/catalogo-servicios-flow-adaptador";
import { cargarConocimientoReal } from "@/lib/bot-escenarios/store";
import type { ConocimientoServicio } from "@/lib/bot-escenarios/tipos";
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";

export interface DatosNegocioAmore {
  servicios: ServicioCatalogoReal[];
  conocimiento: ConocimientoServicio[];
  /** servicioId -> nombres de las profesionales activas con asociación explícita. */
  profesionalesPorServicio: Record<string, string[]>;
}

export async function cargarDatosNegocioAmore(supabase: SupabaseClient, tenantId: string): Promise<DatosNegocioAmore> {
  const [servicios, conocimiento, asociaciones, especialistas] = await Promise.all([
    listarCatalogoServiciosReal(supabase, tenantId),
    cargarConocimientoReal(supabase, tenantId),
    supabase.from("dulabs_servicio_especialista").select("servicio_id, especialista_id").eq("id_tenant", tenantId),
    supabase.from("dulabs_especialistas").select("id, nombre").eq("id_tenant", tenantId).eq("activo", true),
  ]);
  const nombrePorId = new Map(((especialistas.data ?? []) as { id: number; nombre: string }[]).map((e) => [e.id, e.nombre]));
  const profesionalesPorServicio: Record<string, string[]> = {};
  for (const fila of (asociaciones.data ?? []) as { servicio_id: string; especialista_id: number }[]) {
    const nombre = nombrePorId.get(fila.especialista_id);
    if (!nombre) continue; // profesional inactiva: nunca se ofrece
    (profesionalesPorServicio[fila.servicio_id] ??= []).push(nombre);
  }
  return { servicios, conocimiento, profesionalesPorServicio };
}

/** Texto compacto y estable para el prompt. Pura: testeable sin red. */
export function formatearContextoNegocio(datos: DatosNegocioAmore): string {
  const fichaPorServicio = new Map(datos.conocimiento.map((c) => [c.servicioId, c]));
  const porCategoria = new Map<string, ServicioCatalogoReal[]>();
  for (const s of datos.servicios) {
    const categoria = s.categoria ?? "Otros";
    (porCategoria.get(categoria) ?? porCategoria.set(categoria, []).get(categoria)!).push(s);
  }

  const bloques: string[] = [];
  for (const [categoria, servicios] of porCategoria) {
    const lineas = servicios.map((s) => {
      const partes = [`- ${s.nombre}: ${s.precio > 0 ? formatearPrecioCop(s.precio) : "precio no registrado (no lo digas, ofrece confirmarlo)"}, ${s.duracionMin} min aprox.`];
      const quienes = datos.profesionalesPorServicio[s.id];
      if (quienes && quienes.length > 0) partes.push(`  Lo realizan: ${[...new Set(quienes)].join(", ")}.`);
      if (s.descripcion) partes.push(`  Descripción: ${s.descripcion}`);
      const ficha = fichaPorServicio.get(s.id);
      if (ficha?.queEs) partes.push(`  Qué es: ${ficha.queEs}`);
      if (ficha?.paraQueSirve) partes.push(`  Para qué sirve: ${ficha.paraQueSirve}`);
      if (ficha?.limites) partes.push(`  NO afirmar: ${ficha.limites}`);
      return partes.join("\n");
    });
    bloques.push(`${categoria}:\n${lineas.join("\n")}`);
  }

  return [
    "SERVICIOS REALES (catálogo activo de AMORE; es la lista COMPLETA -- lo que no esté aquí AMORE no lo ofrece):",
    bloques.join("\n\n"),
    "HORARIO GENERAL DEL SALÓN: lunes a viernes 9:00 a. m. a 7:00 p. m.; sábados 9:00 a. m. a 6:00 p. m.; domingos cerrado. (Cada profesional puede tener su propio horario: la disponibilidad real la consulta el sistema de agenda.)",
  ].join("\n\n");
}

const TTL_MS = 60_000;
const cache = new Map<string, { expira: number; texto: string }>();

/**
 * Contexto listo para el prompt, con caché corta por tenant (60 s) para no repetir 4 consultas en cada mensaje de una
 * misma conversación. Un cambio de precio en el panel se refleja en menos de un minuto.
 */
export async function construirContextoNegocioAmore(supabase: SupabaseClient, tenantId: string, ahora: () => number = Date.now): Promise<string> {
  const guardado = cache.get(tenantId);
  if (guardado && guardado.expira > ahora()) return guardado.texto;
  const texto = formatearContextoNegocio(await cargarDatosNegocioAmore(supabase, tenantId));
  cache.set(tenantId, { expira: ahora() + TTL_MS, texto });
  return texto;
}
