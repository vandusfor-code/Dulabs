// WhatsApp Worker (Fase 9B, autorizado) — único punto de logging del
// worker. A propósito cada función solo acepta strings de vocabulario fijo
// (nunca un Error, objeto, creds o auth state completo) -- así es
// estructuralmente imposible que un stack trace o una credencial termine en
// los logs por esta vía. Ver src/server.test.ts, prueba 13.

type EstadoLog = "desconectado" | "conectando" | "conectado";

const ESTADO_EN_INGLES: Record<EstadoLog, string> = {
  desconectado: "disconnected",
  conectando: "connecting",
  conectado: "connected",
};

export function logEstado(idTenant: string, estado: EstadoLog): void {
  console.log(`[whatsapp-worker] tenant=${idTenant} estado=${ESTADO_EN_INGLES[estado]}`);
}

export function logInfo(mensaje: string): void {
  console.log(`[whatsapp-worker] ${mensaje}`);
}

/** contexto es SIEMPRE una etiqueta fija elegida por el llamador (ej. "fabrica_socket_fallo"), nunca err.message ni err mismo. */
export function logErrorControlado(idTenant: string, contexto: string): void {
  console.error(`[whatsapp-worker] tenant=${idTenant} error=${contexto}`);
}
