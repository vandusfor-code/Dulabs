/**
 * GET /api/dashboard/tienda/contexto — lo que el editor necesita para armar sus formularios: las categorías del catálogo, las variables disponibles con su valor
 * (para «insertar variable» y para la vista previa) y la zona horaria con la que se interpretan las fechas. Solo lectura. Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { withCms } from "@/lib/cms-comercial/http";
import { ZONA_NEGOCIO } from "@/lib/cms-comercial/tiempo";
import { ETIQUETAS_VARIABLE, VARIABLES } from "@/lib/cms-comercial/variables";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ catalogo, variables, actor }) => {
    const [vars, categorias] = await Promise.all([variables.valores(actor.tenantId), catalogo.listarCategorias(actor.tenantId)]);
    return apiOk({
      variables: VARIABLES.map((id) => ({ id, etiqueta: ETIQUETAS_VARIABLE[id], valor: vars.variables[id] ?? null })),
      minimoMayorista: vars.minimoMayorista,
      categorias,
      zona: ZONA_NEGOCIO,
      ahora: new Date().toISOString(),
    });
  });
}
