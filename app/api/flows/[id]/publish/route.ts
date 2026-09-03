import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById, publishFlowVersion } from "@/lib/flow/flow-store";
import { FLOW_STORE_ERROR_CODES, FlowStoreError } from "@/lib/flow/flow-store-errors";

export const runtime = "nodejs";

// Reutiliza publishFlowVersion() -- la RPC atómica dulabs_flow_publish_version
// existente, sin segunda lógica de publicación. No valida antes de publicar
// (eso es responsabilidad explícita de POST /validate, que el cliente debe
// llamar antes) -- la RPC en sí ya rechaza version_id inexistente o de otro
// tenant/flow, es la misma garantía que ya tenía el runtime.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  let body: { versionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.versionId || typeof body.versionId !== "string") {
    return Response.json({ error: "Falta 'versionId'" }, { status: 400 });
  }

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    await publishFlowVersion(supabase, miembro.tenantId, id, body.versionId);

    const actualizado = await getFlowById(supabase, miembro.tenantId, id);
    return Response.json({ flow: actualizado });
  } catch (error) {
    if (error instanceof FlowStoreError) {
      if (
        error.code === FLOW_STORE_ERROR_CODES.PUBLISH_VERSION_NOT_FOUND ||
        error.code === FLOW_STORE_ERROR_CODES.PUBLISH_TENANT_MISMATCH
      ) {
        // No distinguir "no existe" de "es de otro tenant/flow" -- mismo
        // criterio de no revelar existencia cross-tenant que el resto de la API.
        return Response.json({ error: "Versión no encontrada" }, { status: 404 });
      }
    }
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
