import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { ensureCuentaParaWorkspace } from "@/lib/developer/accounts-store";
import { auditarBilling } from "@/lib/developer/billing/billing-store";

// DuLabs Developer V1 -- Fase 12 (Billing). Cancelación de la suscripción con
// cancelar_al_fin_periodo (por defecto true): el cliente conserva acceso hasta
// el final del período pagado; al finalizar, el cron lo pasa a 'canceled'. NO
// destruye workspaces/números/datos. Solo el dueño de la cuenta. Enviar
// { cancelar: false } revierte la cancelación programada.

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => ({}))) as { cancelar?: boolean } | null;
    const cancelar = cuerpo?.cancelar !== false; // default true

    const cuenta = await ensureCuentaParaWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId });
    if (cuenta.owner_user_id !== ctx.userId) {
      return jsonError(403, "not_account_owner", ctx.requestId, "Solo el dueño de la cuenta puede cancelar la suscripción.");
    }

    const { error } = await ctx.supabase
      .from("dulabs_dev_accounts")
      .update({ cancelar_al_fin_periodo: cancelar, updated_at: new Date().toISOString() })
      .eq("id", cuenta.id);
    if (error) return jsonError(500, "internal_error", ctx.requestId);

    await auditarBilling(ctx.supabase, {
      accountId: cuenta.id,
      actorUserId: ctx.userId,
      accion: cancelar ? "CANCEL_SCHEDULED" : "CANCEL_REVERTED",
      despues: { cancelar_al_fin_periodo: cancelar, periodo_fin: cuenta.periodo_fin },
    });

    return jsonOk({ ok: true, cancelarAlFinPeriodo: cancelar, periodoFin: cuenta.periodo_fin }, ctx.requestId);
  });
}
