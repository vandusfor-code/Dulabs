// WhatsApp Worker (Fase 9B, autorizado) — único punto por el que Next.js
// habla con el worker persistente que sostiene las sesiones Baileys (ver
// worker/). Las 3 rutas de app/api/agenda/[token]/whatsapp-qr/* son
// deliberadamente delgadas: resuelven el tenant desde el token (como
// siempre) y delegan la operación real acá. El navegador nunca ve
// WHATSAPP_WORKER_URL/SECRET -- esta llamada ocurre server-side, dentro del
// handler de la ruta.
export type RespuestaWorker<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function llamarWorker<T>(
  idTenant: string,
  ruta: string,
  method: "GET" | "POST",
  cuerpoEnviado?: Record<string, unknown>
): Promise<RespuestaWorker<T>> {
  const baseUrl = process.env.WHATSAPP_WORKER_URL;
  const secreto = process.env.WHATSAPP_WORKER_SECRET;
  if (!baseUrl || !secreto) {
    return { ok: false, status: 503, error: "El worker de WhatsApp no está configurado" };
  }

  try {
    const res = await fetch(`${baseUrl}/tenants/${idTenant}/${ruta}`, {
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
  estado: "desconectado" | "conectando" | "conectado";
  numeroConectado: string | null;
  conectadoEn: string | null;
  qr: string | null;
  /** Código de 8 caracteres para "Vincular con número de teléfono" -- alternativa real al QR, mutuamente excluyente con `qr`. */
  codigoVinculacion: string | null;
};

export function consultarEstadoWorker(idTenant: string) {
  return llamarWorker<EstadoWorker>(idTenant, "estado", "GET");
}

/** `telefono` (opcional, solo dígitos con indicativo de país) pide el modo "vincular con número" en vez de QR. */
export function iniciarConexionWorker(idTenant: string, opciones?: { telefono?: string }) {
  return llamarWorker<EstadoWorker>(idTenant, "iniciar", "POST", opciones?.telefono ? { telefono: opciones.telefono } : undefined);
}

export function desconectarWorker(idTenant: string) {
  return llamarWorker<EstadoWorker>(idTenant, "desconectar", "POST");
}

// Fase L (canal de salida unificado, autorizado) — ÚNICO punto de envío
// real de WhatsApp para cualquier tenant conectado por QR (cumpleaños,
// fidelización, confirmaciones, recordatorios, Flow Engine deberían llamar
// esta función en vez de reimplementar su propio cliente de envío).
// Requiere que el tenant tenga una sesión CONECTADA en el worker -- si no,
// el worker mismo responde 409 y esto lo traduce a un resultado controlado,
// nunca lanza una excepción no atrapada. Ningún llamador de esta fase
// (cumpleaños/fidelización/comunicaciones) invoca esto todavía en su modo
// "real": todos siguen en dry-run/simulado hasta que exista un número
// dedicado conectado -- ver los adaptadores de cada motor.
export async function enviarMensajeWhatsApp(params: {
  tenantId: string;
  telefono: string;
  mensaje: string;
}): Promise<RespuestaWorker<{ ok: true }>> {
  return llamarWorker<{ ok: true }>(params.tenantId, "enviar", "POST", { telefono: params.telefono, mensaje: params.mensaje });
}
