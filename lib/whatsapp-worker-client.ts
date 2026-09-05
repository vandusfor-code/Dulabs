// WhatsApp Worker (Fase 9B, autorizado) — único punto por el que Next.js
// habla con el worker persistente que sostiene las sesiones Baileys (ver
// worker/). Las 3 rutas de app/api/agenda/[token]/whatsapp-qr/* son
// deliberadamente delgadas: resuelven el tenant desde el token (como
// siempre) y delegan la operación real acá. El navegador nunca ve
// WHATSAPP_WORKER_URL/SECRET -- esta llamada ocurre server-side, dentro del
// handler de la ruta.
export type RespuestaWorker<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

async function llamarWorker<T>(idTenant: string, ruta: string, method: "GET" | "POST"): Promise<RespuestaWorker<T>> {
  const baseUrl = process.env.WHATSAPP_WORKER_URL;
  const secreto = process.env.WHATSAPP_WORKER_SECRET;
  if (!baseUrl || !secreto) {
    return { ok: false, status: 503, error: "El worker de WhatsApp no está configurado" };
  }

  try {
    const res = await fetch(`${baseUrl}/tenants/${idTenant}/${ruta}`, {
      method,
      headers: { Authorization: `Bearer ${secreto}` },
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
};

export function consultarEstadoWorker(idTenant: string) {
  return llamarWorker<EstadoWorker>(idTenant, "estado", "GET");
}

export function iniciarConexionWorker(idTenant: string) {
  return llamarWorker<EstadoWorker>(idTenant, "iniciar", "POST");
}

export function desconectarWorker(idTenant: string) {
  return llamarWorker<EstadoWorker>(idTenant, "desconectar", "POST");
}
