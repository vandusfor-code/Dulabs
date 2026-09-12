/**
 * GET /api/flows/[id]/executions/[executionId] — Execution Inspector, detalle
 * (Fase 2, autorizado).
 *
 * Mismo patrón de seguridad EXACTO que el resto de `/api/flows/*`
 * (lib/flow/api-auth.ts): `requireFlowAccess`, tenant_id SIEMPRE derivado
 * server-side, nunca aceptado de body/query/params. 100% de solo lectura --
 * ningún método más que GET existe en este archivo.
 *
 * Trae execution + events + effects + transitions en un número FIJO de
 * queries (ver lib/flow/execution-inspector-store.ts::getExecutionDetailBundle,
 * 4 queries sin importar cuántas filas relacionadas haya -- nunca N+1), y
 * arma la vista de solo lectura con lib/flow/execution-inspector.ts, que
 * sanitiza todo con la MISMA función que ya usa el Orchestrator antes de
 * persistir (sanitizePayloadForObservability) como defensa en profundidad
 * adicional. Nunca toca dulabs_flow_credentials/dulabs_flow_integrations.
 *
 * Aislamiento tenant reforzado: `getExecutionDetailBundle` exige que la
 * ejecución sea del `tenant_id` autenticado Y del `flow_id` de la URL --
 * un execution_id válido de OTRO flow/tenant (aunque adivinado) siempre
 * responde 404, igual que el resto de la API de flows (nunca revela
 * existencia cross-tenant).
 */
import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById, getFlowVersion } from "@/lib/flow/flow-store";
import { getExecutionDetailBundle } from "@/lib/flow/execution-inspector-store";
import { buildExecutionInspectorDetail } from "@/lib/flow/execution-inspector";
import { parseFlowDefinition } from "@/lib/flow/schemas";
import type { FlowDefinition } from "@/lib/flow/types";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> },
) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id: flowId, executionId } = await params;

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, flowId);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const bundle = await getExecutionDetailBundle(supabase, {
      tenantId: miembro.tenantId,
      flowId,
      executionRowId: executionId,
    });
    if (!bundle) return Response.json({ error: "Ejecución no encontrada" }, { status: 404 });

    // La definición se usa SOLO para etiquetar nodos/edges y reconstruir el
    // camino visual -- nunca para decidir nada. Si la versión ya no puede
    // parsearse (no debería pasar, pero es lectura best-effort), el detalle
    // se arma igual sin ella en vez de fallar todo el endpoint.
    let flowDefinition: FlowDefinition | null = null;
    let flowVersionNumber: number | null = null;
    try {
      const version = await getFlowVersion(supabase, miembro.tenantId, bundle.execution.flow_version_id);
      if (version) {
        flowVersionNumber = version.version_number;
        flowDefinition = parseFlowDefinition(version.definition_json);
      }
    } catch {
      // Best-effort -- el detalle de la ejecución sigue siendo válido sin definición.
    }

    const detail = buildExecutionInspectorDetail(bundle, { flow: flowDefinition, flowVersionNumber });
    return Response.json({ execution: detail });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
