import type { NextRequest } from "next/server";
import { requireFlowAccess } from "@/lib/flow/api-auth";
import { getIntegrationById, listCredentialKeys, upsertCredential } from "@/lib/flow/flow-store";

export const runtime = "nodejs";

// SOLO credential_key + timestamps -- NUNCA encrypted_value ni el secreto
// descifrado. lib/flow/flow-store.ts::listCredentialKeys ya excluye esa
// columna en el SELECT, esta ruta no la vuelve a tocar.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  try {
    const existente = await getIntegrationById(supabase, miembro.tenantId, id);
    if (!existente) return Response.json({ error: "Integración no encontrada" }, { status: 404 });

    const credentials = await listCredentialKeys(supabase, { tenantId: miembro.tenantId, integrationId: id });
    return Response.json({ credentials });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}

/**
 * Guarda/rota UN credential_key -- el body recibe el valor en texto plano
 * UNA SOLA VEZ (por HTTPS, mismo camino que cualquier login), se cifra acá
 * mismo (lib/crypto.ts vía upsertCredential, reutilizado sin cambios) y
 * nunca se relee en claro. La respuesta NUNCA incluye `plaintext` ni el
 * valor cifrado -- solo confirma qué credentialKey quedó guardada.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFlowAccess(request, ["admin"]);
  if (!access.ok) return access.response;
  const { supabase, miembro } = access.ctx;
  const { id } = await params;

  let body: { credentialKey?: unknown; plaintext?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }

  if (typeof body.credentialKey !== "string" || !body.credentialKey.trim()) {
    return Response.json({ error: "Falta 'credentialKey'" }, { status: 400 });
  }
  if (typeof body.plaintext !== "string" || !body.plaintext.trim()) {
    return Response.json({ error: "Falta 'plaintext'" }, { status: 400 });
  }

  try {
    const existente = await getIntegrationById(supabase, miembro.tenantId, id);
    if (!existente) return Response.json({ error: "Integración no encontrada" }, { status: 404 });

    await upsertCredential(supabase, {
      tenantId: miembro.tenantId,
      integrationId: id,
      credentialKey: body.credentialKey.trim(),
      plaintext: body.plaintext,
    });
    return Response.json({ credentialKey: body.credentialKey.trim(), saved: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message ?? "Error inesperado" }, { status: 500 });
  }
}
