import { supabaseAdmin } from "@/lib/supabase";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { listarProductosActivos, mapearProductosParaTienda } from "@/lib/amore-inventario";

export const runtime = "nodejs";

// Tienda pública de AMORE (/amore/tienda, autorizado) -- SIN auth, tenant
// FIJO en el servidor (nunca en la URL/query, sección SEGURIDAD del pedido:
// "no exponer IDs sensibles innecesarios"). Solo devuelve lo que la vitrina
// necesita: nunca el stock numérico exacto (solo `agotado`), nunca el id
// interno del producto más allá de lo necesario para el botón Comprar.
export async function GET() {
  const supabase = supabaseAdmin();

  const [{ data: config }, productos] = await Promise.all([
    supabase.from("dulabs_clientes_config").select("nombre_negocio, telefono_negocio").eq("id_tenant", AMORE_TENANT_ID).maybeSingle(),
    listarProductosActivos(supabase, AMORE_TENANT_ID),
  ]);

  const productosPublicos = mapearProductosParaTienda(productos);

  return Response.json({
    negocio: config?.nombre_negocio ?? "AMORE",
    telefonoNegocio: config?.telefono_negocio ?? null,
    productos: productosPublicos,
  });
}
