import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { archiveFlow, getFlowById, updateFlow } from "@/lib/flow/flow-store";

export const runtime = "nodejs";

const CAMPOS_PROHIBIDOS_EN_PATCH = [
  "status",
  "published_version_id",
  "tenant_id",
  "created_by",
  "versions",
  "definition",
] as const;

function esConflictoDeSlug(error: unknown): boolean {
  return (error as { code?: string })?.code === "23505";
}

/** ¿Hay al menos un cliente con este Flow activo? (dulabs_clientes_config.flow_activo=true, flow_id=flowId) */
async function tieneClienteActivo(
  supabase: SupabaseClient,
  tenantId: string,
  flowId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("dulabs_clientes_config")
    .select("id", { count: "exact", head: true })
    .eq("id_tenant", tenantId)
    .eq("flow_id", flowId)
    .eq("flow_activo", true);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });
    return Response.json({ flow });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

// Solo metadata: name/description/slug. status y published_version_id NUNCA
// se tocan acá -- cambian únicamente vía publishFlowVersion()/archiveFlow().
// La definición del Flow tampoco: eso se hace creando una versión nueva.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const camposProhibidosPresentes = CAMPOS_PROHIBIDOS_EN_PATCH.filter((campo) => campo in body);
  if (camposProhibidosPresentes.length > 0) {
    return Response.json(
      {
        error: `PATCH solo permite editar metadata (name, description, slug). Campo(s) no permitido(s): ${camposProhibidosPresentes.join(", ")}. El status y la definición cambian mediante publish/versions.`,
      },
      { status: 400 },
    );
  }

  const { name, description, slug } = body as { name?: unknown; description?: unknown; slug?: unknown };
  if (name !== undefined && typeof name !== "string") {
    return Response.json({ error: "'name' debe ser texto" }, { status: 400 });
  }
  if (description !== undefined && typeof description !== "string") {
    return Response.json({ error: "'description' debe ser texto" }, { status: 400 });
  }
  if (slug !== undefined && typeof slug !== "string") {
    return Response.json({ error: "'slug' debe ser texto" }, { status: 400 });
  }
  if (name === undefined && description === undefined && slug === undefined) {
    return Response.json({ error: "Nada para actualizar -- envía al menos name, description o slug" }, { status: 400 });
  }

  try {
    const flow = await updateFlow(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      name: name as string | undefined,
      description: description as string | undefined,
      slug: slug as string | undefined,
    });
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });
    return Response.json({ flow });
  } catch (error) {
    if (esConflictoDeSlug(error)) {
      return Response.json({ error: `Ya existe un Flow con el slug "${slug as string}"` }, { status: 409 });
    }
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

// "Eliminar" = archivar (status="archived"), nunca DELETE físico -- ver
// docstring de archiveFlow() en flow-store.ts. Bloqueado si algún cliente
// tiene este Flow activo (dulabs_clientes_config.flow_activo=true) -- no se
// toca esa fila, solo se rechaza el archivado.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const existente = await getFlowById(supabase, miembro.tenantId, id);
    if (!existente) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const activo = await tieneClienteActivo(supabase, miembro.tenantId, id);
    if (activo) {
      return Response.json(
        { error: "No se puede archivar este Flow porque está activo para uno o más clientes." },
        { status: 409 },
      );
    }

    const flow = await archiveFlow(supabase, { tenantId: miembro.tenantId, flowId: id });
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });
    return Response.json({ flow });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
