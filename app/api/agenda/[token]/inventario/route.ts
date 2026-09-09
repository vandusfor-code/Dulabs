import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { listarProductos, crearProducto, validarNombreProducto, validarPrecioProducto, validarStockProducto } from "@/lib/amore-inventario";

export const runtime = "nodejs";

// Módulo Inventario (autorizado) -- exclusivo de AMORE. Cualquier otro
// tenant que por algún motivo resuelva un token válido nunca puede leer ni
// escribir esta tabla: el aislamiento normal por id_tenant ya lo impediría a
// nivel de datos, pero además esta ruta corta explícitamente para cualquier
// tenant que no sea AMORE (sección TENANT del pedido).
function esAmore(idTenant: string): boolean {
  return idTenant === AMORE_TENANT_ID;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
  if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

  const productos = await listarProductos(supabase, tenant.idTenant);

  const resumen = {
    total: productos.length,
    activos: productos.filter((p) => p.activo).length,
    agotados: productos.filter((p) => p.stock === 0).length,
    unidades: productos.reduce((suma, p) => suma + p.stock, 0),
  };

  return Response.json({ productos, resumen });
}

type BodyProducto = {
  nombre?: string;
  descripcion?: string | null;
  precio?: number;
  stock?: number;
  categoria?: string | null;
  activo?: boolean;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
  if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

  let body: BodyProducto;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nombre = validarNombreProducto(body.nombre);
  if (!nombre) return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });

  const precio = validarPrecioProducto(body.precio);
  if (precio === null) return Response.json({ error: "El precio debe ser un número entero mayor o igual a 0" }, { status: 400 });

  const stock = validarStockProducto(body.stock);
  if (stock === null) return Response.json({ error: "El stock debe ser un número entero mayor o igual a 0" }, { status: 400 });

  const producto = await crearProducto(supabase, tenant.idTenant, {
    nombre,
    descripcion: body.descripcion?.trim() || null,
    precio,
    stock,
    categoria: body.categoria?.trim() || null,
    activo: body.activo ?? true,
  });

  return Response.json({ success: true, producto });
}
