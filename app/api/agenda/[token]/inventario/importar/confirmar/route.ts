import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import {
  crearProducto,
  buscarProductoPorNombre,
  validarNombreProducto,
  validarPrecioProducto,
  validarStockProducto,
  type ProductoInventario,
} from "@/lib/amore-inventario";

export const runtime = "nodejs";
export const maxDuration = 30;

function esAmore(idTenant: string): boolean {
  return idTenant === AMORE_TENANT_ID;
}

type FilaBody = {
  nombre?: string | null;
  descripcion?: string | null;
  precio?: number | null;
  stock?: number | null;
  categoria?: string | null;
  activo?: boolean;
};

// Confirma la importación -- NUNCA confía en el `estado` que calculó el
// preview del lado del cliente (podría haber sido manipulado): revalida
// nombre/precio/stock y vuelve a chequear duplicados por nombre ACÁ, justo
// antes de insertar. Solo crea productos genuinamente nuevos y válidos
// (sección DUPLICADOS del pedido: nunca crea ni actualiza un producto
// existente desde acá -- eso se hace manualmente desde Editar).
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const supabase = supabaseAdmin();
    const tenant = await resolverTenantDesdeToken(supabase, token, request);
    if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
    const permiso = requiereAdministrador(tenant);
    if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
    if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

    let body: { filas?: FilaBody[] };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "JSON inválido" }, { status: 400 });
    }
    const filas = Array.isArray(body.filas) ? body.filas : [];
    if (filas.length === 0) {
      return Response.json({ error: "No hay filas para importar" }, { status: 400 });
    }

    const creados: ProductoInventario[] = [];
    const omitidos: { nombre: string | null; motivo: string }[] = [];

    for (const fila of filas) {
      const nombre = validarNombreProducto(fila.nombre);
      const precio = validarPrecioProducto(fila.precio);
      const stock = validarStockProducto(fila.stock);
      if (!nombre || precio === null || stock === null) {
        omitidos.push({ nombre: fila.nombre ?? null, motivo: "Fila inválida" });
        continue;
      }
      const existente = await buscarProductoPorNombre(supabase, tenant.idTenant, nombre);
      if (existente) {
        omitidos.push({ nombre, motivo: "Ya existe un producto con este nombre" });
        continue;
      }
      const producto = await crearProducto(supabase, tenant.idTenant, {
        nombre,
        descripcion: fila.descripcion?.trim() || null,
        precio,
        stock,
        categoria: fila.categoria?.trim() || null,
        activo: fila.activo ?? true,
      });
      creados.push(producto);
    }

    return Response.json({ success: true, creados: creados.length, omitidos, productos: creados });
  } catch (err) {
    console.error("[inventario/importar/confirmar] error inesperado:", err instanceof Error ? err.stack ?? err.message : err);
    return Response.json({ error: err instanceof Error ? err.message : "Error inesperado confirmando la importación" }, { status: 500 });
  }
}
