import type { NextRequest } from "next/server";
import { verificarAccesoAdminDulabs } from "@/lib/admin-tenant";
import { getFlowVersion, listFlows, listFlowTriggers, listFlowVersions } from "@/lib/flow/flow-store";
import { parseFlowDefinition } from "@/lib/flow/schemas";

export const runtime = "nodejs";

/**
 * F15.1 (Admin Flow Studio, autorizado) -- lista TODOS los Flows del tenant
 * `idTenant` con la metadata que pide la sección "Flows" de
 * /admin/clientes/[tenantId]: estado, borrador/publicado, versión,
 * cantidad de nodos, triggers, activo/inactivo (derivado de
 * dulabs_clientes_config, igual que ya hace .../[idTenant]/flow/route.ts).
 * Solo lectura, reutiliza listFlows/listFlowVersions/listFlowTriggers de
 * lib/flow/flow-store.ts tal cual -- ninguna consulta nueva a las tablas
 * base de Flow, ninguna lógica de listado duplicada. La creación/edición/
 * duplicado/publicación de Flows para este tenant se hace vía
 * /api/flows/* con el header x-admin-tenant-id (ver lib/flow/api-auth.ts),
 * nunca acá -- este endpoint es deliberadamente de solo lectura.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ idTenant: string }> }) {
  const acceso = await verificarAccesoAdminDulabs(request);
  if (!acceso.ok) return acceso.response;
  const { idTenant } = await params;
  const supabase = acceso.supabase;

  const flows = await listFlows(supabase, { tenantId: idTenant, limit: 200 });

  const { data: numeros, error: numerosError } = await supabase
    .from("dulabs_clientes_config")
    .select("flow_id")
    .eq("id_tenant", idTenant)
    .eq("flow_activo", true);
  if (numerosError) return Response.json({ error: numerosError.message }, { status: 500 });
  const flowIdsActivos = new Set((numeros ?? []).map((n) => n.flow_id).filter(Boolean));

  const detalle = await Promise.all(
    flows.map(async (flow) => {
      const [ultimaVersion, triggers] = await Promise.all([
        listFlowVersions(supabase, { tenantId: idTenant, flowId: flow.id, limit: 1 }),
        listFlowTriggers(supabase, { tenantId: idTenant, flowId: flow.id }),
      ]);
      const latest = ultimaVersion[0] ?? null;

      let nodeCount = 0;
      if (latest) {
        try {
          nodeCount = parseFlowDefinition(latest.definition_json).nodes.length;
        } catch {
          const rawNodes = (latest.definition_json as { nodes?: unknown[] } | null)?.nodes;
          nodeCount = Array.isArray(rawNodes) ? rawNodes.length : 0;
        }
      }

      let publishedAt: string | null = null;
      if (flow.published_version_id) {
        const publicada =
          latest?.id === flow.published_version_id ? latest : await getFlowVersion(supabase, idTenant, flow.published_version_id);
        publishedAt = publicada?.published_at ?? null;
      }

      return {
        id: flow.id,
        slug: flow.slug,
        name: flow.name,
        status: flow.status,
        activo: flowIdsActivos.has(flow.id),
        tieneVersionDraftSinPublicar: latest !== null && latest.id !== flow.published_version_id,
        versionNumber: latest?.version_number ?? null,
        nodeCount,
        triggerCount: triggers.length,
        updatedAt: flow.updated_at,
        createdAt: flow.created_at,
        publishedAt,
      };
    }),
  );

  return Response.json({ flows: detalle });
}
