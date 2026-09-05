import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FabricaSocket } from "./whatsapp-qr/tipos.js";
import { iniciarConexion, obtenerEstadoPublico, desconectar, recuperarSesionesPersistidas } from "./whatsapp-qr/manager.js";
import { enviarPorWhatsAppQR } from "./whatsapp-qr/adaptador.js";
import { claveValida, extraerBearer } from "./auth.js";
import { logInfo, logErrorControlado } from "./logging.js";

// WhatsApp Worker (Fase 9B, autorizado) — interfaz HTTP GENÉRICA entre
// Next.js/Vercel y el worker persistente. Deliberadamente pequeña: 4 rutas,
// todas bajo /tenants/:idTenant/* salvo el healthcheck. Next.js resuelve
// SIEMPRE el idTenant a partir del token antes de llamar acá (ver
// lib/agenda-admin-auth.ts en el repo de Next) -- este servidor confía en
// que el idTenant que recibe ya fue autorizado por ese paso, y solo protege
// el límite real: que la solicitud venga de Next.js y no de cualquiera
// (WHATSAPP_WORKER_SECRET, comparación en tiempo constante).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export type DependenciasServidor = {
  supabase: SupabaseClient;
  fabricaSocket: FabricaSocket;
  secreto: string | undefined;
};

export function crearServidor(deps: DependenciasServidor) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const partes = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && partes.length === 1 && partes[0] === "salud") {
        enviarJson(res, 200, { status: "ok" });
        return;
      }

      // Toda ruta más allá de /salud exige el secreto compartido con Next.js.
      if (!claveValida(extraerBearer(req.headers.authorization), deps.secreto)) {
        enviarJson(res, 401, { error: "No autorizado" });
        return;
      }

      if (partes[0] !== "tenants" || partes.length < 3 || !UUID_RE.test(partes[1])) {
        enviarJson(res, 404, { error: "Ruta no encontrada" });
        return;
      }
      const idTenant = partes[1];
      const accion = partes[2];

      if (accion === "estado" && req.method === "GET") {
        enviarJson(res, 200, await obtenerEstadoPublico(deps.supabase, idTenant));
        return;
      }

      if (accion === "iniciar" && req.method === "POST") {
        // "Vincular con número" (autorizado) -- cuerpo opcional {telefono}.
        // Sin cuerpo o sin telefono, el comportamiento es EXACTO al de
        // siempre (modo QR).
        let telefono: string | undefined;
        const crudo = await leerCuerpo(req);
        if (crudo) {
          try {
            const cuerpo = JSON.parse(crudo) as { telefono?: string };
            telefono = cuerpo.telefono?.trim() || undefined;
          } catch {
            enviarJson(res, 400, { error: "Cuerpo inválido" });
            return;
          }
        }
        enviarJson(res, 200, await iniciarConexion(deps.supabase, idTenant, deps.fabricaSocket, { telefono }));
        return;
      }

      if (accion === "desconectar" && req.method === "POST") {
        enviarJson(res, 200, await desconectar(deps.supabase, idTenant));
        return;
      }

      if (accion === "enviar" && req.method === "POST") {
        let cuerpo: { telefono?: string; mensaje?: string };
        try {
          cuerpo = JSON.parse(await leerCuerpo(req));
        } catch {
          enviarJson(res, 400, { error: "Cuerpo inválido" });
          return;
        }
        if (!cuerpo.telefono || !cuerpo.mensaje) {
          enviarJson(res, 400, { error: "Faltan telefono/mensaje" });
          return;
        }
        try {
          await enviarPorWhatsAppQR(idTenant, cuerpo.telefono, cuerpo.mensaje);
          enviarJson(res, 200, { ok: true });
        } catch {
          logErrorControlado(idTenant, "envio_sin_sesion_activa");
          enviarJson(res, 409, { error: "El tenant no tiene una sesión de WhatsApp QR conectada" });
        }
        return;
      }

      enviarJson(res, 404, { error: "Ruta no encontrada" });
    } catch {
      logErrorControlado("desconocido", "error_no_controlado_en_ruta");
      enviarJson(res, 500, { error: "Error interno" });
    }
  });
}

// Reintenta, en orden, cada sesión que Supabase recuerda como
// conectando/conectada -- ver manager.ts::recuperarSesionesPersistidas.
export async function iniciarServidor(deps: DependenciasServidor, puerto: number) {
  const servidor = crearServidor(deps);
  const { recuperadas } = await recuperarSesionesPersistidas(deps.supabase, deps.fabricaSocket);
  logInfo(`recuperación al iniciar: ${recuperadas} sesión(es) reintentada(s)`);
  await new Promise<void>((resolve) => servidor.listen(puerto, resolve));
  logInfo(`worker escuchando en el puerto ${puerto}`);
  return servidor;
}

const esModuloPrincipal = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (esModuloPrincipal) {
  const { crearFabricaSocketBaileys } = await import("./whatsapp-qr/socket-baileys.js");
  const { supabaseWorker } = await import("./supabase.js");
  const supabase = supabaseWorker();
  const puerto = Number(process.env.PORT ?? 3000);

  const servidor = await iniciarServidor(
    { supabase, fabricaSocket: crearFabricaSocketBaileys(supabase), secreto: process.env.WHATSAPP_WORKER_SECRET },
    puerto
  );

  for (const señal of ["SIGTERM", "SIGINT"] as const) {
    process.on(señal, () => {
      logInfo(`señal ${señal} recibida, cerrando servidor`);
      servidor.close(() => process.exit(0));
    });
  }
}
