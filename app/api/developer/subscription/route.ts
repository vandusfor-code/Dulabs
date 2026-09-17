import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk } from "@/lib/developer/dev-api-http";
import { resolverEntitlementsDeWorkspace } from "@/lib/developer/plans";
import { periodoActual, obtenerResumenMensualDelWorkspace, contarNumerosDelWorkspace } from "@/lib/developer/usage-ledger";
import { contarNumerosDeCuenta, contarWorkspacesDeCuenta, contarMiembrosDeCuenta, obtenerResumenMensualDeCuenta } from "@/lib/developer/accounts-store";
import { listarMiembros } from "@/lib/developer/memberships-store";

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
      },
      ctx.requestId
    );
  });
}
