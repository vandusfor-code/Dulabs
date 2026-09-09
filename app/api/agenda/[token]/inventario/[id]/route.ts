import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import {
  obtenerProducto,
  actualizarProducto,
  ajustarStockProducto,
  validarNombreProducto,
  validarPrecioProducto,
  validarStockProducto,
} from "@/lib/amore-inventario";

export const runtime = "nodejs";

function esAmore(idTenant: string): boolean {
  return idTenant === AMORE_TENANT_ID;
}

type BodyProducto = {
  nombre?: string;
  descripcion?: string | null;
  precio?: number;
  stock?: number;
  categoria?: string | null;
  activo?: boolean;
  /** Ajuste relativo de stock (+1/+5/+10/-1/-5...) -- mutuamente excluyente con `stock` (absoluto). Nunca deja el stock en negativo. */
  ajusteStock?: number;
};

// Edita un producto existente (incluye activar/desactivar y el stock, ya sea
// de forma absoluta o con un ajuste relativo +/-). Todo queda scoped por
// id_tenant primero -- mismo patrón exacto que
// app/api/agenda/[token]/servicios/[id]/route.ts.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
  if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

  const existente = await obtenerProducto(supabase, tenant.idTenant, id);
  if (!existente) return Response.json({ error: "Producto no encontrado" }, { status: 404 });

  let body: BodyProducto;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (body.ajusteStock !== undefined) {
    const delta = Number(body.ajusteStock);
    if (!Number.isInteger(delta)) {
      return Response.json({ error: "El ajuste de stock debe ser un número entero" }, { status: 400 });
    }
    const producto = await ajustarStockProducto(supabase, tenant.idTenant, id, delta);
    return Response.json({ success: true, producto });
  }

  const cambios: Parameters<typeof actualizarProducto>[3] = {};
  if (body.nombre !== undefined) {
    const nombre = validarNombreProducto(body.nombre);
    if (!nombre) return Response.json({ error: "El nombre no puede quedar vacío" }, { status: 400 });
    cambios.nombre = nombre;
  }
  if (body.descripcion !== undefined) cambios.descripcion = body.descripcion?.trim() || null;
  if (body.precio !== undefined) {
    const precio = validarPrecioProducto(body.precio);
    if (precio === null) return Response.json({ error: "El precio debe ser un número entero mayor o igual a 0" }, { status: 400 });
    cambios.precio = precio;
  }
  if (body.stock !== undefined) {
    const stock = validarStockProducto(body.stock);
    if (stock === null) return Response.json({ error: "El stock debe ser un número entero mayor o igual a 0" }, { status: 400 });
    cambios.stock = stock;
  }
  if (body.categoria !== undefined) cambios.categoria = body.categoria?.trim() || null;
  if (body.activo !== undefined) cambios.activo = Boolean(body.activo);

  const producto = await actualizarProducto(supabase, tenant.idTenant, id, cambios);
  return Response.json({ success: true, producto });
}
