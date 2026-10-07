/**
 * GET /api/dashboard/tienda/productos — productos del catálogo del negocio para los selectores del editor (nunca ids internos).
 *   ?q=aretes            búsqueda por nombre o referencia (sin texto: los más recientes)
 *   ?referencias=DL-000001,DL-000002   los productos ya elegidos, para mostrar su nombre, precio y foto
 * Solo lectura; el negocio sale de la sesión. Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { firstIssueMessage, isReference, normalizeSearch } from "@/lib/catalogo/domain";
import { consultaProductos } from "@/lib/cms-comercial/http-esquemas";
import { withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

const MAX_REFERENCIAS = 60;
const RESULTADOS_BUSQUEDA = 20;

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ catalogo, actor }) => {
    const q = consultaProductos.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!q.success) return apiError("VALIDATION_ERROR", firstIssueMessage(q.error), 400);
    if (q.data.referencias !== undefined) {
      const referencias = [...new Set(q.data.referencias.split(",").map((r) => r.trim().toUpperCase()).filter(Boolean))];
      if (referencias.length > MAX_REFERENCIAS) return apiError("VALIDATION_ERROR", `Máximo ${MAX_REFERENCIAS} referencias por consulta.`, 400);
      if (!referencias.every(isReference)) return apiError("VALIDATION_ERROR", "Una de las referencias no tiene un formato válido (por ejemplo DL-000184).", 400);
      return apiOk({ items: await catalogo.productosPorReferencia(actor.tenantId, referencias) });
    }
    return apiOk({ items: await catalogo.buscarProductos(actor.tenantId, normalizeSearch(q.data.q) ?? "", RESULTADOS_BUSQUEDA) });
  });
}
