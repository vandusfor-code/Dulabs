import type { SupabaseClient } from "@supabase/supabase-js";
import { obtenerResumenUsoDelWorkspace } from "@/lib/developer/usage-ledger";
import { conWorkspaceAutenticadoPorApiKey } from "./api-auth";
import { errorApi, exitoApi, type RespuestaApi } from "./errors";

// DuLabs Developer V1 -- Fase 4 (autorizado). GET /api/v1/usage --
// lectura agregada sobre dulabs_dev_usage_ledger (ya activo desde el
// cierre de Fase 3). Sin dinero, sin plan, sin límites comerciales --
// eso queda explícitamente fuera de alcance.

export type RequestUso = { autorizacion: string | undefined; desde?: string; hasta?: string; requestId: string; ipRemota?: string };

function fechaValida(valor: string | undefined): boolean {
  if (valor === undefined) return true;
  return !Number.isNaN(new Date(valor).getTime());
}

export async function manejarObtenerUso(deps: { supabase: SupabaseClient }, req: RequestUso): Promise<RespuestaApi> {
  return conWorkspaceAutenticadoPorApiKey(deps, req.autorizacion, req.requestId, req.ipRemota, async (ctx) => {
    if (!fechaValida(req.desde) || !fechaValida(req.hasta)) {
      return errorApi(400, "invalid_request", "Los parámetros 'from'/'to' deben ser fechas ISO 8601 válidas", req.requestId);
    }

    const resumen = await obtenerResumenUsoDelWorkspace(deps.supabase, { workspaceId: ctx.workspaceId, desde: req.desde, hasta: req.hasta });
    return exitoApi(
      200,
      {
        period: { from: req.desde ?? null, to: req.hasta ?? null },
        reserved: resumen.reserved,
        confirmed: resumen.confirmed,
        released: resumen.released,
      },
      req.requestId
    );
  });
}
