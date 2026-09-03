import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getFlowById } from "@/lib/flow/flow-store";
import { validateFlowForPublish } from "@/lib/flow/validate-publish";

export const runtime = "nodejs";

// Usa EXCLUSIVAMENTE validateFlowForPublish() (schema + grafo + reglas de
// publicación + seguridad) -- ninguna regla se reimplementa acá. Siempre
// 200: {valid, errors[]} tal cual lo devuelve esa función, sin severity (no
// existe hoy en FlowValidationError -- ver lib/flow/errors.ts).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  let body: { definition?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!body.definition || typeof body.definition !== "object") {
    return Response.json({ error: "Falta 'definition'" }, { status: 400 });
  }

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }

  const result = validateFlowForPublish(body.definition);
  return Response.json(result);
}
