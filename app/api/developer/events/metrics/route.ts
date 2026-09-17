import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk } from "@/lib/developer/dev-api-http";
import { metricasDeEntrega } from "@/lib/developer/events-store";

// DuLabs Developer V1 -- Fase 13 (autorizado, 13.6). Métricas de entrega de
// eventos del workspace (recibidos, entregados, fallidos, DLQ, tasa). Cualquier
// rol. Tenant scope server-side. Sin traer filas (head counts).

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const q = new URL(request.url).searchParams;
    const metricas = await metricasDeEntrega(ctx.supabase, {
      workspaceId: ctx.workspaceId,
      desde: q.get("desde") ?? undefined,
      hasta: q.get("hasta") ?? undefined,
    });
    return jsonOk(metricas, ctx.requestId);
  });
}
