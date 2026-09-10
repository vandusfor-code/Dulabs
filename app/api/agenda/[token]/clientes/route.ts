import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";
import { normalizarTelefono } from "@/lib/marketplace-store";
import { recordarNombreCliente } from "@/lib/clientes-conocidos";
import { resolverPhoneNumberIdCliente, validarCumpleanos } from "./identidad";

export const runtime = "nodejs";

type ClienteFila = {
  id: number;
  telefono_cliente: string;
  nombre: string;
  correo: string | null;
  created_at: string;
  cumple_dia: number | null;
  cumple_mes: number | null;
};

// Vista de clientes -- SOLO LECTURA, reutiliza dulabs_clientes_conocidos tal
// cual (Fase 3/4), sin agregar ningún campo nuevo ni convertirla en CRM.
// Cantidad de citas y última cita se calculan aquí (no viven en la tabla)
// cruzando contra dulabs_citas_especialista, ambas SIEMPRE filtradas por
// id_tenant -- nunca se cruzan clientes de un tenant con citas de otro.
//
// AMORE (Fase 4, base de clientes, autorizado) — agrega cumple_dia/cumple_mes
// (Fase 3, ya existían en la tabla) y created_at (fecha de registro) a la
// respuesta -- ningún dato nuevo se inventa, ambos ya vivían en la fila.
// `q` (opcional) filtra por nombre O teléfono, server-side (ilike), para
// cualquier tenant que use este panel -- no es exclusivo de AMORE.
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  const q = request.nextUrl.searchParams.get("q")?.trim();

  let consultaClientes = supabase
    .from("dulabs_clientes_conocidos")
    .select("id, telefono_cliente, nombre, correo, created_at, cumple_dia, cumple_mes")
    .eq("id_tenant", tenant.idTenant)
    .order("nombre", { ascending: true });
  if (q) {
    const escapado = q.replace(/[%_]/g, "\\$&");
    consultaClientes = consultaClientes.or(`nombre.ilike.%${escapado}%,telefono_cliente.ilike.%${escapado}%`);
  }

  const [{ data: clientes }, { data: citas }] = await Promise.all([
    consultaClientes,
    supabase
      .from("dulabs_citas_especialista")
      .select("telefono_cliente, inicio, estado")
      .eq("id_tenant", tenant.idTenant)
      .not("estado", "in", "(cancelada,rechazada)"),
  ]);

  const porTelefono = new Map<string, { cantidad: number; ultima: string | null }>();
  for (const c of (citas ?? []) as { telefono_cliente: string | null; inicio: string; estado: string }[]) {
    if (!c.telefono_cliente) continue;
    const actual = porTelefono.get(c.telefono_cliente) ?? { cantidad: 0, ultima: null };
    actual.cantidad += 1;
    if (!actual.ultima || c.inicio > actual.ultima) actual.ultima = c.inicio;
    porTelefono.set(c.telefono_cliente, actual);
  }

  const resultado = ((clientes ?? []) as ClienteFila[]).map((cliente) => ({
    id: cliente.id,
    nombre: cliente.nombre,
    telefono: cliente.telefono_cliente,
    correo: cliente.correo,
    fechaRegistro: cliente.created_at,
    cumpleDia: cliente.cumple_dia,
    cumpleMes: cliente.cumple_mes,
    citasRegistradas: porTelefono.get(cliente.telefono_cliente)?.cantidad ?? 0,
    ultimaCita: porTelefono.get(cliente.telefono_cliente)?.ultima ?? null,
  }));

  return Response.json({ clientes: resultado });
}

type BodyClienteNuevo = { nombre?: string; telefono?: string; correo?: string; cumpleDia?: number | null; cumpleMes?: number | null };

// Crear cliente (autorizado) -- pensado para el paso "Crear nuevo cliente"
// de Nueva cita (item 8), pero es un endpoint genérico real: cualquier
// pantalla de administración puede usarlo. NO crea un cliente duplicado si
// ya existe uno con el mismo WhatsApp (misma identidad exacta que usa el
// registro real por conversación de WhatsApp, ver ./identidad.ts) -- entrega
// el existente en su lugar, nunca dos filas para la misma persona.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = supabaseAdmin();
  const tenant = await resolverTenantDesdeToken(supabase, token, request);
  if (!tenant.ok) return Response.json({ error: tenant.error }, { status: tenant.status });
  const permiso = requiereAdministrador(tenant);
  if (!permiso.ok) return Response.json({ error: permiso.error }, { status: permiso.status });

  let body: BodyClienteNuevo;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nombre = body.nombre?.trim();
  if (!nombre) return Response.json({ error: "El nombre es obligatorio" }, { status: 400 });
  const telefono = normalizarTelefono(body.telefono);
  if (!telefono) return Response.json({ error: "El WhatsApp es obligatorio" }, { status: 400 });
  const cumpleanos = validarCumpleanos(body.cumpleDia, body.cumpleMes);
  if (!cumpleanos.ok) return Response.json({ error: cumpleanos.error }, { status: 400 });

  const phoneNumberId = resolverPhoneNumberIdCliente(tenant);

  const { data: existente } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("id, telefono_cliente, nombre, correo, created_at, cumple_dia, cumple_mes")
    .eq("id_tenant", tenant.idTenant)
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefono)
    .maybeSingle();
  if (existente) {
    return Response.json({
      success: true,
      yaExistia: true,
      cliente: {
        id: existente.id,
        nombre: existente.nombre,
        telefono: existente.telefono_cliente,
        correo: existente.correo,
        fechaRegistro: existente.created_at,
        cumpleDia: existente.cumple_dia,
        cumpleMes: existente.cumple_mes,
      },
    });
  }

  await recordarNombreCliente(supabase, {
    idTenant: tenant.idTenant,
    phoneNumberId,
    telefonoCliente: telefono,
    nombre,
    correo: body.correo,
    cumpleDia: body.cumpleDia ?? undefined,
    cumpleMes: body.cumpleMes ?? undefined,
  });

  const { data: creado } = await supabase
    .from("dulabs_clientes_conocidos")
    .select("id, telefono_cliente, nombre, correo, created_at, cumple_dia, cumple_mes")
    .eq("id_tenant", tenant.idTenant)
    .eq("phone_number_id", phoneNumberId)
    .eq("telefono_cliente", telefono)
    .maybeSingle();
  if (!creado) return Response.json({ error: "No se pudo crear el cliente" }, { status: 500 });

  return Response.json({
    success: true,
    yaExistia: false,
    cliente: {
      id: creado.id,
      nombre: creado.nombre,
      telefono: creado.telefono_cliente,
      correo: creado.correo,
      fechaRegistro: creado.created_at,
      cumpleDia: creado.cumple_dia,
      cumpleMes: creado.cumple_mes,
    },
  });
}
