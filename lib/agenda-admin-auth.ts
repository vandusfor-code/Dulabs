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
  | { ok: true; idTenant: string; phoneNumberId: string; especialistaId: number; rol: "administrador" | "personal" }
  | { ok: false; status: number; error: string };

export async function resolverTenantDesdeToken(supabase: SupabaseClient, token: string): Promise<ResolverTenantResultado> {
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return { ok: false, status: 404, error: "Link inválido" };

  const plan = await planDelTenant(supabase, especialista.id_tenant);
  if (plan.id === "sin_plan") return { ok: false, status: 403, error: "Plan pausado, pendiente de pago" };

  return {
    ok: true,
    idTenant: especialista.id_tenant,
    phoneNumberId: especialista.phone_number_id,
    especialistaId: especialista.id,
    rol: await rolDeEspecialista(supabase, especialista.id),
  };
}

// Fase P (usuarios y permisos, autorizado) — consulta AISLADA, a propósito
// separada de COLUMNAS_ESPECIALISTA (lib/especialistas.ts): esa constante la
// usan decenas de consultas ya en producción (Daniela incluida) y agregarle
// una columna que todavía no existiera en la base rompería TODAS de golpe.
// Esta función, en cambio, degrada sola a "administrador" (el comportamiento
// de SIEMPRE) si la migración de rol aún no se ha corrido o la fila no
// aparece -- nunca lanza, nunca bloquea el resto del panel.
async function rolDeEspecialista(supabase: SupabaseClient, especialistaId: number): Promise<"administrador" | "personal"> {
  const { data, error } = await supabase.from("dulabs_especialistas").select("rol").eq("id", especialistaId).maybeSingle();
  if (error || !data) return "administrador";
  return (data.rol as "administrador" | "personal" | null) ?? "administrador";
}

/** Compuerta server-side para rutas admin-only (contabilidad, comisiones, configuración de comunicaciones). Nunca confiar en que el frontend ya ocultó el botón. */
export function requiereAdministrador(tenant: Extract<ResolverTenantResultado, { ok: true }>): { ok: true } | { ok: false; status: number; error: string } {
  if (tenant.rol !== "administrador") return { ok: false, status: 403, error: "Esta acción requiere un rol de administrador" };
  return { ok: true };
}
