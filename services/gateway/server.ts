import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { manejarMensajeSaliente, manejarObtenerMensaje } from "./outbound-handler";
import { manejarVerificacionMeta, manejarWebhookMeta } from "./inbound-handler";
import {
  conWorkspaceAutenticado,
  manejarCrearApiKey,
  manejarListarApiKeys,
  manejarRevocarApiKey,
  manejarRegistrarNumero,
  manejarListarNumeros,
  manejarConfigurarWebhook,
} from "./management-handler";
import { manejarListaNumerosPublica, manejarObtenerNumeroPublico } from "./numbers-handler";
import { manejarObtenerUso } from "./usage-handler";
import { manejarObtenerMe } from "./me-handler";
import { manejarListaWebhooksPublica, manejarConfigurarWebhookPublico } from "./webhooks-handler";
import { generarRequestId } from "../shared/request-id";
import { errorApi, type RespuestaApi } from "./errors";
import { pareceUuid } from "./validation";

// DuLabs Developer V1 -- Fase 3 (autorizado). Servidor HTTP público del
// Gateway. Fase 4 (autorizado) extiende las rutas -- POST /api/v1/messages,
// GET/POST /api/v1/webhooks/meta, y el CRUD de gestión bajo /api/v1/dev/*
// siguen exactamente igual; se agregan las rutas nuevas de la Developer
// API pública autenticada por API key.

export type DependenciasGateway = {
  supabase: SupabaseClient;
  topicOutbound: string;
  topicInbound: string;
  metaAppSecret: string;
  metaVerifyToken: string;
};

function enviarJson(res: ServerResponse, status: number, cuerpo: unknown, headers?: Record<string, string>): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(texto), ...headers });
  res.end(texto);
}

function enviarRespuestaApi(res: ServerResponse, r: RespuestaApi): void {
  enviarJson(res, r.status, r.cuerpo, r.headers);
}

