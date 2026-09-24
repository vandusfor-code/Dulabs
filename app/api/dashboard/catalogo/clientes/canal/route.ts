/**
 * POST /api/dashboard/catalogo/clientes/canal
 *   body: { numero, telefono, canal: "retail"|"wholesale", canal_actual: "retail"|"wholesale"|null, motivo }
 * Bloque 25 — una asesora (admin o agente) cambia la modalidad detal / por mayor de un cliente del
 * negocio de SU sesión. Explícito, con motivo, compare-and-set y bitácora (ver clientes-canal.ts).
 */
import type { NextRequest } from "next/server";
import { withCatalog } from "@/lib/catalogo/http";
import { createSupabaseCustomerChannelStore } from "@/lib/agente/clasificacion";
import { cambiarCanalCliente } from "@/lib/catalogo/pedidos/clientes-canal";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withCatalog(
    request,
    "orders",
    async ({ supabase, actor, memberId }) => {
      const body = await request.json().catch(() => null);
      return cambiarCanalCliente(
        {
          store: createSupabaseCustomerChannelStore(supabase),
          async numeroDelNegocio(tenantId, phoneNumberId) {
            const { data, error } = await supabase.from("dulabs_clientes_config").select("id").eq("id_tenant", tenantId).eq("phone_number_id", phoneNumberId).maybeSingle();
            if (error) throw new Error(`numero ${error.code ?? "?"}`);
            return !!data;
          },
        },
        { tenantId: actor.tenantId, memberId },
        body,
      );
    },
    { recurso: "catalogo_pedidos" },
  );
}
