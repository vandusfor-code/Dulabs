/**
 * Bloque 33 — módulo "Clientes" (negocio de la sesión; exige el módulo "clientes_joyeria").
 *   GET ?q=&filtro=todos|detal|mayorista|compraron|sin_compras&pagina=  → un cliente por contacto.
 * Solo quien atiende (admin / agente): son datos personales (teléfono, compras, notas).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { listarClientes } from "@/lib/catalogo/clientes/servicio";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "orders", async ({ supabase, actor }) => listarClientes(createSupabaseClientesRepo(supabase), actor.tenantId, request.nextUrl.searchParams), {
    module: CLIENTS_MODULE,
    recurso: "clientes_lectura",
  });
}
