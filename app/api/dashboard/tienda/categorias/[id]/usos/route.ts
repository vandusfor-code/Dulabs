/**
 * GET /api/dashboard/tienda/categorias/[id]/usos — en qué partes de la tienda está elegida una categoría del catálogo (página principal, ofertas, campañas, pie de página, fotos y videos), tanto en lo
 * publicado como en los borradores. Lo usa el administrador de categorías del Catálogo antes de eliminar una, para que la persona sepa qué va a dejar de mostrarse. Solo lectura. Admin, agente y lectura.
 * No devuelve contenido, solo cómo se llama cada elemento y en qué parte de él está elegida.
 */
import type { NextRequest } from "next/server";
import { apiError, apiOk } from "@/lib/agent-compiler/api/http";
import { leerIdRuta, withCms } from "@/lib/cms-comercial/http";
import { usosDeCategoria } from "@/lib/cms-comercial/usos-categoria";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: crudo } = await params;
  return withCms(request, "read", async ({ catalogo, repo, actor }) => {
    const id = leerIdRuta(crudo, "La categoría");
    if (!id.ok) return id.response;
    // Solo una categoría de ESTE negocio: de otro negocio, o que no existe, «no existe» (nunca se cuenta nada ajeno).
    const propia = await catalogo.categoriasPorId(actor.tenantId, [id.data]);
    if (propia.length === 0) return apiError("NOT_FOUND", "La categoría no existe.", 404);
    return apiOk({ usos: usosDeCategoria(await repo.listar(actor.tenantId), id.data) });
  });
}
