import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { ensureCuentaParaWorkspace } from "@/lib/developer/accounts-store";
import { setNumerosAdicionales } from "@/lib/developer/subscription-store";
import { resolverEntitlementsDeWorkspace } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 11 (autorizado). Fija el total de números
// adicionales de la CUENTA (Agency/Enterprise). OWNER/ADMIN. Developer se
// rechaza a nivel DB (no_permitido). Atómico. NO cobra: Fase 12 validará el
// pago antes de aplicar el incremento.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { total?: number; motivo?: string } | null;
    const total = cuerpo?.total;
    if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
      return jsonError(400, "invalid_request", ctx.requestId, "'total' debe ser un entero >= 0");
    }
    const cuenta = await ensureCuentaParaWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId });
    // Comprar/incrementar adicionales es consumo nuevo con costo -> bloqueado
    // en past_due/canceled (solo si es un incremento; permitir decrementar).
    const e = await resolverEntitlementsDeWorkspace(ctx.supabase, ctx.workspaceId);
    if (e.consumoBloqueado && total > e.additionalNumbers) {
      return jsonError(402, "subscription_past_due", ctx.requestId, "La suscripción no está activa: no se pueden comprar números adicionales.");
    }
    const r = await setNumerosAdicionales(ctx.supabase, { accountId: cuenta.id, nuevoTotal: total, actorUserId: ctx.userId, motivo: cuerpo?.motivo ?? null });
    if (!r.ok) {
      if (r.motivo === "no_permitido") return jsonError(403, "additional_numbers_not_allowed", ctx.requestId, "Tu plan no permite números adicionales. Actualiza a Agency.");
      if (r.motivo === "recursos_por_encima") return jsonError(409, "resources_above_limit", ctx.requestId, r.detalle ?? undefined);
      if (r.motivo === "valor_invalido") return jsonError(400, "invalid_request", ctx.requestId);
      return jsonError(404, "account_not_found", ctx.requestId);
    }
    return jsonOk({ ok: true, additionalNumbers: total }, ctx.requestId);
  });
}
