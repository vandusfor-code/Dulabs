import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk } from "@/lib/developer/dev-api-http";
import { obtenerResumenMensualDelWorkspace, contarNumerosDelWorkspace, periodoActual } from "@/lib/developer/usage-ledger";
import { resolverLimitesDelWorkspace } from "@/lib/developer/plans";

// DuLabs Developer V1 -- Fase 9 (autorizado). GET /api/developer/usage.
// Reutiliza el motor de Fase 7. NUNCA expone dinero/precio. Cualquier rol
// activo puede leer.

export const runtime = "nodejs";

const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

function disponible(incluidos: number | null, usados: number): number | null {
  if (incluidos === null) return null;
  return Math.max(0, incluidos - usados);
}

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, [...ROLES], async (ctx) => {
    const period = periodoActual();
    const [limites, resumen, numerosUsados] = await Promise.all([
      resolverLimitesDelWorkspace(ctx.supabase, ctx.workspaceId),
      obtenerResumenMensualDelWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, period }),
      contarNumerosDelWorkspace(ctx.supabase, ctx.workspaceId),
    ]);
    const mensajesUsados = resumen.reserved + resumen.confirmed;
    return jsonOk(
      {
        plan: limites.planCodigo,
        period,
        messages: {
          included: limites.mensajesMensualesIncluidos,
          reserved: resumen.reserved,
          confirmed: resumen.confirmed,
          available: disponible(limites.mensajesMensualesIncluidos, mensajesUsados),
        },
        numbers: {
          included: limites.numerosIncluidos,
          used: numerosUsados,
          available: disponible(limites.numerosIncluidos, numerosUsados),
        },
        limits: { messagesPerSecondPerNumber: limites.mensajesPorSegundoPorNumero },
      },
      ctx.requestId
    );
  });
}
