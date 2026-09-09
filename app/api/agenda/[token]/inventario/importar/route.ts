import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import { cargarLibroExcel, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";
import { parseInventarioExcel, marcarDuplicados } from "@/lib/amore-inventario-excel";

export const runtime = "nodejs";
export const maxDuration = 30;

function esAmore(idTenant: string): boolean {
  return idTenant === AMORE_TENANT_ID;
}

// Sube el Excel oficial de Inventario y devuelve el PREVIEW fila por fila
// (sección VALIDACIÓN DEL EXCEL del pedido) -- nunca inserta nada acá; la
// confirmación real ocurre en POST .../importar/confirmar con solo las filas
// que el usuario decidió importar. Envuelto en try/catch de nivel superior,
// mismo criterio que app/api/dashboard/campanas/importar/route.ts: cualquier
// excepción no prevista devuelve JSON, nunca HTML de error.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const supabase = supabaseAdmin();
    const tenant = await resolverTenantDesdeToken(supabase, token, request);
    if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
    const permiso = requiereAdministrador(tenant);
    if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });
    if (!esAmore(tenant.idTenant)) return Response.json({ error: "No autorizado" }, { status: 403 });

    const form = await request.formData();
    const archivo = form.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0) {
      return Response.json({ error: "Falta el archivo" }, { status: 400 });
    }
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      return Response.json({ error: "El archivo supera el límite de 4 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await archivo.arrayBuffer());
    const libro = await cargarLibroExcel(archivo.name, buffer);
    if (!libro) {
      return Response.json({ error: "Sube un archivo .xlsx con la plantilla oficial de Inventario AMORE." }, { status: 400 });
    }

    const resultado = parseInventarioExcel(libro);
    if (!resultado) {
      return Response.json(
        { error: "El archivo no tiene las columnas de la plantilla oficial (Nombre del producto / Precio / Stock). Descarga la plantilla y vuelve a intentarlo." },
        { status: 400 }
      );
    }

    const conDuplicados = await marcarDuplicados(supabase, tenant.idTenant, resultado);
    return Response.json(conDuplicados);
  } catch (err) {
    console.error("[inventario/importar] error inesperado:", err instanceof Error ? err.stack ?? err.message : err);
    return Response.json({ error: err instanceof Error ? err.message : "Error inesperado importando el archivo" }, { status: 500 });
  }
}
