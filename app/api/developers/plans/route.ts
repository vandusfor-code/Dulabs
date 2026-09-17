import { supabaseAdmin } from "@/lib/supabase";
import { listarPlanesPublicos } from "@/lib/developers/planes-publicos";

// DuLabs Developer V1 -- Fase 15. Endpoint PÚBLICO y READ-ONLY del catálogo
// comercial de planes, consumido por la landing (/developer-platform). Lee la
// fuente única (dulabs_dev_plans) y devuelve SOLO campos comerciales seguros
// (ver listarPlanesPublicos). No acepta input del cliente: no hay accountId,
// ni precios, ni monedas desde el frontend. No expone cuentas/tokens/secretos.

export const runtime = "nodejs";
// Se revalida cada 5 min: catálogo, no datos por usuario.
export const revalidate = 300;

export async function GET() {
  try {
    const plans = await listarPlanesPublicos(supabaseAdmin());
    return Response.json(
      { plans, generatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } },
    );
  } catch {
    // Fail-safe: la landing debe seguir cargando aunque el catálogo falle.
    return Response.json(
      { plans: [], error: "catalog_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
