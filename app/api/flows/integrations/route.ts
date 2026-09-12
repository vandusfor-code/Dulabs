import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { createIntegration, listIntegrations } from "@/lib/flow/flow-store";
import { validateWebhookUrl } from "@/lib/flow/validate-security";

export const runtime = "nodejs";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH"] as const;

/**
 * Fase 5 (Actions + Integrations, autorizado). Lista/crea integraciones
 * DEL TENANT AUTENTICADO -- tenantId SIEMPRE sale de miembro.tenantId
 * (requireFlowAccess), nunca del body. Nunca devuelve credenciales (esta
 * ruta ni siquiera toca dulabs_flow_credentials).
 */
export async function GET(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin", "agente"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  try {
    const integrations = await listIntegrations(supabase, { tenantId: miembro.tenantId });
    return Response.json({ integrations });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

// Se crea SIEMPRE en status="pending" -- aprobar es un paso explícito
// separado (POST /api/flows/integrations/[id]/approve), nunca implícito en
// la creación, para que quede un registro de quién aprobó y cuándo.
export async function POST(request: NextRequest) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  const { slug, displayName, description, capability, url, httpMethod, headersTemplate, criticality } = body as {
    slug?: unknown;
    displayName?: unknown;
    description?: unknown;
    capability?: unknown;
    url?: unknown;
    httpMethod?: unknown;
    headersTemplate?: unknown;
    criticality?: unknown;
  };

  if (typeof slug !== "string" || !slug.trim()) return Response.json({ error: "Falta 'slug'" }, { status: 400 });
  if (typeof displayName !== "string" || !displayName.trim()) return Response.json({ error: "Falta 'displayName'" }, { status: 400 });
  if (typeof capability !== "string" || !capability.trim()) return Response.json({ error: "Falta 'capability'" }, { status: 400 });
  if (typeof url !== "string" || !url.trim()) return Response.json({ error: "Falta 'url'" }, { status: 400 });

  // Reutiliza OBLIGATORIAMENTE la misma validación SSRF que ya protege la
  // publicación de Flows (HTTPS + no localhost/IP privada) -- nunca una
  // segunda implementación.
  const ssrfError = validateWebhookUrl(url);
  if (ssrfError) return Response.json({ error: ssrfError }, { status: 400 });

  if (httpMethod !== undefined && !HTTP_METHODS.includes(httpMethod as (typeof HTTP_METHODS)[number])) {
    return Response.json({ error: `httpMethod debe ser uno de: ${HTTP_METHODS.join(", ")}` }, { status: 400 });
  }
  if (headersTemplate !== undefined && (typeof headersTemplate !== "object" || headersTemplate === null || Array.isArray(headersTemplate))) {
    return Response.json({ error: "headersTemplate debe ser un objeto de headers" }, { status: 400 });
  }

  try {
    const integration = await createIntegration(supabase, {
      tenantId: miembro.tenantId,
      slug: slug.trim(),
      displayName: displayName.trim(),
      description: typeof description === "string" ? description : undefined,
      capability: capability.trim(),
      url,
      httpMethod: httpMethod as string | undefined,
      headersTemplate: headersTemplate as Record<string, string> | undefined,
      criticality: typeof criticality === "string" ? criticality : undefined,
      createdBy: miembro.userId,
    });
    return Response.json({ integration }, { status: 201 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return Response.json({ error: `Ya existe una integración con el slug "${slug}"` }, { status: 409 });
    }
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
