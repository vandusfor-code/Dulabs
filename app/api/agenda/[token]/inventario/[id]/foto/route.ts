import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { obtenerProducto, actualizarProducto, subirFotoProducto, eliminarFotoProducto } from "@/lib/amore-inventario";

export const runtime = "nodejs";

function esAmore(idTenant: string): boolean {
  return idTenant === AMORE_TENANT_ID;
}

// Sube o reemplaza la foto de un producto ya existente (crear/editar según
// sección FOTOGRAFÍAS del pedido). Si el producto ya tenía una foto, la
// anterior se elimina del bucket DESPUÉS de que la nueva quedó guardada con
// éxito -- nunca se borra la vieja antes de confirmar que la nueva subió
// bien, para no dejar el producto sin ninguna imagen por un error a mitad de
// camino.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
  if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

  const producto = await obtenerProducto(supabase, tenant.idTenant, id);
  if (!producto) return Response.json({ error: "Producto no encontrado" }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File)) {
    return Response.json({ error: "Falta el archivo de imagen" }, { status: 400 });
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());
  const resultado = await subirFotoProducto(supabase, { idTenant: tenant.idTenant, productoId: id, buffer, mimeType: archivo.type });
  if (!resultado.ok) {
    return Response.json({ error: resultado.error }, { status: 400 });
  }

  const fotoAnterior = producto.fotoUrl;
  const actualizado = await actualizarProducto(supabase, tenant.idTenant, id, { fotoUrl: resultado.fotoUrl });
  if (fotoAnterior) {
    await eliminarFotoProducto(supabase, fotoAnterior);
  }

  return Response.json({ success: true, producto: actualizado });
}

// Elimina la foto actual (sección FOTOGRAFÍAS del pedido: debe poder
// eliminarse, no solo reemplazarse).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
  if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

  const producto = await obtenerProducto(supabase, tenant.idTenant, id);
  if (!producto) return Response.json({ error: "Producto no encontrado" }, { status: 404 });

  if (producto.fotoUrl) {
    await eliminarFotoProducto(supabase, producto.fotoUrl);
  }
  const actualizado = await actualizarProducto(supabase, tenant.idTenant, id, { fotoUrl: null });

  return Response.json({ success: true, producto: actualizado });
}
