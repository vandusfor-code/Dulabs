import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { procesarMensajeOutbound, type DependenciasWorkerOutbound, type MensajePubSubOutbound } from "./handler";

// DuLabs Developer V1 -- Fase 3. Servidor HTTP mínimo que recibe el PUSH de
// Pub/Sub (dulabs-outbound-worker). La autenticación real (rechazar quien
// no sea dulabs-pubsub-invoker@) la hace Cloud Run IAM ANTES de que la
// request llegue acá (el servicio se despliega con
// --no-allow-unauthenticated) -- este código no necesita verificar el JWT
// por su cuenta. Mismo patrón que worker/src/server.ts (node:http crudo,
// sin dependencias nuevas).

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

type EnvoltorioPushPubSub = {
  message?: { data?: string; messageId?: string; attributes?: Record<string, string> };
  subscription?: string;
};

export function crearServidorWorkerOutbound(deps: DependenciasWorkerOutbound) {
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
        // Mensaje irrecuperablemente malformado -- ACK para no quedar en
        // loop de reintentos por algo que reintentar nunca arreglaría.
        enviarJson(res, 200, { procesado: false, motivo: "envoltorio_push_malformado" });
        return;
      }

      const dataB64 = sobre.message?.data;
      if (!dataB64) {
        enviarJson(res, 200, { procesado: false, motivo: "mensaje_push_sin_data" });
        return;
      }

      let mensaje: MensajePubSubOutbound;
      try {
        mensaje = JSON.parse(Buffer.from(dataB64, "base64").toString("utf8"));
      } catch {
        enviarJson(res, 200, { procesado: false, motivo: "payload_interno_malformado" });
        return;
      }

      if (!mensaje.workspaceId || !mensaje.jobId) {
        enviarJson(res, 200, { procesado: false, motivo: "payload_interno_incompleto" });
        return;
      }

      const resultado = await procesarMensajeOutbound(deps, mensaje);
      enviarJson(res, resultado.httpStatus, { procesado: resultado.httpStatus === 200, motivo: resultado.motivo });
    } catch (err) {
      // Error verdaderamente inesperado (no capturado por el handler) --
      // 500 deja que Pub/Sub reintente con su backoff configurado.
      enviarJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}
