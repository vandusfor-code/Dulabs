import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { procesarMensajeInbound, type DependenciasWorkerInbound, type MensajePubSubInbound } from "./handler";

// DuLabs Developer V1 -- Fase 3. Servidor HTTP mínimo que recibe el PUSH de
// Pub/Sub (dulabs-inbound-worker). Autenticación real vía Cloud Run IAM
// (--no-allow-unauthenticated), no en este código -- mismo criterio que
// services/worker-outbound/server.ts.

function enviarJson(res: ServerResponse, status: number, cuerpo: unknown): void {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(texto) });
  res.end(texto);
}

async function leerCuerpo(req: IncomingMessage): Promise<string> {
  const trozos: Buffer[] = [];
  for await (const trozo of req) trozos.push(trozo as Buffer);
  return Buffer.concat(trozos).toString("utf8");
}

type EnvoltorioPushPubSub = { message?: { data?: string }; subscription?: string };

export function crearServidorWorkerInbound(deps: DependenciasWorkerInbound) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (req.method === "GET" && url.pathname === "/salud") {
        enviarJson(res, 200, { status: "ok" });
        return;
      }

      if (req.method !== "POST" || url.pathname !== "/push") {
        enviarJson(res, 404, { error: "Ruta no encontrada" });
        return;
      }

      const cuerpoCrudo = await leerCuerpo(req);
      let sobre: EnvoltorioPushPubSub;
      try {
        sobre = JSON.parse(cuerpoCrudo);
      } catch {
        enviarJson(res, 200, { procesado: false, motivo: "envoltorio_push_malformado" });
        return;
      }

      const dataB64 = sobre.message?.data;
      if (!dataB64) {
        enviarJson(res, 200, { procesado: false, motivo: "mensaje_push_sin_data" });
        return;
      }

      let mensaje: MensajePubSubInbound;
      try {
        mensaje = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
      } catch {
        enviarJson(res, 200, { procesado: false, motivo: "payload_interno_malformado" });
        return;
      }

      if (typeof mensaje.eventoId !== "number") {
        enviarJson(res, 200, { procesado: false, motivo: "payload_interno_incompleto" });
        return;
      }

      const resultado = await procesarMensajeInbound(deps, mensaje);
      enviarJson(res, resultado.httpStatus, { procesado: resultado.httpStatus === 200, motivo: resultado.motivo });
    } catch (err) {
      enviarJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
