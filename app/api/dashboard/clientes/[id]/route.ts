import type { NextRequest } from "next/server";
import { requireClientes } from "@/lib/clientes-modulo/auth";
import { validarCambio } from "@/lib/clientes-modulo/modelo";
import { crearRepositorioClientes } from "@/lib/clientes-modulo/repositorio";
import { actualizarCliente, obtenerCliente } from "@/lib/clientes-modulo/servicio";

export const runtime = "nodejs";

function leerId(valor: string): number | null {
  if (!/^\d{1,15}$/.test(valor)) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Ficha del cliente. Un id de otro tenant responde 404, igual que uno inexistente.
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
    console.error("[api/clientes] error leyendo ficha:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudo cargar el cliente." }, { status: 500 });
  }
}

// Cambia SOLO estado y/o asesor (admin/agente). Los datos que capturó el Flow no se editan aquí.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireClientes(request, "write");
  if (!acceso.ok) return acceso.response;
  const id = leerId((await params).id);
  if (id === null) return Response.json({ error: "Cliente no encontrado" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const validado = validarCambio(body);
  if (!validado.ok) return Response.json({ error: validado.error }, { status: 400 });

  try {
    const r = await actualizarCliente(crearRepositorioClientes(acceso.supabase), acceso.tenantId, id, validado.cambio);
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json(r.data);
  } catch (err) {
    console.error("[api/clientes] error actualizando:", err instanceof Error ? err.message : err);
    return Response.json({ error: "No se pudo guardar el cambio." }, { status: 500 });
  }
}
