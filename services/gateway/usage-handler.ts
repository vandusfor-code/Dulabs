import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerResumenMensualDelWorkspace, contarNumerosDelWorkspace, periodoActual } from "@/lib/developer/usage-ledger";
import { resolverLimitesDelWorkspace } from "@/lib/developer/plans";
import { conLecturaAutenticadaPorApiKey } from "./api-auth";
import { errorApi, exitoApi, type RespuestaApi } from "./errors";

// DuLabs Developer V1 -- GET /api/v1/usage. Fase 4 lo introdujo como un
// simple conteo por estado; Fase 7 (autorizado) lo extiende al motor real
// de plan/cuota mensual: plan, período (YYYY-MM en hora de Colombia),
// mensajes incluidos/reservados/confirmados/disponibles y números
// incluidos/utilizados/disponibles. NUNCA expone dinero/precio (decisión de
// Fase 4 mantenida: Fase 7 es el motor interno, no cobros).
//
// Compatibilidad hacia atrás: se conservan las claves de nivel superior
// `reserved`/`confirmed`/`released` (ahora del período mensual actual). Los
// parámetros `from`/`to` se siguen VALIDANDO (400 si son inválidos) pero
// quedan deprecados: el usage ahora es mensual por definición del plan.

export type RequestUso = { autorizacion: string | undefined; desde?: string; hasta?: string; requestId: string; ipRemota?: string };

function fechaValida(valor: string | undefined): boolean {
  if (valor === undefined) return true;
  return !Number.isNaN(new Date(valor).getTime());
}

/** included - (reserved+confirmed); null si el plan no define límite (AGENCY/ENTERPRISE). Nunca negativo. */
function disponible(incluidos: number | null, usados: number): number | null {
  if (incluidos === null) return null;
  return Math.max(0, incluidos - usados);
}

export async function manejarObtenerUso(deps: { supabase: SupabaseClient }, req: RequestUso): Promise<RespuestaApi> {
  return conLecturaAutenticadaPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    if (!fechaValida(req.desde) || !fechaValida(req.hasta)) {
      return errorApi(400, "invalid_request", "Los parámetros 'from'/'to' deben ser fechas ISO 8601 válidas", req.requestId);
    }

    const period = periodoActual();
    const [limites, resumen, numerosUsados] = await Promise.all([
      resolverLimitesDelWorkspace(deps.supabase, ctx.workspaceId),
      obtenerResumenMensualDelWorkspace(deps.supabase, { workspaceId: ctx.workspaceId, period }),
      contarNumerosDelWorkspace(deps.supabase, ctx.workspaceId),
    ]);

    const mensajesUsados = resumen.reserved + resumen.confirmed;

    return exitoApi(
      200,
      {
        plan: limites.planCodigo,
        period,
        // Compatibilidad hacia atrás (Fase 4) -- conteos del período actual.
        reserved: resumen.reserved,
        confirmed: resumen.confirmed,
        released: resumen.released,
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
        limits: {
          messagesPerSecondPerNumber: limites.mensajesPorSegundoPorNumero,
        },
      },
      req.requestId
    );
  });
}
