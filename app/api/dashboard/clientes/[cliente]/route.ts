/**
 * Bloque 33 — ficha de un cliente (`<phone_number_id>_<wa_id>`): datos, modalidad con su historial,
 * pedidos y nota interna. Solo clientes del negocio de la sesión.
 *   PATCH { nombre?, modalidad?: "detal"|"mayorista", esperado?: canal visto, motivo? (si cambia la
 *           modalidad), yaCompro? }  → Bloque 34: edita el cliente (compare-and-set de la modalidad).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { detalleCliente, editarCliente } from "@/lib/catalogo/clientes/servicio";

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
