import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import { manejarMensajeSaliente } from "./outbound-handler";
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

// DuLabs Developer V1 -- Fase 3 (autorizado). Servidor HTTP público del
// Gateway -- POST /api/v1/messages, GET/POST /api/v1/webhooks/meta, y el
// CRUD de gestión bajo /api/v1/dev/*. Mismo patrón node:http crudo que el
// resto del repo (worker/src/server.ts).

export type DependenciasGateway = {
  supabase: SupabaseClient;
  topicOutbound: string;
  topicInbound: string;
  metaAppSecret: string;
  metaVerifyToken: string;
};

function enviarJson(res: ServerResponse, status: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(texto) });
  res.end(texto);
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

export function crearServidorGateway(deps: DependenciasGateway) {
  return createServer(async (req, res) => {
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

      if (path === "/api/v1/messages" && req.method === "POST") {
        const cuerpoCrudo = await leerCuerpo(req);
        let cuerpo: unknown;
        try {
          cuerpo = cuerpoCrudo ? JSON.parse(cuerpoCrudo) : null;
        } catch {
          enviarJson(res, 400, { error: "Cuerpo JSON inválido" });
          return;
        }
        const resultado = await manejarMensajeSaliente(deps, {
          autorizacion: req.headers.authorization,
          idempotencyKey: req.headers["idempotency-key"] as string | undefined,
          cuerpo,
        });
        enviarJson(res, resultado.status, resultado.cuerpo);
        return;
      }

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

      enviarJson(res, 404, { error: "Ruta no encontrada" });
    } catch (err) {
      enviarJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
