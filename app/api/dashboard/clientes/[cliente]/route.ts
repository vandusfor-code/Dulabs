/**
 * Bloque 33 — ficha de un cliente (`<phone_number_id>_<wa_id>`): datos, modalidad con su historial,
 * pedidos y nota interna. Solo clientes del negocio de la sesión.
 *   PATCH { nombre?, modalidad?: "detal"|"mayorista", esperado?: canal visto, motivo? (si cambia la
 *           modalidad), yaCompro? }  → Bloque 34: edita el cliente (compare-and-set de la modalidad).
 *   DELETE → Bloque 35 (solo administradores): elimina el cliente y todo lo suyo en el negocio (menos
 *           el chat del Inbox). Con un pedido activo: 409. Copia en la auditoría.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { detalleCliente, editarCliente, eliminarCliente } from "@/lib/catalogo/clientes/servicio";

export const runtime = "nodejs";

type Params = { params: Promise<{ cliente: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { cliente } = await params;
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor }) => detalleCliente(createSupabaseClientesRepo(supabase), createSupabaseCustomerChannelStore(supabase), actor.tenantId, cliente),
    { module: CLIENTS_MODULE, recurso: "clientes_lectura" },
  );
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { cliente } = await params;
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor, memberId }) => {
      const body = await request.json().catch(() => null);
      return editarCliente(createSupabaseClientesRepo(supabase), createSupabaseCustomerChannelStore(supabase), actor.tenantId, cliente, body, memberId);
    },
    { module: CLIENTS_MODULE, recurso: "clientes_escritura" },
  );
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { cliente } = await params;
  return withCatalog(
    request,
    "write",
    async ({ supabase, actor, memberId }) => eliminarCliente(createSupabaseClientesRepo(supabase), actor.tenantId, cliente, memberId),
    { module: CLIENTS_MODULE, recurso: "clientes_eliminar" },
  );
}
