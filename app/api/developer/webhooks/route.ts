import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { listarWebhooksDelWorkspace, configurarWebhook } from "@/lib/developer/webhook-config-store";
import { obtenerNumeroDelWorkspace } from "@/lib/developer/whatsapp-numbers-store";

// DuLabs Developer V1 -- Fase 9 (autorizado). GET (listar, cualquier rol) /
// POST (configurar, OWNER o ADMIN). El secreto del webhook se genera
// server-side y se devuelve UNA sola vez en el POST; el listado NUNCA lo
// expone (listarWebhooksDelWorkspace no proyecta secret_cifrado).

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN", "MEMBER"], async (ctx) => {
    const filas = await listarWebhooksDelWorkspace(ctx.supabase, ctx.workspaceId);
    const webhooks = filas.map((w) => ({
      id: w.id,
      whatsappNumberId: w.whatsapp_number_id,
      url: w.url,
      status: w.estado,
      createdAt: w.created_at,
      rotatedAt: w.rotated_at,
    }));
    return jsonOk({ webhooks }, ctx.requestId);
  });
}

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { whatsappNumberId?: string; url?: string } | null;
    if (!cuerpo?.whatsappNumberId || !cuerpo.url) return jsonError(400, "invalid_request", ctx.requestId, "Faltan 'whatsappNumberId' y/o 'url'");

    // Ownership real del número ANTES de tocar la tabla de webhooks (mismo
    // criterio de seguridad que la superficie de sesión del Gateway).
    const numero = await obtenerNumeroDelWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, numeroId: cuerpo.whatsappNumberId });
    if (!numero) return jsonError(404, "whatsapp_number_not_found", ctx.requestId);

    const resultado = await configurarWebhook(ctx.supabase, { workspaceId: ctx.workspaceId, whatsappNumberId: cuerpo.whatsappNumberId, url: cuerpo.url });
    if (!resultado.ok) return jsonError(400, resultado.motivo, ctx.requestId, resultado.detalle);
    // secret: UNA sola vez, igual que una API key.
    return jsonOk(
      { id: resultado.fila.id, whatsappNumberId: resultado.fila.whatsapp_number_id, url: resultado.fila.url, status: resultado.fila.estado, createdAt: resultado.fila.created_at, secret: resultado.secreto },
      ctx.requestId,
      201
    );
  });
}
