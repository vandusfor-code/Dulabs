import type { NextRequest } from "next/server";
import { requireClientes } from "@/lib/publibordados/clientes/auth";
import { leerFiltroSolicitudes, leerPagina } from "@/lib/publibordados/clientes/modelo";
import { crearRepositorioClientes } from "@/lib/publibordados/clientes/repositorio";
import { listarSolicitudes } from "@/lib/publibordados/clientes/servicio";

export const runtime = "nodejs";

// Bandeja de solicitudes: búsqueda (nombre, empresa, teléfono) y filtros por estado, tipo,
// producto, asesor y fechas, paginados en la base de datos. Tenant de la sesión.
export async function GET(request: NextRequest) {
  const acceso = await requireClientes(request, "read");
  if (!acceso.ok) return acceso.response;
  try {
    const params = request.nextUrl.searchParams;
    const resultado = await listarSolicitudes(crearRepositorioClientes(acceso.supabase), acceso.tenantId, leerFiltroSolicitudes(params), leerPagina(params));
    return Response.json(resultado);
  } catch (err) {
    console.error("[api/publibordados/solicitudes] error listando:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudieron cargar las solicitudes." }, { status: 500 });
  }
}
