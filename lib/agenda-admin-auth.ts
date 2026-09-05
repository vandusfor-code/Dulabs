import type { SupabaseClient } from "@supabase/supabase-js";
import { especialistaPorRuta } from "@/lib/especialistas";
import { planDelTenant } from "@/lib/plan-limits";

/**
 * Fase 5 (panel administrativo de Daniela) — resuelve el tenant de las
 * rutas admin nuevas (servicios/especialistas/horarios/bloqueos/clientes) EXACTAMENTE
 * igual que ya lo hace /api/agenda/[token]: el token de la URL es la única
 * autenticación (sin sesión), se resuelve a un especialista real y de ahí a
 * su id_tenant. Nunca se acepta un id_tenant que venga del body/query del
 * navegador -- reutiliza el mismo mecanismo existente, no uno nuevo.
 */
export type ResolverTenantResultado =
  | { ok: true; idTenant: string; phoneNumberId: string }
  | { ok: false; status: number; error: string };

export async function resolverTenantDesdeToken(supabase: SupabaseClient, token: string): Promise<ResolverTenantResultado> {
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return { ok: false, status: 404, error: "Link inválido" };

  const plan = await planDelTenant(supabase, especialista.id_tenant);
  if (plan.id === "sin_plan") return { ok: false, status: 403, error: "Plan pausado, pendiente de pago" };

  return { ok: true, idTenant: especialista.id_tenant, phoneNumberId: especialista.phone_number_id };
}
