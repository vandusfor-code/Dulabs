import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { approveIntegration, getIntegrationById } from "@/lib/flow/flow-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const existente = await getIntegrationById(supabase, miembro.tenantId, id);
    if (!existente) return Response.json({ error: "Integración no encontrada" }, { status: 404 });

    const integration = await approveIntegration(supabase, { tenantId: miembro.tenantId, integrationId: id, approvedBy: miembro.userId });
    return Response.json({ integration });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