function enviarTexto(res: ServerResponse, status: number, texto: string): void {
  res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": Buffer.byteLength(texto) });
  res.end(texto);
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const trozo of req) trozos.push(trozo as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

/** IP real del cliente -- Cloud Run está detrás del balanceador de Google, que agrega X-Forwarded-For real; se usa la primera IP de esa cadena (el cliente original), con fallback al socket para entornos locales/tests. */
function ipRemota(req: IncomingMessage): string | undefined {
  const header = req.headers["x-forwarded-for"];
  const valor = Array.isArray(header) ? header[0] : header;
  if (valor) return valor.split(",")[0].trim();
  return req.socket.remoteAddress ?? undefined;
}

export function crearServidorGateway(deps: DependenciasGateway) {
  return createServer(async (req, res) => {
    const requestId = generarRequestId();
    const ip = ipRemota(req);

    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;

      if (req.method === "GET" && path === "/salud") {
        enviarJson(res, 200, { status: "ok" });
        return;
      }

      if (path === "/api/v1/webhooks/meta" && req.method === "GET") {
        const resultado = manejarVerificacionMeta(deps, {
          hubMode: url.searchParams.get("hub.mode") ?? undefined,
          hubVerifyToken: url.searchParams.get("hub.verify_token") ?? undefined,
          hubChallenge: url.searchParams.get("hub.challenge") ?? undefined,
        });
        enviarTexto(res, resultado.status, resultado.cuerpo);
        return;
      }

      if (path === "/api/v1/webhooks/meta" && req.method === "POST") {
        const cuerpoCrudo = await leerCuerpo(req);
        const resultado = await manejarWebhookMeta(deps, { firmaHeader: req.headers["x-hub-signature-256"] as string | undefined, cuerpoCrudo });
        enviarJson(res, resultado.status, resultado.cuerpo);
        return;
      }

      // ============================================================
      // Developer API pública (Fase 3 + Fase 4) -- todas autenticadas por
      // API key, todas devuelven X-Request-Id y el modelo de error
      // uniforme (services/gateway/errors.ts).
      // ============================================================

      if (path === "/api/v1/messages" && req.method === "POST") {
        const cuerpoCrudo = await leerCuerpo(req);
        let cuerpo: unknown;
        try {
          cuerpo = cuerpoCrudo ? JSON.parse(cuerpoCrudo) : null;
        } catch {
          enviarRespuestaApi(res, errorApi(400, "invalid_request", "Cuerpo JSON inválido", requestId));
          return;
        }
        const resultado = await manejarMensajeSaliente(deps, {
          autorizacion: req.headers.authorization,
          idempotencyKey: req.headers["idempotency-key"] as string | undefined,
          cuerpo,
          requestId,
          ipRemota: ip,
        });
        enviarRespuestaApi(res, resultado);
        return;
      }

      if (path.startsWith("/api/v1/messages/") && req.method === "GET") {
        const jobId = path.split("/")[4];
        if (!jobId || !pareceUuid(jobId)) {
          enviarRespuestaApi(res, errorApi(404, "not_found", "Mensaje no encontrado", requestId));
          return;
        }
        const resultado = await manejarObtenerMensaje(deps, { autorizacion: req.headers.authorization, jobId, requestId, ipRemota: ip });
        enviarRespuestaApi(res, resultado);
        return;
      }

      if (path === "/api/v1/whatsapp-numbers" && req.method === "GET") {
        const resultado = await manejarListaNumerosPublica(deps, { autorizacion: req.headers.authorization, requestId, ipRemota: ip });
        enviarRespuestaApi(res, resultado);
        return;
      }

      if (path.startsWith("/api/v1/whatsapp-numbers/") && req.method === "GET") {
        const numeroId = path.split("/")[4];
        if (!numeroId || !pareceUuid(numeroId)) {
          enviarRespuestaApi(res, errorApi(404, "not_found", "Número no encontrado", requestId));
          return;
        }
        const resultado = await manejarObtenerNumeroPublico(deps, { autorizacion: req.headers.authorization, numeroId, requestId, ipRemota: ip });
        enviarRespuestaApi(res, resultado);
        return;
      }

      if (path === "/api/v1/usage" && req.method === "GET") {
        const resultado = await manejarObtenerUso(deps, {
          autorizacion: req.headers.authorization,
          desde: url.searchParams.get("from") ?? undefined,
          hasta: url.searchParams.get("to") ?? undefined,
          requestId,
          ipRemota: ip,
        });
        enviarRespuestaApi(res, resultado);
        return;
      }

      if (path === "/api/v1/me" && req.method === "GET") {
        const resultado = await manejarObtenerMe(deps, { autorizacion: req.headers.authorization, requestId, ipRemota: ip });
        enviarRespuestaApi(res, resultado);
        return;
      }

      if (path === "/api/v1/webhooks" && req.method === "GET") {
        const resultado = await manejarListaWebhooksPublica(deps, { autorizacion: req.headers.authorization, requestId, ipRemota: ip });
        enviarRespuestaApi(res, resultado);
        return;
      }

      if (path === "/api/v1/webhooks" && req.method === "POST") {
        const cuerpoCrudo = await leerCuerpo(req);
        let cuerpo: unknown;
        try {
          cuerpo = cuerpoCrudo ? JSON.parse(cuerpoCrudo) : null;
        } catch {
          enviarRespuestaApi(res, errorApi(400, "invalid_request", "Cuerpo JSON inválido", requestId));
          return;
        }
        const resultado = await manejarConfigurarWebhookPublico(deps, { autorizacion: req.headers.authorization, cuerpo, requestId, ipRemota: ip });
        enviarRespuestaApi(res, resultado);
        return;
      }

      // ============================================================
      // /api/v1/dev/* -- sesión de Supabase Auth, SIN CAMBIOS de Fase 4.
      // ============================================================

      if (path.startsWith("/api/v1/dev/")) {
        const cuerpoCrudo = req.method !== "GET" && req.method !== "DELETE" ? await leerCuerpo(req) : "";
        let cuerpo: unknown = null;
        if (cuerpoCrudo) {
          try {
            cuerpo = JSON.parse(cuerpoCrudo);
          } catch {
            enviarJson(res, 400, { error: "Cuerpo JSON inválido" });
            return;
          }
        }

        const partes = path.split("/").filter(Boolean); // ["api","v1","dev","api-keys", ...]
        const recurso = partes[3];
        const idRecurso = partes[4];

        if (recurso === "api-keys" && req.method === "POST") {
          const r = await conWorkspaceAutenticado(deps, req.headers.authorization, (ws) => manejarCrearApiKey(deps, ws, cuerpo));
          enviarJson(res, r.status, r.cuerpo);
          return;
        }
        if (recurso === "api-keys" && req.method === "GET") {
          const r = await conWorkspaceAutenticado(deps, req.headers.authorization, (ws) => manejarListarApiKeys(deps, ws));
          enviarJson(res, r.status, r.cuerpo);
          return;
        }
        if (recurso === "api-keys" && req.method === "DELETE" && idRecurso) {
          const r = await conWorkspaceAutenticado(deps, req.headers.authorization, (ws) => manejarRevocarApiKey(deps, ws, idRecurso));
          enviarJson(res, r.status, r.cuerpo);
          return;
        }
        if (recurso === "numbers" && req.method === "POST") {
          const r = await conWorkspaceAutenticado(deps, req.headers.authorization, (ws) => manejarRegistrarNumero(deps, ws, cuerpo));
          enviarJson(res, r.status, r.cuerpo);
          return;
        }
        if (recurso === "numbers" && req.method === "GET") {
          const r = await conWorkspaceAutenticado(deps, req.headers.authorization, (ws) => manejarListarNumeros(deps, ws));
          enviarJson(res, r.status, r.cuerpo);
          return;
        }
        if (recurso === "webhooks" && req.method === "POST") {
          const r = await conWorkspaceAutenticado(deps, req.headers.authorization, (ws) => manejarConfigurarWebhook(deps, ws, cuerpo));
          enviarJson(res, r.status, r.cuerpo);
          return;
        }

        enviarJson(res, 404, { error: "Ruta de gestión no encontrada" });
        return;
      }

      enviarRespuestaApi(res, errorApi(404, "not_found", "Ruta no encontrada", requestId));
    } catch (err) {
      enviarRespuestaApi(res, errorApi(500, "internal_error", "Error interno", requestId));
      // Nunca se filtra err.message al cliente -- se deja que Cloud
      // Logging capture el error real vía la excepción no capturada de
      // más abajo si hiciera falta depurar (mismo criterio ya usado en
      // los Workers: nunca detalle de infraestructura en la respuesta).
      console.error(`[gateway] error interno (request_id=${requestId}):`, err instanceof Error ? err.message : String(err));
    }
  });
}
