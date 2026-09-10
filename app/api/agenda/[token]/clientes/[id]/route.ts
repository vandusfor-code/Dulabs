import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { normalizarTelefono } from "@/lib/marketplace-store";
import { validarCumpleanos } from "../identidad";

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

type BodyClienteEditar = { nombre?: string; telefono?: string; correo?: string | null; cumpleDia?: number | null; cumpleMes?: number | null };

// Editar cliente (autorizado) -- persiste de verdad en dulabs_clientes_conocidos,
// la MISMA tabla que ya usa todo el sistema (registro por WhatsApp,
// recordatorios, cumpleaños, Agenda V2) -- nunca una estructura paralela.
// Editar el WhatsApp de un cliente hacia uno que ya usa OTRO cliente del
// mismo tenant se rechaza con un error claro (23505, la unique real de la
// tabla) en vez de fusionar/duplicar identidades en silencio.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const clienteId = Number(id);
  if (!Number.isInteger(clienteId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const { data: existente } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("id")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", clienteId)
    .maybeSingle();
  if (!existente) return Response.json({ error: "Cliente no encontrado" }, { status: 404 });

  let body: BodyClienteEditar;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const cambios: Record<string, unknown> = {};
  if (body.nombre !== undefined) {
    const nombre = body.nombre.trim();
    if (!nombre) return Response.json({ error: "El nombre no puede quedar vacío" }, { status: 400 });
    cambios.nombre = nombre;
  }
  if (body.telefono !== undefined) {
    const telefono = normalizarTelefono(body.telefono);
    if (!telefono) return Response.json({ error: "El WhatsApp no es válido" }, { status: 400 });
    cambios.telefono_cliente = telefono;
  }
  if (body.correo !== undefined) cambios.correo = body.correo?.trim() || null;
  if (body.cumpleDia !== undefined || body.cumpleMes !== undefined) {
    const cumpleanos = validarCumpleanos(body.cumpleDia, body.cumpleMes);
    if (!cumpleanos.ok) return Response.json({ error: cumpleanos.error }, { status: 400 });
    if (body.cumpleDia !== undefined) cambios.cumple_dia = body.cumpleDia;
    if (body.cumpleMes !== undefined) cambios.cumple_mes = body.cumpleMes;
  }

  if (Object.keys(cambios).length > 0) {
    cambios.updated_at = new Date().toISOString();
    const { error } = await supabase.from("dulabs_clientes_conocidos").update(cambios).eq("id_tenant", tenant.idTenant).eq("id", clienteId);
    if (error) {
      if (error.code === "23505") return Response.json({ error: "Ya existe otro cliente con ese número de WhatsApp" }, { status: 409 });
      console.error("[clientes] error editando:", error.message);
      return Response.json({ error: "No se pudo guardar el cliente" }, { status: 500 });
    }
  }

  const { data: actualizado } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("id, telefono_cliente, nombre, correo, created_at, cumple_dia, cumple_mes")
    .eq("id_tenant", tenant.idTenant)
    .eq("id", clienteId)
    .single();
  if (!actualizado) return Response.json({ error: "No se pudo guardar el cliente" }, { status: 500 });

  return Response.json({
    success: true,
    cliente: {
      id: actualizado.id,
      nombre: actualizado.nombre,
      telefono: actualizado.telefono_cliente,
      correo: actualizado.correo,
      fechaRegistro: actualizado.created_at,
      cumpleDia: actualizado.cumple_dia,
      cumpleMes: actualizado.cumple_mes,
    },
  });
}
