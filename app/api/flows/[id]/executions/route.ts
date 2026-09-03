import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById, listExecutionsForFlow } from "@/lib/flow/flow-store";

export const runtime = "nodejs";

// Lista ejecuciones (dulabs_flow_executions) del Flow, aisladas por tenant.
// No modifica ninguna tabla de observabilidad -- solo lectura.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const executions = await listExecutionsForFlow(supabase, { tenantId: miembro.tenantId, flowId: id });
    return Response.json({ executions });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
