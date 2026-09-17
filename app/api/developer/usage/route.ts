import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk } from "@/lib/developer/dev-api-http";
import { obtenerResumenMensualDelWorkspace, contarNumerosDelWorkspace, periodoActual } from "@/lib/developer/usage-ledger";
import { resolverEntitlementsDeWorkspace } from "@/lib/developer/plans";
import { contarNumerosDeCuenta, obtenerResumenMensualDeCuenta } from "@/lib/developer/accounts-store";

// DuLabs Developer V1 -- Fase 9 + Fase 11 (autorizado). GET /api/developer/usage.
// Mismo contrato de respuesta que Fase 9. Fase 11: los límites mostrados son
// NOMINALES (el plan real, incluso en past_due -> no muestra 0) y los conteos
// son A NIVEL DE CUENTA cuando el workspace pertenece a una cuenta. NUNCA
// expone dinero/precio (eso vive en GET /subscription). Cualquier rol activo lee.

export const runtime = "nodejs";

const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

function disponible(incluidos: number | null, usados: number): number | null {
  if (incluidos === null) return null;
  return Math.max(0, incluidos - usados);
}

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, [...ROLES], async (ctx) => {
    const period = periodoActual();
    const e = await resolverEntitlementsDeWorkspace(ctx.supabase, ctx.workspaceId);

    const [resumen, numerosUsados] = e.accountId
      ? await Promise.all([
          obtenerResumenMensualDeCuenta(ctx.supabase, { accountId: e.accountId, period }),
          contarNumerosDeCuenta(ctx.supabase, e.accountId),
        ])
      : await Promise.all([
          obtenerResumenMensualDelWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, period }),
          contarNumerosDelWorkspace(ctx.supabase, ctx.workspaceId),
        ]);

    const mensajesUsados = resumen.reserved + resumen.confirmed;
    return jsonOk(
      {
        plan: e.planCodigo,
        period,
        messages: {
          included: e.maxMessagesMonth,
          reserved: resumen.reserved,
          confirmed: resumen.confirmed,
          available: disponible(e.maxMessagesMonth, mensajesUsados),
        },
        numbers: {
          included: e.maxNumbers,
          used: numerosUsados,
          available: disponible(e.maxNumbers, numerosUsados),
        },
        limits: { messagesPerSecondPerNumber: e.throughputPerNumber },
      },
      ctx.requestId
    );
  });
}
