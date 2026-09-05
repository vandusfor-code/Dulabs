import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

export const runtime = "nodejs";

// AMORE (Fase 4, base de clientes, autorizado) — detalle de UN cliente:
// sus datos (incluido cumple_dia/cumple_mes/created_at) + su historial real
// de reservas, ambos SIEMPRE filtrados por id_tenant (el mismo que ya
// resuelve el token) -- un id de cliente de otro tenant nunca puede
// consultarse desde acá, ni por adivinar el id. NO crea ningún sistema de
// reservas paralelo: el historial se lee directo de dulabs_citas_especialista,
// la misma tabla que ya usa toda la agenda.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const clienteId = Number(id);
  if (!Number.isInteger(clienteId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const { data: cliente } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("id, telefono_cliente, nombre, correo, created_at, cumple_dia, cumple_mes")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", clienteId)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "Cliente no encontrado" }, { status: 404 });

  const [{ data: citas }, { data: especialistas }] = await Promise.all([
    supabase
      .from("dulabs_citas_especialista")
      .select("id, servicio, especialista_id, inicio, fin, estado")
      .eq("id_tenant", tenant.idTenant)
      .eq("telefono_cliente", cliente.telefono_cliente)
      .order("inicio", { ascending: false }),
    supabase.from("dulabs_especialistas").select("id, nombre").eq("id_tenant", tenant.idTenant),
  ]);

  const nombrePorEspecialista = new Map<number, string>();
  for (const e of especialistas ?? []) nombrePorEspecialista.set(e.id as number, e.nombre as string);

  const historial = (citas ?? []).map((c) => ({
    id: c.id,
    servicio: c.servicio,
    profesional: nombrePorEspecialista.get(c.especialista_id as number) ?? "—",
    inicio: c.inicio,
    fin: c.fin,
    estado: c.estado,
  }));

  return Response.json({
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      telefono: cliente.telefono_cliente,
      correo: cliente.correo,
      fechaRegistro: cliente.created_at,
      cumpleDia: cliente.cumple_dia,
      cumpleMes: cliente.cumple_mes,
    },
    historial,
  });
}
