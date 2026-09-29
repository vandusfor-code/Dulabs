/**
 * Bloque 33 — exporta la lista filtrada de clientes a CSV (Excel), con la nota de cada uno.
 *   GET ?q=&filtro=  → text/csv (máx. 5.000 filas).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { exportarClientes } from "@/lib/catalogo/clientes/servicio";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCatalog(request, "orders", async ({ supabase, actor }) => exportarClientes(createSupabaseClientesRepo(supabase), actor.tenantId, request.nextUrl.searchParams), {
    module: CLIENTS_MODULE,
    recurso: "clientes_exportar",
  });
}
