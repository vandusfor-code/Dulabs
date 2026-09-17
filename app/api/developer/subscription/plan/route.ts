import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { ensureCuentaParaWorkspace } from "@/lib/developer/accounts-store";
import { cambiarPlan } from "@/lib/developer/subscription-store";
import { obtenerPlan } from "@/lib/developer/plans";
import { billingHabilitado } from "@/lib/developer/billing/billing-flag";
import { esPlanManual } from "@/lib/developer/billing/pricing";
import { validarRecursosCabenEnPlan } from "@/lib/developer/billing/billing-lifecycle";
import { registrarIntencionDowngrade, auditarBilling } from "@/lib/developer/billing/billing-store";

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

    // Fase 12 (billing ON): el upgrade exige pago (checkout) y el downgrade se
    // difiere al fin de período. Con billing OFF, se conserva EXACTAMENTE el
    // comportamiento de Fase 11 (cambio inmediato) -> los 16/16 no se tocan.
    if (billingHabilitado()) {
      if (nuevoPlan === cuenta.plan_codigo) return jsonOk({ ok: true, plan: cuenta.plan_codigo, changed: false }, ctx.requestId);
      if (esPlanManual(nuevoPlan)) return jsonError(400, "enterprise_manual", ctx.requestId, "Enterprise se contrata con el equipo comercial.");

      const planActual = await obtenerPlan(ctx.supabase, cuenta.plan_codigo);
      const precioT = planExiste.precio_mensual_usd ?? Number.POSITIVE_INFINITY;
      const precioA = planActual?.precio_mensual_usd ?? 0;
      if (precioT > precioA) {
        // Upgrade: no se aplica sin pago confirmado. El cliente debe pasar por checkout.
        return jsonError(402, "upgrade_requires_payment", ctx.requestId, "Este upgrade requiere pago. Complétalo en el checkout de billing.");
      }

      // Downgrade (opción A): validar recursos; registrar intención (se aplica al fin de período).
      const cabe = await validarRecursosCabenEnPlan(ctx.supabase, { accountId: cuenta.id, planCodigo: nuevoPlan });
      if (!cabe.ok) return jsonError(409, "downgrade_blocked", ctx.requestId, cabe.detalle);
      await registrarIntencionDowngrade(ctx.supabase, {
        accountId: cuenta.id,
        downgradeAPlan: nuevoPlan,
        intervaloDefault: "month",
        precioUsdCentsDefault: Math.round((planActual?.precio_mensual_usd ?? 0) * 100),
        proximoCobroDefault: cuenta.periodo_fin ? cuenta.periodo_fin.slice(0, 10) : null,
      });
      await auditarBilling(ctx.supabase, { accountId: cuenta.id, actorUserId: ctx.userId, accion: "DOWNGRADE_SCHEDULED", antes: { plan: cuenta.plan_codigo }, despues: { plan: nuevoPlan }, motivo: cuerpo?.motivo ?? null });
      return jsonOk({ ok: true, plan: cuenta.plan_codigo, scheduledDowngradeTo: nuevoPlan, effectiveAt: cuenta.periodo_fin }, ctx.requestId);
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
