import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { respuestaSiLimiteTasaExcedido } from "@/lib/rate-limit";
import { obtenerNumeroDelWorkspace } from "@/lib/developer/whatsapp-numbers-store";
import { obtenerWebhookDelNumero, obtenerSecretoWebhookDelNumero } from "@/lib/developer/webhook-config-store";
import { validarUrlWebhookSegura } from "@/lib/developer/ssrf-guard";
import { firmarEvento, HEADER_FIRMA, HEADER_TIMESTAMP, HEADER_EVENT_ID } from "@/lib/developer/webhook-signature";

// DuLabs Developer V1 -- Fase 13 (autorizado, 13.4). Envía un evento de PRUEBA
// firmado al webhook configurado del número, para que el Developer verifique su
// endpoint. OWNER/ADMIN. SSRF guard obligatorio (send-time). Firma con el
// secreto del webhook (nunca se expone). Timeout controlado. No se confía en la
// respuesta (solo se reporta status/latencia). El evento es tipo "webhook.ping"
// (event_id con prefijo ping_) -> NUNCA se confunde con un evento real de Meta,
// y NO se persiste en dulabs_dev_events.

export const runtime = "nodejs";
const TIMEOUT_MS = 5000;

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const limite = await respuestaSiLimiteTasaExcedido(ctx.supabase, { recurso: "dev-webhook-ping", tenantId: ctx.workspaceId, categoria: "costosa" });
    if (limite) return limite;

    const cuerpo = (await request.json().catch(() => null)) as { whatsappNumberId?: string } | null;
    const whatsappNumberId = cuerpo?.whatsappNumberId;
    if (!whatsappNumberId) return jsonError(400, "invalid_request", ctx.requestId, "Falta 'whatsappNumberId'");

    // El número debe pertenecer al workspace autenticado (tenant isolation).
    const numero = await obtenerNumeroDelWorkspace(ctx.supabase, { workspaceId: ctx.workspaceId, numeroId: whatsappNumberId });
    if (!numero) return jsonError(404, "number_not_found", ctx.requestId);

    const webhook = await obtenerWebhookDelNumero(ctx.supabase, { workspaceId: ctx.workspaceId, whatsappNumberId });
    if (!webhook || webhook.estado !== "activo") return jsonError(409, "webhook_no_configurado", ctx.requestId, "No hay un webhook activo para este número.");

    const ssrf = await validarUrlWebhookSegura(webhook.url);
    if (!ssrf.permitido) return jsonError(422, "url_no_permitida", ctx.requestId, ssrf.motivo);

    const secreto = await obtenerSecretoWebhookDelNumero(ctx.supabase, { workspaceId: ctx.workspaceId, whatsappNumberId });
    if (!secreto) return jsonError(409, "secreto_no_disponible", ctx.requestId);

    const eventId = `ping_${randomUUID()}`;
    const cuerpoJson = JSON.stringify({ type: "webhook.ping", event_id: eventId, workspace_id: ctx.workspaceId, sent_at: new Date().toISOString() });
    const { firma, timestamp } = firmarEvento(secreto, cuerpoJson);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const inicio = Date.now();
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [HEADER_FIRMA]: firma, [HEADER_TIMESTAMP]: String(timestamp), [HEADER_EVENT_ID]: eventId },
        body: cuerpoJson,
        signal: controller.signal,
        redirect: "manual", // no seguir redirects (defensa SSRF adicional)
      });
      return jsonOk({ ok: res.ok, status: res.status, latencyMs: Date.now() - inicio, eventId }, ctx.requestId);
    } catch (err) {
      const abortado = err instanceof Error && err.name === "AbortError";
      return jsonOk({ ok: false, status: 0, latencyMs: Date.now() - inicio, eventId, error: abortado ? `timeout tras ${TIMEOUT_MS}ms` : "no se pudo contactar el endpoint" }, ctx.requestId);
    } finally {
      clearTimeout(timer);
    }
  });
}
