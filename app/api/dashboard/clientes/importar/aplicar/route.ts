/**
 * Bloque 34 — aplica la importación revisada en la vista previa.
 *   POST { filas: [{ nombre, telefono, modalidad, yaCompro }] }  (máx. 500)
 * El servidor vuelve a validar cada fila; una fila con error no frena las demás.
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { aplicarImportacion } from "@/lib/catalogo/clientes/servicio";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor, memberId }) => {
      const body = await request.json().catch(() => null);
      return aplicarImportacion(createSupabaseClientesRepo(supabase), createSupabaseCustomerChannelStore(supabase), actor.tenantId, body, memberId);
    },
    { module: CLIENTS_MODULE, recurso: "clientes_importar" },
  );
}
