/**
 * GET /api/dashboard/tienda/contexto — lo que el editor necesita para armar sus formularios: las categorías del catálogo, las variables disponibles con su valor
 * (para «insertar variable» y para la vista previa), la zona horaria con la que se interpretan las fechas y la ruta pública de la tienda (para «Ver mi tienda»).
 * Solo lectura. Admin, agente y lectura.
 */
import type { NextRequest } from "next/server";
import { apiOk } from "@/lib/agent-compiler/api/http";
import { withCms } from "@/lib/cms-comercial/http";
import { ZONA_NEGOCIO } from "@/lib/cms-comercial/tiempo";
import { ETIQUETAS_VARIABLE, VARIABLES } from "@/lib/cms-comercial/variables";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withCms(request, "read", async ({ catalogo, variables, actor }) => {
    // La ruta de la tienda es una comodidad: si no se puede resolver, el editor simplemente no muestra el enlace.
    const [vars, categorias, rutaTienda] = await Promise.all([
      variables.valores(actor.tenantId),
      catalogo.listarCategorias(actor.tenantId),
      Promise.resolve(catalogo.rutaPublica?.(actor.tenantId)).then((r) => r ?? null, () => null),
    ]);
    return apiOk({
      variables: VARIABLES.map((id) => ({ id, etiqueta: ETIQUETAS_VARIABLE[id], valor: vars.variables[id] ?? null })),
      minimoMayorista: vars.minimoMayorista,
      categorias,
      rutaTienda,
      zona: ZONA_NEGOCIO,
      ahora: new Date().toISOString(),
    });
  });
}
