import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { ensureCuentaParaWorkspace } from "@/lib/developer/accounts-store";
import { cambiarPlan } from "@/lib/developer/subscription-store";
import { obtenerPlan } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 11 (autorizado). Cambio de plan de la CUENTA.
// Solo OWNER. Downgrade bloqueado (opción A) si hay recursos por encima del
// plan destino -- validado atómicamente en el RPC. NO cobra: Fase 12 integra
// pagos. Materializa la cuenta si el workspace aún no tenía una.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { plan?: string; motivo?: string } | null;
    const nuevoPlan = cuerpo?.plan?.trim().toUpperCase();
    if (!nuevoPlan) return jsonError(400, "invalid_request", ctx.requestId, "Falta 'plan'");

    const planExiste = await obtenerPlan(ctx.supabase, nuevoPlan);
    if (!planExiste) return jsonError(400, "plan_invalido", ctx.requestId, "El plan no existe en el catálogo");

    // La cuenta se deriva SERVER-SIDE del workspace autenticado -- nunca de un
    // accountId del request. El cambio de plan (compromiso de facturación) se
    // autoriza contra el DUEÑO DE LA CUENTA (owner_user_id), no solo contra un
    // OWNER de workspace: un OWNER de un workspace que pertenece a la cuenta de
    // OTRO usuario no puede modificar esa suscripción.
    const cuenta = await ensureCuentaParaWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId });
    if (cuenta.owner_user_id !== ctx.userId) {
      return jsonError(403, "not_account_owner", ctx.requestId, "Solo el dueño de la cuenta puede cambiar el plan.");
    }
    const r = await cambiarPlan(ctx.supabase, { accountId: cuenta.id, nuevoPlan, actorUserId: ctx.userId, motivo: cuerpo?.motivo ?? null });
    if (!r.ok) {
      if (r.motivo === "downgrade_bloqueado") return jsonError(409, "downgrade_blocked", ctx.requestId, r.detalle ?? undefined);
      if (r.motivo === "plan_invalido") return jsonError(400, "plan_invalido", ctx.requestId);
      return jsonError(404, "account_not_found", ctx.requestId);
    }
    return jsonOk({ ok: true, plan: nuevoPlan }, ctx.requestId);
  });
}
