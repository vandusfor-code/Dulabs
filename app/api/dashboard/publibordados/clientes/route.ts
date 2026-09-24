import type { NextRequest } from "next/server";
import { requireClientes } from "@/lib/publibordados/clientes/auth";
import { leerFiltro } from "@/lib/publibordados/clientes/modelo";
import { crearRepositorioClientes } from "@/lib/publibordados/clientes/repositorio";
import { listarClientes } from "@/lib/publibordados/clientes/servicio";

export const runtime = "nodejs";

// Módulo Clientes — listado paginado con búsqueda (nombre, empresa, teléfono)
// y filtros por tipo y estado. El tenant sale de la sesión (requireClientes).
export async function GET(request: NextRequest) {
  const acceso = await requireClientes(request, "read");
  if (!acceso.ok) return acceso.response;
  try {
    const params = request.nextUrl.searchParams;
    const resultado = await listarClientes(
      crearRepositorioClientes(acceso.supabase),
      acceso.tenantId,
      leerFiltro(params),
      Number(params.get("pagina") ?? "1"),
    );
    return Response.json(resultado);
  } catch (err) {
    console.error("[api/clientes] error listando:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudieron cargar los clientes." }, { status: 500 });
  }
}
