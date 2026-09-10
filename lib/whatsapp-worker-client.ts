import type { NextRequest } from "next/server";

// WhatsApp Worker (Fase 9B, autorizado) — único punto por el que Next.js
// habla con el worker persistente que sostiene las sesiones Baileys (ver
// worker/). Las 3 rutas de app/api/agenda/[token]/whatsapp-qr/* son
// deliberadamente delgadas: resuelven el tenant desde el token (como
// siempre) y delegan la operación real acá. El navegador nunca ve
// WHATSAPP_WORKER_URL/SECRET -- esta llamada ocurre server-side, dentro del
// handler de la ruta.
export type RespuestaWorker<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** WhatsApp multi-cuenta (autorizado) -- hasta 2 cuentas independientes por tenant. 1 = "WhatsApp principal" (única que usa el bot/Flow Engine/recordatorios/cumpleaños/fidelización). 2 = cuenta adicional, solo atención manual desde Chats. */
export type SlotWhatsApp = 1 | 2;

/**
 * WhatsApp multi-cuenta (autorizado) -- mismo contrato que
 * worker/src/server.ts::resolverSlot: `?slot=1|2` opcional en la query
 * string de la request de Next.js (default 1, comportamiento de siempre
 * para toda ruta que nunca lo reciba). Cualquier otro valor se rechaza acá
 * mismo, en Next.js -- nunca se depende solo de que el frontend nunca pida
 * un 3er slot; el worker rechaza igual del otro lado (segunda barrera).
 */
export function resolverSlotDesdeQuery(request: NextRequest): SlotWhatsApp | null {
  const crudo = new URL(request.url).searchParams.get("slot");
  if (crudo === null) return 1;
  if (crudo === "1") return 1;
  if (crudo === "2") return 2;
  return null;
}

async function llamarWorker<T>(
  idTenant: string,
  ruta: string,
  method: "GET" | "POST",
  cuerpoEnviado?: Record<string, unknown>,
  slot: SlotWhatsApp = 1
): Promise<RespuestaWorker<T>> {
  const baseUrl = process.env.WHATSAPP_WORKER_URL;
  const secreto = process.env.WHATSAPP_WORKER_SECRET;
  if (!baseUrl || !secreto) {
    return { ok: false, status: 503, error: "El worker de WhatsApp no está configurado" };
  }

  try {
    const res = await fetch(`${baseUrl}/tenants/${idTenant}/${ruta}?slot=${slot}`, {
      method,
      headers: { Authorization: `Bearer ${secreto}`, ...(cuerpoEnviado ? { "Content-Type": "application/json" } : {}) },
      ...(cuerpoEnviado ? { body: JSON.stringify(cuerpoEnviado) } : {}),
    });
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) {
      return { ok: false, status: res.status, error: body?.error ?? "El worker de WhatsApp respondió con error" };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 502, error: "No se pudo contactar al worker de WhatsApp" };
  }
}

export type EstadoWorker = {
  idTenant: string;
  slot: SlotWhatsApp;
  estado: "desconectado" | "conectando" | "conectado";
  numeroConectado: string | null;
  conectadoEn: string | null;
  qr: string | null;
  /** Código de 8 caracteres para "Vincular con número de teléfono" -- alternativa real al QR, mutuamente excluyente con `qr`. */
  codigoVinculacion: string | null;
};

/** `slot` (WhatsApp multi-cuenta, autorizado) -- por defecto 1 ("WhatsApp principal"), EXACTO comportamiento de siempre para todo llamador que nunca lo pase. */
export function consultarEstadoWorker(idTenant: string, slot: SlotWhatsApp = 1) {
  return llamarWorker<EstadoWorker>(idTenant, "estado", "GET", undefined, slot);
}

/** `telefono` (opcional, solo dígitos con indicativo de país) pide el modo "vincular con número" en vez de QR. `slot` -- ver consultarEstadoWorker. */
export function iniciarConexionWorker(idTenant: string, opciones?: { telefono?: string; slot?: SlotWhatsApp }) {
  return llamarWorker<EstadoWorker>(
    idTenant,
    "iniciar",
    "POST",
    opciones?.telefono ? { telefono: opciones.telefono } : undefined,
    opciones?.slot ?? 1
  );
}

export function desconectarWorker(idTenant: string, slot: SlotWhatsApp = 1) {
  return llamarWorker<EstadoWorker>(idTenant, "desconectar", "POST", undefined, slot);
}

// Fase L (canal de salida unificado, autorizado) — ÚNICO punto de envío
// real de WhatsApp para cualquier tenant conectado por QR (cumpleaños,
// fidelización, confirmaciones, recordatorios, Flow Engine deberían llamar
// esta función en vez de reimplementar su propio cliente de envío).
// Requiere que el tenant tenga una sesión CONECTADA en el worker -- si no,
// el worker mismo responde 409 y esto lo traduce a un resultado controlado,
// nunca lanza una excepción no atrapada. `slot` (WhatsApp multi-cuenta,
// autorizado) por defecto es 1 -- todo llamador existente (recordatorios,
// cumpleaños, bot) sigue exactamente el mismo camino de siempre.
export async function enviarMensajeWhatsApp(params: {
  tenantId: string;
  telefono: string;
  mensaje: string;
  /** Bot real (autorizado) — marca este envío como generado por el Flow Engine (ver lib/whatsapp-qr-bot.ts), para que el worker persista el eco saliente con el origen real en vez de "humano". Omitido = comportamiento de siempre (un envío manual real). */
  origen?: "automatico";
  slot?: SlotWhatsApp;
}): Promise<RespuestaWorker<{ ok: true }>> {
  return llamarWorker<{ ok: true }>(
    params.tenantId,
    "enviar",
    "POST",
    {
      telefono: params.telefono,
      mensaje: params.mensaje,
      ...(params.origen ? { origen: params.origen } : {}),
    },
    params.slot ?? 1
  );
}

// Chats AMORE (autorizado) — envía una nota de audio real. El mensaje
// saliente se persiste solo por el evento real de Baileys (ver
// worker/src/chats/persistir-mensaje.ts), nunca por acá -- esta función
// únicamente pide al worker que lo mande de verdad.
export async function enviarAudioWhatsApp(params: {
  tenantId: string;
  telefono: string;
  audioBase64: string;
  mimeType: string;
  slot?: SlotWhatsApp;
}): Promise<RespuestaWorker<{ ok: true }>> {
  return llamarWorker<{ ok: true }>(
    params.tenantId,
    "enviar-audio",
    "POST",
    {
      telefono: params.telefono,
      audioBase64: params.audioBase64,
      mimeType: params.mimeType,
    },
    params.slot ?? 1
  );
}
