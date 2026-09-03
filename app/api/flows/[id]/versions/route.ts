import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createFlowVersion, getFlowById, listFlowVersions } from "@/lib/flow/flow-store";
import { FlowEmbeddedSecretsError } from "@/lib/flow/flow-store-errors";
import type { FlowDefinition } from "@/lib/flow/types";

export const runtime = "nodejs";

function esConflictoDeVersionNumber(error: unknown): boolean {
  return (error as { code?: string })?.code === "23505";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    const versions = await listFlowVersions(supabase, { tenantId: miembro.tenantId, flowId: id });
    return Response.json({ versions });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

// Crea una versión nueva a partir de `definition`. versionNumber es opcional:
// si no se envía, se calcula como (versión más alta existente + 1) -- si se
// envía explícito, se usa tal cual (el constraint único de la tabla lo
// valida de todas formas). publish=true dispara publishFlowVersion() por
// dentro de createFlowVersion() -- es el ÚNICO mecanismo ya existente para
// "crear y publicar en un solo paso"; sin ese flag, la versión queda como
// borrador (nunca se publica automáticamente).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  let body: { definition?: unknown; versionNumber?: unknown; publish?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (!body.definition || typeof body.definition !== "object") {
    return Response.json({ error: "Falta 'definition'" }, { status: 400 });
  }
  if (body.versionNumber !== undefined && typeof body.versionNumber !== "number") {
    return Response.json({ error: "'versionNumber' debe ser numérico" }, { status: 400 });
  }

  try {
    const flow = await getFlowById(supabase, miembro.tenantId, id);
    if (!flow) return Response.json({ error: "Flow no encontrado" }, { status: 404 });

    let versionNumber = body.versionNumber as number | undefined;
    if (versionNumber === undefined) {
      const existentes = await listFlowVersions(supabase, { tenantId: miembro.tenantId, flowId: id, limit: 1 });
      versionNumber = (existentes[0]?.version_number ?? 0) + 1;
    }

    const version = await createFlowVersion(supabase, {
      tenantId: miembro.tenantId,
      flowId: id,
      versionNumber,
      definition: body.definition as FlowDefinition,
      createdBy: miembro.userId,
      publish: body.publish === true,
    });
    return Response.json({ version }, { status: 201 });
  } catch (error) {
    if (error instanceof FlowEmbeddedSecretsError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (esConflictoDeVersionNumber(error)) {
      return Response.json({ error: "Ya existe una versión con ese número para este Flow" }, { status: 409 });
    }
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
