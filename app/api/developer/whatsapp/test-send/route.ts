import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { conSesionDeveloper, jsonOk, jsonError } from "@/lib/developer/dev-api-http";
import { listarNumeros } from "@/lib/developer/whatsapp-numbers-store";
import { crearApiKey, revocarApiKey } from "@/lib/developer/api-keys-store";
import { DEVELOPER_API_BASE_URL } from "@/lib/developers/api-base";

// DuLabs Developer V1 -- "Probar envío de WhatsApp" del Dashboard (autorizado).
// BFF de sesión (NO es un endpoint público; no toca el contrato de Developer
// V1). Reutiliza las piezas existentes y ejecuta EL MISMO POST /api/v1/messages
// del gateway real, resolviendo el whatsappNumberId del número conectado del
// workspace. El usuario solo envía { to, text }.
//
// La API key NUNCA llega al navegador: se acuña una key efímera server-side,
// se usa para autenticar contra el gateway y se REVOCA siempre (finally). El
// resto (validación, ownership, rate-limit, idempotencia, publish a Pub/Sub,
// worker -> Meta) es EXACTAMENTE el camino del gateway -- acá no se duplica.

export const runtime = "nodejs";
export const maxDuration = 30;

const NOMBRE_KEY_EFIMERA = "__dashboard_test_send__";
const TIMEOUT_GATEWAY_MS = 20_000;

export async function POST(request: NextRequest) {
  return conSesionDeveloper(request, ["OWNER", "ADMIN"], async (ctx) => {
    const cuerpo = (await request.json().catch(() => null)) as { to?: string; text?: string } | null;
    const to = typeof cuerpo?.to === "string" ? cuerpo.to.trim() : "";
    const text = typeof cuerpo?.text === "string" ? cuerpo.text : "";
    if (!to) return jsonError(400, "invalid_request", ctx.requestId, "Falta el número de destino.");
    if (!text.trim()) return jsonError(400, "invalid_request", ctx.requestId, "El mensaje no puede estar vacío.");

    // Resolver AUTOMÁTICAMENTE el número conectado (id = whatsappNumberId UUID).
    const numeros = await listarNumeros(ctx.supabase, ctx.workspaceId);
    const conectado = numeros.find((n) => n.estado === "conectado");
    if (!conectado) {
      return jsonError(409, "no_connected_number", ctx.requestId, "No hay un número de WhatsApp conectado en este workspace.");
    }

    // Key efímera server-side (nunca viaja al navegador).
    let apiKeyId: string | null = null;
    let claveEnClaro = "";
    try {
      const creada = await crearApiKey(ctx.supabase, { workspaceId: ctx.workspaceId, name: NOMBRE_KEY_EFIMERA });
      apiKeyId = creada.fila.id;
      claveEnClaro = creada.claveEnClaro;
    } catch {
      // p. ej. ErrorLimiteApiKeys (workspace en el tope de keys activas).
      return jsonError(409, "api_key_unavailable", ctx.requestId, "No se pudo crear una API key temporal (¿alcanzaste el límite de keys activas?). Revoca alguna e intenta de nuevo.");
    }

    const controlador = new AbortController();
    const timeout = setTimeout(() => controlador.abort(), TIMEOUT_GATEWAY_MS);
    try {
      const respuesta = await fetch(`${DEVELOPER_API_BASE_URL}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${claveEnClaro}`,
          "Content-Type": "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({ whatsappNumberId: conectado.id, to, type: "text", text: { body: text } }),
        signal: controlador.signal,
      });

      const texto = await respuesta.text().catch(() => "");
      let data: { jobId?: string; status?: string; error?: { code?: string; message?: string } } = {};
      try {
        data = texto ? JSON.parse(texto) : {};
      } catch {
        data = {};
      }

      if (!respuesta.ok) {
        // Propaga status + código del gateway (sin exponer la key ni detalles internos).
        return jsonError(respuesta.status, data.error?.code ?? "gateway_error", ctx.requestId, data.error?.message);
      }
      return jsonOk({ jobId: data.jobId ?? null, status: data.status ?? "created", to, phoneNumberId: conectado.phone_number_id }, ctx.requestId, 201);
    } catch (err) {
      const esTimeout = err instanceof Error && err.name === "AbortError";
      return jsonError(esTimeout ? 504 : 502, esTimeout ? "gateway_timeout" : "gateway_unreachable", ctx.requestId, "No se pudo contactar la Developer API. Intenta de nuevo.");
    } finally {
      clearTimeout(timeout);
      // La key efímera se revoca SIEMPRE, haya ido bien o mal el envío.
      if (apiKeyId) await revocarApiKey(ctx.supabase, { workspaceId: ctx.workspaceId, apiKeyId }).catch(() => undefined);
    }
  });
}
