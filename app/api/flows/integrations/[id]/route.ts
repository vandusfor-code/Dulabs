import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getIntegrationById, updateIntegration } from "@/lib/flow/flow-store";
import { validateWebhookUrl } from "@/lib/flow/validate-security";

export const runtime = "nodejs";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH"] as const;

// GET /api/flows/integrations/[id] -- "configuración segura sin exponer
// secretos": FlowIntegrationRow nunca tiene columnas de credenciales
// (viven en dulabs_flow_credentials, tabla separada, nunca leída acá).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const integration = await getIntegrationById(supabase, miembro.tenantId, id);
    if (!integration) return Response.json({ error: "Integración no encontrada" }, { status: 404 });
    return Response.json({ integration });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

// Metadata editable: nunca status/tenant_id/created_by -- status cambia
// exclusivamente vía /approve o /revoke.
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

  const camposProhibidos = ["status", "tenant_id", "created_by", "approved_by", "approved_at", "capability", "slug"].filter((c) => c in body);
  if (camposProhibidos.length > 0) {
    return Response.json({ error: `Campo(s) no permitido(s) en PATCH: ${camposProhibidos.join(", ")}` }, { status: 400 });
  }

  const { displayName, description, url, httpMethod, headersTemplate } = body as {
    displayName?: unknown;
    description?: unknown;
    url?: unknown;
    httpMethod?: unknown;
    headersTemplate?: unknown;
  };

  if (displayName !== undefined && typeof displayName !== "string") return Response.json({ error: "'displayName' debe ser texto" }, { status: 400 });
  if (description !== undefined && typeof description !== "string") return Response.json({ error: "'description' debe ser texto" }, { status: 400 });
  if (url !== undefined) {
    if (typeof url !== "string") return Response.json({ error: "'url' debe ser texto" }, { status: 400 });
    const ssrfError = validateWebhookUrl(url);
    if (ssrfError) return Response.json({ error: ssrfError }, { status: 400 });
  }
  if (httpMethod !== undefined && !HTTP_METHODS.includes(httpMethod as (typeof HTTP_METHODS)[number])) {
    return Response.json({ error: `httpMethod debe ser uno de: ${HTTP_METHODS.join(", ")}` }, { status: 400 });
  }
  if (headersTemplate !== undefined && (typeof headersTemplate !== "object" || headersTemplate === null || Array.isArray(headersTemplate))) {
    return Response.json({ error: "headersTemplate debe ser un objeto de headers" }, { status: 400 });
  }

  try {
    const existente = await getIntegrationById(supabase, miembro.tenantId, id);
    if (!existente) return Response.json({ error: "Integración no encontrada" }, { status: 404 });

    const integration = await updateIntegration(supabase, {
      tenantId: miembro.tenantId,
      integrationId: id,
      displayName: displayName as string | undefined,
      description: description as string | undefined,
      url: url as string | undefined,
      httpMethod: httpMethod as string | undefined,
      headersTemplate: headersTemplate as Record<string, string> | undefined,
    });
    return Response.json({ integration });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
