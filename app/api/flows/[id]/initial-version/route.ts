import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { ensureInitialFlowVersion, getFlowById } from "@/lib/flow/flow-store";

export const runtime = "nodejs";

// Recuperación para Flows que quedaron sin ninguna versión -- creados antes
// de que POST /api/flows empezara a crear la v1 automáticamente, o si ese
// paso falló a mitad de camino (Flow ya creado, versión no). Reutiliza
// ensureInitialFlowVersion() tal cual (misma función, mismo comportamiento
// idempotente que ya usa POST /api/flows) -- nunca una segunda lógica de
// "primera versión" en paralelo. 201 si creó la v1 ahora, 200 si ya existía.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const result = await ensureInitialFlowVersion(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      flowName: flow.name,
      createdBy: miembro.userId,
    });
    return Response.json({ version: result.version }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
