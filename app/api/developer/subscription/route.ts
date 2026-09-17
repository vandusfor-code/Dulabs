import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk } from "@/lib/developer/dev-api-http";
import { resolverEntitlementsDeWorkspace } from "@/lib/developer/plans";
import { periodoActual, obtenerResumenMensualDelWorkspace, contarNumerosDelWorkspace } from "@/lib/developer/usage-ledger";
import { contarNumerosDeCuenta, contarWorkspacesDeCuenta, contarMiembrosDeCuenta, obtenerResumenMensualDeCuenta, obtenerCuentaPorId } from "@/lib/developer/accounts-store";
import { listarMiembros } from "@/lib/developer/memberships-store";
import { billingHabilitado } from "@/lib/developer/billing/billing-flag";
import { obtenerSuscripcion } from "@/lib/developer/billing/billing-store";

// DuLabs Developer V1 -- Fase 11 (autorizado). Vista canónica de suscripción
// A NIVEL DE CUENTA: plan, estado, entitlements (nominales) y uso agregado
// (números/mensajes/workspaces/miembros). Cualquier rol activo puede leer.
// Expone el precio del plan (catálogo público) para el Dashboard -- NUNCA
// expone tokens/secretos.

export const runtime = "nodejs";

function disponible(incluidos: number | null, usados: number): number | null {
  return incluidos === null ? null : Math.max(0, incluidos - usados);
}

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const period = periodoActual();
    const e = await resolverEntitlementsDeWorkspace(ctx.supabase, ctx.workspaceId);

    let numbersUsed: number;
    let workspacesUsed: number;
    let membersUsed: number;
    let resumen: { reserved: number; confirmed: number };
    if (e.accountId) {
      [numbersUsed, workspacesUsed, membersUsed, resumen] = await Promise.all([
        contarNumerosDeCuenta(ctx.supabase, e.accountId),
        contarWorkspacesDeCuenta(ctx.supabase, e.accountId),
        contarMiembrosDeCuenta(ctx.supabase, e.accountId),
        obtenerResumenMensualDeCuenta(ctx.supabase, { accountId: e.accountId, period }),
      ]);
    } else {
      const [nums, res, miembros] = await Promise.all([
        contarNumerosDelWorkspace(ctx.supabase, ctx.workspaceId),
        obtenerResumenMensualDelWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, period }),
        listarMiembros(ctx.supabase, ctx.workspaceId),
      ]);
      numbersUsed = nums;
      workspacesUsed = 1;
      membersUsed = new Set(miembros.filter((m) => m.estado === "activo").map((m) => m.user_id)).size || 1;
      resumen = res;
    }
    const mensajesUsados = resumen.reserved + resumen.confirmed;

    // Info de billing (Fase 12, aditiva): estado de suscripción/período. Sin
    // cuenta (legacy) o sin fila de billing => valores nulos/false.
    const cuentaFila = e.accountId ? await obtenerCuentaPorId(ctx.supabase, e.accountId) : null;
    const sub = e.accountId ? await obtenerSuscripcion(ctx.supabase, e.accountId) : null;
    const billing = {
      enabled: billingHabilitado(),
      intervalo: sub?.intervalo ?? null,
      proximoCobro: sub?.proximo_cobro ?? null,
      periodoFin: cuentaFila?.periodo_fin ?? null,
      cancelarAlFinPeriodo: cuentaFila?.cancelar_al_fin_periodo ?? false,
      scheduledDowngradeTo: sub?.downgrade_a_plan ?? null,
    };

    return jsonOk(
      {
        plan: e.planCodigo,
        planName: e.planNombre,
        estado: e.estado,
        consumoBloqueado: e.consumoBloqueado,
        period,
        pricing: { monthlyUsd: e.precioMensualUsd, additionalNumberUsd: e.precioNumeroAdicionalUsd },
        numbers: {
          included: e.includedNumbers,
          additional: e.additionalNumbers,
          max: e.maxNumbers,
          used: numbersUsed,
          available: disponible(e.maxNumbers, numbersUsed),
          canBuyAdditional: e.canBuyAdditionalNumbers,
        },
        messages: {
          included: e.maxMessagesMonth,
          reserved: resumen.reserved,
          confirmed: resumen.confirmed,
          used: mensajesUsados,
          available: disponible(e.maxMessagesMonth, mensajesUsados),
        },
        workspaces: { included: e.maxWorkspaces, used: workspacesUsed, available: disponible(e.maxWorkspaces, workspacesUsed) },
        members: { included: e.maxMembers, used: membersUsed, available: disponible(e.maxMembers, membersUsed) },
        limits: { messagesPerSecondPerNumber: e.throughputPerNumber },
        billing,
      },
      ctx.requestId
    );
  });
}
