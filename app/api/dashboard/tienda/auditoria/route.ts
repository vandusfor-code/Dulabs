/**
 * GET /api/dashboard/tienda/auditoria — quién cambió qué y cuándo (valor anterior y nuevo), el más reciente primero. Admin, agente y lectura.
 * Query opcional: `entidad` (id de un elemento), `limite` (1-200) y `antes` (id del último registro ya visto, para paginar).
 */
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { firstIssueMessage } from "@/lib/catalogo/domain";
import { consultaAuditoria } from "@/lib/cms-comercial/http-esquemas";
import { withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ servicio, actor }) => {
    const q = consultaAuditoria.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!q.success) return apiError("VALIDATION_ERROR", firstIssueMessage(q.error), 400);
    return apiOk({ registros: await servicio.auditoria(actor, { entidadId: q.data.entidad, limite: q.data.limite, antesDe: q.data.antes }) });
  });
}
