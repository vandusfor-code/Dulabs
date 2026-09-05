import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { especialistaPorRuta } from "@/lib/especialistas";
import { planDelTenant } from "@/lib/plan-limits";
import { requireAuth, requireRole } from "@/lib/auth/authz";
import type { UsuarioSesion } from "@/lib/auth/session";

/**
 * Fase 5 (panel administrativo de Daniela) — resuelve el tenant de las
 * rutas admin (servicios/especialistas/horarios/bloqueos/clientes/etc.)
 * EXACTAMENTE igual que siempre: el token de la URL identifica al
 * especialista y de ahí su id_tenant. A partir de Login AMORE, ADEMÁS exige
 * una sesión real cuando el tenant tiene login habilitado (ver
 * lib/auth/authz.ts::requireAuth) -- un tenant sin ningún usuario en
 * dulabs_usuarios (Daniela, Solo Talento) sigue funcionando sin sesión,
 * ningún comportamiento cambia para ellos.
 */
export type ResolverTenantResultado =
  | {
      ok: true;
      idTenant: string;
      phoneNumberId: string;
      especialistaId: number;
      /** rol EFECTIVO: viene de la sesión si el tenant tiene login habilitado, o "administrador" por defecto (tenant legacy sin login). */
      rol: "administrador" | "colaboradora";
      /** null en un tenant sin login habilitado -- el resto del código nunca debe asumir que existe. */
      sesion: UsuarioSesion | null;
    }
  | { ok: false; status: number; error: string };

export async function resolverTenantDesdeToken(
  supabase: SupabaseClient,
  token: string,
  request: NextRequest
): Promise<ResolverTenantResultado> {
  const especialista = await especialistaPorRuta(supabase, token);
  if (!especialista) return { ok: false, status: 404, error: "Link inválido" };

  const plan = await planDelTenant(supabase, especialista.id_tenant);
  if (plan.id === "sin_plan") return { ok: false, status: 403, error: "Plan pausado, pendiente de pago" };

  const auth = await requireAuth(supabase, request, especialista.id_tenant);
  if (!auth.ok) return auth;

  // Login AMORE (autorizado) — HALLAZGO REAL en verificación de producción:
  // una colaboradora con sesión válida podía escribir en la URL el token de
  // OTRA especialista del mismo tenant y ver su nombre/equipo (aunque las
  // citas reales seguían aisladas por especialista_id más abajo en cada
  // ruta, esto ya era una fuga real de "de quién es este token" -- spec
  // "no permitir acceso administrativo/de otra persona mediante URL
  // directa"). Una colaboradora SOLO puede usar el token que resuelve a su
  // propia especialista_id; un administrador puede usar cualquier token del
  // tenant (ya podía ver todo el equipo desde su propio panel).
  if (auth.sesion && auth.sesion.rol === "colaboradora" && auth.sesion.especialistaId !== especialista.id) {
    return { ok: false, status: 403, error: "No autorizado" };
  }

  return {
    ok: true,
    idTenant: especialista.id_tenant,
    phoneNumberId: especialista.phone_number_id,
    especialistaId: especialista.id,
    rol: auth.sesion?.rol ?? "administrador",
    sesion: auth.sesion,
  };
}

/** Compuerta server-side para rutas admin-only (contabilidad, servicios, especialistas, WhatsApp, configuración...). Nunca confiar en que el frontend ya ocultó el botón. */
export function requiereAdministrador(
  tenant: Extract<ResolverTenantResultado, { ok: true }>
): { ok: true } | { ok: false; status: number; error: string } {
  return requireRole(tenant.sesion, "administrador");
}
