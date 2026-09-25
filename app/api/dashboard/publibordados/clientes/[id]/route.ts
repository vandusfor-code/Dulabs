import type { NextRequest } from "next/server";
import { requireClientes } from "@/lib/publibordados/clientes/auth";
import { leerId } from "@/lib/publibordados/clientes/modelo";
import { crearRepositorioClientes } from "@/lib/publibordados/clientes/repositorio";
import { obtenerCliente } from "@/lib/publibordados/clientes/servicio";

export const runtime = "nodejs";

// Ficha del cliente + historial de solicitudes (más reciente primero). Los datos del cliente son
// informativos; estado y asesor se cambian en cada solicitud (/solicitudes/[id]). Un id de otro
// tenant responde 404, igual que uno inexistente.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireClientes(request, "read");
  if (!acceso.ok) return acceso.response;
  const id = leerId((await params).id);
  if (id === null) return Response.json({ error: "Cliente no encontrado" }, { status: 404 });
  try {
    const r = await obtenerCliente(crearRepositorioClientes(acceso.supabase), acceso.tenantId, id);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json(r.data);
  } catch (err) {
    console.error("[api/publibordados/clientes] error leyendo ficha:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudo cargar el cliente." }, { status: 500 });
  }
}
