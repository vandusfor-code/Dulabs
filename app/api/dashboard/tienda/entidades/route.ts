/**
 * /api/dashboard/tienda/entidades — Administración de tienda (CMS comercial).
 *   GET  lista los elementos del negocio (página principal, ofertas, combos, campañas y contenido), con su estado y vigencia derivada. Admin, agente y lectura.
 *   POST crea un elemento en BORRADOR. Solo administrador.
 * El negocio sale SIEMPRE de la sesión; ninguna ruta lo recibe por URL ni por cuerpo.
 */
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { firstIssueMessage } from "@/lib/catalogo/domain";
import { cuerpoCrear, consultaListar } from "@/lib/cms-comercial/http-esquemas";
import { leerCuerpo, withCms } from "@/lib/cms-comercial/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ servicio, actor }) => {
    const q = consultaListar.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!q.success) return apiError("VALIDATION_ERROR", firstIssueMessage(q.error), 400);
    return apiOk({ items: await servicio.listar(actor, { tipo: q.data.tipo, estado: q.data.estado, incluirArchivadas: q.data.archivadas === "true" }) });
  });
}

export async function POST(request: NextRequest) {
  return withCms(request, "write", async ({ servicio, actor }) => {
    const body = await leerCuerpo(request, cuerpoCrear);
    if (!body.ok) return body.response;
    return apiOk({ entidad: await servicio.crear(actor, body.data) }, 201);
  });
}
