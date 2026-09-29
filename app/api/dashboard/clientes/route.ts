/**
 * Bloque 33 — módulo "Clientes" (negocio de la sesión; exige el módulo "clientes_joyeria").
 *   GET ?q=&filtro=todos|detal|mayorista|compraron|sin_compras|registrados&pagina=  → un cliente por contacto.
 *   POST { nombre, telefono, modalidad: "detal"|"mayorista", yaCompro?, numero? }  → registra un cliente
 *        (Bloque 34): nombre conocido, modalidad (asesora) y ficha. 409 si ese celular ya es cliente.
 * Solo quien atiende (admin / agente): son datos personales (teléfono, compras, notas).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { listarClientes, registrarCliente } from "@/lib/catalogo/clientes/servicio";
import { createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "orders", async ({ supabase, actor }) => listarClientes(createSupabaseClientesRepo(supabase), actor.tenantId, request.nextUrl.searchParams), {
    module: CLIENTS_MODULE,
    recurso: "clientes_lectura",
  });
}

export async function POST(request: NextRequest) {
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor, memberId }) => {
      const body = await request.json().catch(() => null);
      return registrarCliente(createSupabaseClientesRepo(supabase), createSupabaseCustomerChannelStore(supabase), actor.tenantId, body, memberId);
    },
    { module: CLIENTS_MODULE, recurso: "clientes_escritura" },
  );
}
