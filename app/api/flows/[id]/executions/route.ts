import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById } from "@/lib/flow/flow-store";
import { listExecutionsFiltered, type ExecutionStatusFilter } from "@/lib/flow/execution-inspector-store";

export const runtime = "nodejs";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "running",
  "waiting_input",
  "waiting_effect",
  "completed",
  "failed",
  "transferred",
]);

// Lista ejecuciones (dulabs_flow_executions) del Flow, aisladas por tenant.
// No modifica ninguna tabla de observabilidad -- solo lectura.
//
// Fase 2 (Execution Inspector, autorizado) -- ampliado de forma
// RETROCOMPATIBLE: sin query params, el comportamiento es IDÉNTICO al de
// antes (hasta 100 ejecuciones, más reciente primero, misma forma
// `{executions}`) salvo que ahora también trae `total`/`page`/`pageSize`
// (campos NUEVOS que cualquier consumidor existente que solo lea
// `.executions` sigue ignorando sin romperse). Los filtros (`status`,
// `telefono`) y la paginación (`page`, `pageSize`) son estrictamente
// opt-in vía query string -- usa `listExecutionsFiltered`
// (lib/flow/execution-inspector-store.ts, capa de lectura NUEVA y separada)
// en vez de reimplementar el filtrado acá.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  if (statusParam && !VALID_STATUSES.has(statusParam)) {
    return Response.json({ error: `'status' inválido -- valores válidos: ${[...VALID_STATUSES].join(", ")}` }, { status: 400 });
  }
  const telefono = url.searchParams.get("telefono") ?? undefined;
  const pageParam = url.searchParams.get("page");
  const pageSizeParam = url.searchParams.get("pageSize");
  const page = pageParam ? Number(pageParam) : undefined;
  const pageSize = pageSizeParam ? Number(pageSizeParam) : undefined;
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
    return Response.json({ error: "'page' debe ser un entero >= 1" }, { status: 400 });
  }
  if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1)) {
    return Response.json({ error: "'pageSize' debe ser un entero >= 1" }, { status: 400 });
  }

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const result = await listExecutionsFiltered(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      status: statusParam as ExecutionStatusFilter | undefined,
      telefono,
      // Sin `page`/`pageSize` en la query, se preserva el default histórico
      // (page 1, pageSize 100) -- mismo límite exacto que ya devolvía este
      // endpoint antes de esta fase.
      page,
      pageSize: pageSize ?? (page === undefined && pageSizeParam === null ? 100 : undefined),
    });
    return Response.json({
      executions: result.executions,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
