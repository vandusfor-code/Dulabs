// FASE F16.1 (Commercial Scale — Dunning, autorizado) — canal de
// notificación al cliente. Hallazgo real de la investigación previa: este
// proyecto NO tiene ningún proveedor de email transaccional hoy (se buscó
// Resend/SMTP/SendGrid/nodemailer en todo el repo -- cero resultados; el
// único correo real es la plantilla de "confirmar cuenta" pegada a mano en
// Supabase Auth, que no sirve para esto). Por eso este archivo define una
// interfaz mínima y pluggable en vez de asumir un proveedor -- y una
// implementación real contra Resend (API HTTP simple, sin SDK, mismo patrón
// de fetch crudo que ya usa lib/wompi.ts) que se activa SOLA en cuanto
// exista RESEND_API_KEY en el entorno. Sin esa variable, el envío real
// nunca ocurre pero el sistema de dunning en sí (detección, reintentos,
// grace period, auditoría, panel admin) queda completo y funcionando --
// exactamente el mismo criterio "fail-safe, nunca bloquea la operación
// real" que ya usa el resto del proyecto (rate-limit fail-open, auditoría
// fail-safe si falta la migración). Proveer RESEND_API_KEY es una decisión
// de negocio (crear la cuenta, verificar el dominio de envío) -- no se
// inventa acá.

export interface NotificacionEmail {
  destinatario: string;
  asunto: string;
  textoPlano: string;
  html: string;
}

export type ResultadoEnvioEmail = { enviado: true; proveedor: "resend" } | { enviado: false; motivo: string };

async function enviarConResend(notificacion: NotificacionEmail): Promise<ResultadoEnvioEmail> {
  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.DUNNING_EMAIL_FROM ?? "DuLabs <facturacion@dulabs.co>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: remitente,
        to: [notificacion.destinatario],
        subject: notificacion.asunto,
        text: notificacion.textoPlano,
        html: notificacion.html,
      }),
    });
    if (!res.ok) {
      const cuerpo = await res.text().catch(() => "");
      return { enviado: false, motivo: `Resend respondió ${res.status}: ${cuerpo.slice(0, 300)}` };
    }
    return { enviado: true, proveedor: "resend" };
  } catch (err) {
    return { enviado: false, motivo: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Punto único de envío real. Nunca lanza -- el llamador (lib/dunning/
 * notificaciones.ts) siempre recibe un resultado explícito y decide qué
 * evento de auditoría registrar (notification_*_sent vs notification_*_failed).
 */
export async function enviarNotificacionEmail(notificacion: NotificacionEmail): Promise<ResultadoEnvioEmail> {
  if (!process.env.RESEND_API_KEY) {
    return { enviado: false, motivo: "RESEND_API_KEY no está configurado en este entorno -- el envío real de email no está disponible todavía." };
  }
  return enviarConResend(notificacion);
}
