/**
 * Bloque 33 — nota interna del equipo sobre un cliente.
 *   PUT { nota: string (≤ 1000), version: number }  // version = la que la persona VIO (0 = nueva)
 * Compare-and-set: si otra persona la cambió antes, 409 con la nota actual (nada se pisa).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { CLIENTS_MODULE } from "@/lib/catalogo/auth";
import { createSupabaseClientesRepo } from "@/lib/catalogo/clientes/repositorio";
import { guardarNotaCliente } from "@/lib/catalogo/clientes/servicio";

export const runtime = "nodejs";

type Params = { params: Promise<{ cliente: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { cliente } = await params;
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor, memberId }) => {
      const body = await request.json().catch(() => null);
      return guardarNotaCliente(createSupabaseClientesRepo(supabase), actor.tenantId, cliente, body, memberId);
    },
    { module: CLIENTS_MODULE, recurso: "clientes_escritura" },
  );
}
