import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { duplicateFlow } from "@/lib/flow/flow-store";
import { registrarAuditoriaAdmin } from "@/lib/auditoria-admin";

export const runtime = "nodejs";

// El único constraint único que puede violar el INSERT del Flow nuevo es
// (tenant_id,slug) -- mismo criterio que POST /api/flows.
function esConflictoDeSlug(error: unknown): boolean {
  return (error as { code?: string })?.code === "23505";
}

// Duplica un Flow dentro del mismo tenant (F15.1, Admin Flow Studio) --
// reusa duplicateFlow() de lib/flow/flow-store.ts, sin segunda lógica de
// creación. Disponible tanto para autoría propia como, vía
// allowAdminOverride, para el admin operando sobre el tenant de un cliente.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"], { allowAdminOverride: true });
  if (!access.ok) return access.response;
  const { supabase, miembro, esAdminOverride } = access.ctx;
  const { id } = await params;

  let body: { slug?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const slug = body.slug?.trim();
  const name = body.name?.trim();
  if (!slug) return Response.json({ error: "Falta 'slug'" }, { status: 400 });
  if (!name) return Response.json({ error: "Falta 'name'" }, { status: 400 });

  try {
    const resultado = await duplicateFlow(supabase, {
      tenantId: miembro.tenantId,
      sourceFlowId: id,
      newSlug: slug,
      newName: name,
      createdBy: miembro.userId,
    });
    if (!resultado) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    if (esAdminOverride) {
      await registrarAuditoriaAdmin(supabase, {
        operador: miembro,
        accion: "DUPLICATE_FLOW",
        idTenant: miembro.tenantId,
        recurso: resultado.flow.id,
        metadata: { sourceFlowId: id, slug, name },
      });
    }
    return Response.json({ flow: resultado.flow, version: resultado.version }, { status: 201 });
  } catch (error) {
    if (esConflictoDeSlug(error)) {
      return Response.json({ error: `Ya existe un Flow con el slug "${slug}"` }, { status: 409 });
    }
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
