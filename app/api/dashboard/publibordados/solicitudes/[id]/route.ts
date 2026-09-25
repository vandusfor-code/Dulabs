import type { NextRequest } from "next/server";
import { requireClientes } from "@/lib/publibordados/clientes/auth";
import { leerId, validarCambioSolicitud } from "@/lib/publibordados/clientes/modelo";
import { crearRepositorioClientes } from "@/lib/publibordados/clientes/repositorio";
import { actualizarSolicitud, obtenerSolicitud } from "@/lib/publibordados/clientes/servicio";

export const runtime = "nodejs";

// Detalle de UNA solicitud. Un id de otro tenant responde 404.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireClientes(request, "read");
  if (!acceso.ok) return acceso.response;
  const id = leerId((await params).id);
  if (id === null) return Response.json({ error: "Solicitud no encontrada" }, { status: 404 });
  try {
    const r = await obtenerSolicitud(crearRepositorioClientes(acceso.supabase), acceso.tenantId, id);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json(r.data);
  } catch (err) {
    console.error("[api/publibordados/solicitudes] error leyendo:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudo cargar la solicitud." }, { status: 500 });
  }
}

// Cambia SOLO estado y/o asesor de esta solicitud (admin/agente), con la versión leída. Los datos
// que capturó el Flow (producto, cantidad, cliente...) no se editan.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireClientes(request, "write");
  if (!acceso.ok) return acceso.response;
  const id = leerId((await params).id);
  if (id === null) return Response.json({ error: "Solicitud no encontrada" }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const validado = validarCambioSolicitud(body);
  if (!validado.ok) return Response.json({ error: validado.error }, { status: 400 });
  try {
    const r = await actualizarSolicitud(crearRepositorioClientes(acceso.supabase), acceso.tenantId, id, validado.cambio);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json(r.data);
  } catch (err) {
    console.error("[api/publibordados/solicitudes] error actualizando:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudo guardar el cambio." }, { status: 500 });
  }
}
