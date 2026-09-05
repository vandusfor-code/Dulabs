import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { conversacionDelTenant } from "@/lib/chats/conversaciones";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";

export const runtime = "nodejs";

type ClienteFila = {
  id: number;
  nombre: string;
  telefono_cliente: string;
  correo: string | null;
  created_at: string;
  cumple_dia: number | null;
  cumple_mes: number | null;
};

// Mismo cruce cliente<->historial que ya usa /clientes/[id] (Fase 4), esta
// vez buscando por teléfono (el dato real que sí tiene una conversación),
// nunca por un id que todavía puede no existir si la clienta no está
// registrada.
async function clienteYHistorial(supabase: SupabaseClient, idTenant: string, telefono: string) {
  const [{ data: cliente }, { data: citas }, { data: especialistas }] = await Promise.all([
    supabase
      .from("dulabs_clientes_conocidos")
      .select("id, nombre, telefono_cliente, correo, created_at, cumple_dia, cumple_mes")
      .eq("id_tenant", idTenant)
      .eq("telefono_cliente", telefono)
      .maybeSingle(),
    supabase
      .from("dulabs_citas_especialista")
      .select("id, servicio, especialista_id, inicio, fin, estado")
      .eq("id_tenant", idTenant)
      .eq("telefono_cliente", telefono)
      .order("inicio", { ascending: false }),
    supabase.from("dulabs_especialistas").select("id, nombre").eq("id_tenant", idTenant),
  ]);

  const nombrePorEspecialista = new Map<number, string>();
  for (const e of (especialistas ?? []) as { id: number; nombre: string }[]) nombrePorEspecialista.set(e.id, e.nombre);

  const historial = (citas ?? []).map((c) => ({
    id: c.id,
    servicio: c.servicio,
    profesional: nombrePorEspecialista.get(c.especialista_id as number) ?? "—",
    inicio: c.inicio,
    fin: c.fin,
    estado: c.estado,
  }));

  const c = cliente as ClienteFila | null;
  return {
    cliente: c
      ? {
          id: c.id,
          nombre: c.nombre,
          telefono: c.telefono_cliente,
          correo: c.correo,
          fechaRegistro: c.created_at,
          cumpleDia: c.cumple_dia,
          cumpleMes: c.cumple_mes,
        }
      : null,
    historial,
  };
}

// Panel de cliente del chat (Información/Citas/Historial) — vincula por
// coincidencia de teléfono con dulabs_clientes_conocidos, la MISMA tabla que
// usa toda la plataforma. Si no hay coincidencia, el frontend muestra
// "Cliente no registrado" + botón "Crear cliente" (POST de abajo), nunca un
// cliente ficticio.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const conversacionId = Number(id);
  if (!Number.isInteger(conversacionId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const conversacion = await conversacionDelTenant(supabase, tenant.idTenant, conversacionId);
  if (!conversacion) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });

  const resultado = await clienteYHistorial(supabase, tenant.idTenant, conversacion.telefono);
  return Response.json(resultado);
}

type BodyCliente = { nombre?: string; correo?: string; cumpleDia?: number; cumpleMes?: number };

// "Crear cliente" desde Chats -- reutiliza TAL CUAL recordarNombreCliente
// (Fase 3), la misma función que usa el portal público para guardar un
// cliente real. Nunca crea una tabla ni un modelo de cliente paralelo; la
// conversación queda enlazada (cliente_id) para que la pestaña "Clientes"
// del propio Chats la reconozca de inmediato.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const conversacionId = Number(id);
  if (!Number.isInteger(conversacionId)) return Response.json({ error: "ID inválido" }, { status: 400 });

  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const conversacion = await conversacionDelTenant(supabase, tenant.idTenant, conversacionId);
  if (!conversacion) return Response.json({ error: "Conversación no encontrada" }, { status: 404 });

  let body: BodyCliente;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const nombre = body.nombre?.trim();
  if (!nombre) return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });

  await recordarNombreCliente(supabase, {
    idTenant: tenant.idTenant,
    phoneNumberId: tenant.phoneNumberId,
    telefonoCliente: conversacion.telefono,
    nombre,
    correo: body.correo,
    cumpleDia: body.cumpleDia,
    cumpleMes: body.cumpleMes,
  });

  const { data: cliente } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("id, nombre, telefono_cliente, correo, created_at, cumple_dia, cumple_mes")
    .eq("id_tenant", tenant.idTenant)
    .eq("telefono_cliente", conversacion.telefono)
    .maybeSingle();
  if (!cliente) return Response.json({ error: "No se pudo crear el cliente" }, { status: 500 });

  await supabase
    .from("dulabs_chat_conversaciones")
    .update({ cliente_id: cliente.id, nombre_visible: nombre, updated_at: new Date().toISOString() })
    .eq("id", conversacionId);

  const c = cliente as ClienteFila;
  return Response.json({
    success: true,
    cliente: {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono_cliente,
      correo: c.correo,
      fechaRegistro: c.created_at,
      cumpleDia: c.cumple_dia,
      cumpleMes: c.cumple_mes,
    },
  });
}
