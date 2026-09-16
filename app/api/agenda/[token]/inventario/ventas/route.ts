import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { registrarVentaProducto, validarCantidadVenta, listarVentasProductos } from "@/lib/amore-inventario-ventas";

export const runtime = "nodejs";

// Módulo Inventario -- "Registrar venta" (autorizado). Mismo patrón EXACTO
// que app/api/agenda/[token]/inventario/route.ts: exclusivo de AMORE, nunca
// otro tenant aunque resuelva un token válido.
function esAmore(idTenant: string): boolean {
  return idTenant === AMORE_TENANT_ID;
}

const MENSAJE_POR_MOTIVO: Record<string, string> = {
  cantidad_invalida: "La cantidad debe ser un número entero mayor o igual a 1",
  producto_no_encontrado: "El producto no existe",
  producto_inactivo: "Este producto está inactivo y no se puede vender",
  stock_insuficiente: "No hay suficiente stock disponible para esa cantidad",
};

type BodyVenta = {
  productoId?: string;
  cantidad?: number;
  idempotencyKey?: string;
};

// Historial reciente de ventas -- soporta la trazabilidad (sección
// "HISTORIAL / TRAZABILIDAD" del pedido) y una futura pantalla de
// actividad, sin que nada tenga que volver a consultar Supabase a mano.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
  if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

  const ventas = await listarVentasProductos(supabase, { idTenant: tenant.idTenant, limite: 50 });
  return Response.json({ ventas });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
  if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

  let body: BodyVenta;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Sección "SEGURIDAD Y DATOS" del pedido -- nunca confiar en precio/total
  // enviados por el frontend: acá solo se validan FORMA (producto_id real,
  // cantidad entera >= 1, idempotency_key presente). El precio vigente, el
  // total y la validación real de stock/estado activo viven EXCLUSIVAMENTE
  // en dulabs_registrar_venta_producto (Postgres), nunca en esta ruta.
  const productoId = typeof body.productoId === "string" ? body.productoId.trim() : "";
  if (!productoId) return Response.json({ error: "productoId es obligatorio" }, { status: 400 });

  const cantidad = validarCantidadVenta(body.cantidad);
  if (cantidad === null) return Response.json({ error: MENSAJE_POR_MOTIVO.cantidad_invalida }, { status: 400 });

  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey) return Response.json({ error: "idempotencyKey es obligatorio" }, { status: 400 });

  const resultado = await registrarVentaProducto(supabase, tenant.idTenant, { productoId, cantidad, idempotencyKey });
  if (!resultado.ok) {
    return Response.json({ error: MENSAJE_POR_MOTIVO[resultado.motivo] }, { status: 409 });
  }

  return Response.json({ success: true, venta: resultado.venta, stockRestante: resultado.stockRestante, yaExistia: resultado.yaExistia });
}
