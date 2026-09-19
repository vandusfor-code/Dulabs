/**
 * Acceso a datos del catálogo del Business Agent (R6) — SOLO LECTURA, por tenant.
 *
 * Lo usan el listado del catálogo (servicios + productos) y la cotización. El tenant
 * llega SIEMPRE de request.tenantId (contexto confiable), nunca del payload/IA, y
 * cada query filtra por `id_tenant`. Solo filas ACTIVAS.
 *
 * A diferencia de listarCatalogoServiciosReal (que convierte precio null en 0 porque
 * el flujo de agenda necesita un número), aquí el precio NULO se conserva: una
 * cotización jamás debe decir "$0" para un servicio sin precio fijo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuoteCatalogItem } from "@/lib/business-agent-quote";
import { formatCop } from "@/lib/business-agent-quote";

export interface CatalogFlags {
  servicios: boolean;
  productos: boolean;
}

export interface BusinessAgentCatalogStore {
  listarServicios(tenantId: string): Promise<QuoteCatalogItem[]>;
  listarProductos(tenantId: string): Promise<QuoteCatalogItem[]>;
}

export function createSupabaseCatalogStore(supabase: SupabaseClient): BusinessAgentCatalogStore {
  return {
    async listarServicios(tenantId) {
      const { data, error } = await supabase
        .from("dulabs_servicios")
        .select("id, nombre, precio")
        .eq("id_tenant", tenantId)
        .eq("activo", true)
        .order("nombre", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<{ id: string; nombre: string; precio: number | null }>).map((s) => ({
        tipo: "servicio" as const,
        id: s.id,
        nombre: s.nombre,
        precio: s.precio,
      }));
    },
    async listarProductos(tenantId) {
      const { data, error } = await supabase
        .from("dulabs_inventario_productos")
        .select("id, nombre, precio, stock")
        .eq("id_tenant", tenantId)
        .eq("activo", true)
        .order("nombre", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Array<{ id: string; nombre: string; precio: number; stock: number }>).map((p) => ({
        tipo: "producto" as const,
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        stock: p.stock,
      }));
    },
  };
}

/** Catálogo cotizable según lo que el negocio eligió (servicios y/o productos). */
export async function cargarCatalogoCotizable(store: BusinessAgentCatalogStore, tenantId: string, flags: CatalogFlags): Promise<QuoteCatalogItem[]> {
  const [servicios, productos] = await Promise.all([
    flags.servicios ? store.listarServicios(tenantId) : Promise.resolve([]),
    flags.productos ? store.listarProductos(tenantId) : Promise.resolve([]),
  ]);
  return [...servicios, ...productos];
}

const NUMEROS_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

function duracionTexto(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}

/**
 * Listado DETERMINISTA de servicios (mismo formato que formatearCatalogoReal) pero respetando el
 * precio NULO: un servicio "sin precio fijo" dice "precio a confirmar", nunca "$0". El adaptador
 * compartido (catalogo-servicios-flow-adaptador) convierte null en 0 porque otros flujos lo necesitan;
 * el Business Agent no puede mostrar ese 0 como si fuera un precio.
 */
export function formatearServiciosTexto(
  servicios: Array<{ id: string; nombre: string; precio: number; duracionMin: number }>,
  sinPrecio: ReadonlySet<string>,
): string {
  return servicios
    .map((s, i) => `${NUMEROS_EMOJI[i] ?? `${i + 1}.`} ${s.nombre} — ${sinPrecio.has(s.id) ? "precio a confirmar" : formatCop(s.precio)} (${duracionTexto(s.duracionMin)})`)
    .join("\n");
}

/** Sección de texto DETERMINISTA de productos para el listado del catálogo. */
export function formatearProductosTexto(productos: QuoteCatalogItem[]): string {
  return productos
    .map((p) => `• ${p.nombre} — ${p.precio === null ? "precio a confirmar" : formatCop(p.precio)}${p.stock === 0 ? " (agotado)" : ""}`)
    .join("\n");
}
