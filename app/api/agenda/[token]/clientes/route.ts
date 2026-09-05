import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolverTenantDesdeToken, requiereAdministrador } from "@/lib/agenda-admin-auth";

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
