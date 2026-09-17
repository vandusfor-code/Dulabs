import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { listarEventosDelWorkspace, type TipoEvento, type EstadoEntrega, type FiltrosEventos } from "@/lib/developer/events-store";

// DuLabs Developer V1 -- Fase 13 (autorizado, 13.1/13.2). GET = lista paginada
// de eventos del workspace con observabilidad de entrega. Cualquier rol activo
// (lectura). Proyección SEGURA/redactada (nunca secretos/tokens). Tenant scope
// server-side: el workspace SIEMPRE viene de la sesión (ctx.workspaceId), NUNCA
// del cliente. Filtros: tipo, estado de entrega, rango de fechas, job,
// correlation_id.

export const runtime = "nodejs";

const TIPOS: TipoEvento[] = ["received", "queued", "sending", "sent", "delivered", "read", "failed"];
const ESTADOS: EstadoEntrega[] = ["pendiente", "entregando", "entregado", "fallido", "dlq", "sin_webhook"];

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const q = new URL(request.url).searchParams;
    const limitRaw = Number(q.get("limit") ?? "20");
    const tipo = q.get("tipo");
    const entregaEstado = q.get("entregaEstado");
    if (tipo && !TIPOS.includes(tipo as TipoEvento)) return jsonError(400, "invalid_request", ctx.requestId, "tipo inválido");
    if (entregaEstado && !ESTADOS.includes(entregaEstado as EstadoEntrega)) return jsonError(400, "invalid_request", ctx.requestId, "entregaEstado inválido");

    const filtros: FiltrosEventos = {
      workspaceId: ctx.workspaceId, // SIEMPRE de la sesión
      limit: Number.isFinite(limitRaw) ? limitRaw : 20,
      cursor: q.get("cursor") ?? undefined,
      tipo: (tipo as TipoEvento) ?? undefined,
      entregaEstado: (entregaEstado as EstadoEntrega) ?? undefined,
      desde: q.get("desde") ?? undefined,
      hasta: q.get("hasta") ?? undefined,
      jobId: q.get("jobId") ?? undefined,
      correlationId: q.get("correlationId") ?? undefined,
    };
    const { events, nextCursor } = await listarEventosDelWorkspace(ctx.supabase, filtros);
    return jsonOk({ events, nextCursor }, ctx.requestId);
  });
}
