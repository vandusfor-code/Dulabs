/**
 * FASE 3B.9E — canal "correo" del aviso a la PERSONA RESPONSABLE de un pedido pendiente de aceptación.
 *
 *   el cliente confirma el pedido -> el backend asigna la conversación a la persona responsable (Inbox) -> aviso por los canales
 *   configurados (cierre.responsable.canales). El panel "Por aceptar" siempre lo ve; este canal le manda además un correo para que no dependa de
 *   estar mirando el panel.
 *
 * Reglas:
 *   - Es un aviso INTERNO (al equipo del negocio): el correo solo lleva el número público del pedido y el enlace al panel. Nunca datos del cliente
 *     (nombre, teléfono, dirección, documento) ni los productos.
 *   - Reutiliza el proveedor de correo que ya existe (lib/dunning/email-provider = Resend); no crea otro. Sin RESEND_API_KEY no sale nada y el
 *     resultado es "error" (el pedido igual queda visible en el panel): un fallo de un canal nunca deshace nada ni impide los otros.
 *   - Solo corre si el negocio lo configuró (checkout_opciones.cierre.responsable.canales incluye "correo"); sin eso, nadie recibe nada.
 *   - Nunca lanza.
 */
import type { CanalNotificador } from "@/lib/agente/aceptacion-humana";
import { enviarNotificacionEmail, type NotificacionEmail, type ResultadoEnvioEmail } from "@/lib/dunning/email-provider";
import { siteUrlCon } from "@/lib/site-url";

/** Ruta del panel donde la persona responsable acepta o rechaza el pedido. */
export const RUTA_POR_ACEPTAR = "/dashboard/pedidos/por-aceptar";

const PEDIDO_PUBLICO = /^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/;
const CORREO = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** El correo que recibe la persona responsable. Puro: solo el número público del pedido y el enlace al panel. */
export function correoDeAvisoResponsable(input: { pedido: string; urlPanel: string; remitente?: string; destinatario: string }): NotificacionEmail {
  const texto = `Hay un pedido esperando tu aceptación: ${input.pedido}.\n\nEntra a Pedidos → Por aceptar para revisarlo y aceptarlo o rechazarlo:\n${input.urlPanel}\n\nEl cliente ya confirmó que quiere recibirlo. Hasta que lo aceptes, el pedido sigue pendiente.`;
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
      <tr><td style="padding:24px 28px 8px;font:600 18px/1.3 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b;">Pedido por aceptar</td></tr>
      <tr><td style="padding:4px 28px 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#3f3f46;">
        Hay un pedido esperando tu aceptación: <strong>${escaparHtml(input.pedido)}</strong>.<br>El cliente ya confirmó que quiere recibirlo. Hasta que lo aceptes, el pedido sigue pendiente.
      </td></tr>
      <tr><td style="padding:20px 28px 28px;"><a href="${escaparHtml(input.urlPanel)}" style="display:inline-block;background:#18181b;color:#ffffff;font:600 14px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;text-decoration:none;padding:13px 20px;border-radius:10px;">Ver pedidos por aceptar</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { destinatario: input.destinatario, asunto: `Pedido por aceptar ${input.pedido}`, textoPlano: texto, html, ...(input.remitente ? { remitente: input.remitente } : {}) };
}

export interface CanalCorreoDeps {
  /** Envío real (Resend). Las pruebas inyectan uno falso. */
  enviar?: (correo: NotificacionEmail) => Promise<ResultadoEnvioEmail>;
  /** Enlace al panel (por defecto, el dominio del sitio). */
  urlPanel?: () => string;
  /** Remitente propio de estos avisos (por defecto, el del proveedor: PEDIDOS_EMAIL_FROM si existe). */
  remitente?: () => string | undefined;
}

/** Canal "correo" del aviso a la persona responsable. Idempotencia: el aviso se dispara una vez por pedido (al quedar pendiente de aceptación). */
export function crearCanalCorreo(deps: CanalCorreoDeps = {}): CanalNotificador {
  const enviar = deps.enviar ?? enviarNotificacionEmail;
  const urlPanel = deps.urlPanel ?? (() => siteUrlCon(RUTA_POR_ACEPTAR));
  const remitente = deps.remitente ?? (() => process.env.PEDIDOS_EMAIL_FROM?.trim() || undefined);
  return {
    async enviar(aviso) {
      try {
        const destinatario = aviso.responsable.email?.trim() ?? "";
        // Sin un número de pedido público válido o sin un correo utilizable no se manda nada (nunca un destino inventado).
        if (!PEDIDO_PUBLICO.test(aviso.pedido) || !CORREO.test(destinatario)) return { estado: "error" };
        const r = await enviar(correoDeAvisoResponsable({ pedido: aviso.pedido, urlPanel: urlPanel(), destinatario, remitente: remitente() }));
        return { estado: r.enviado ? "entregada" : "error" };
      } catch {
        return { estado: "error" };
      }
    },
  };
}
