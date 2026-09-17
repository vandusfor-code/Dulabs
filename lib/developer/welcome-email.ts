import { enviarNotificacionEmail, type ResultadoEnvioEmail } from "@/lib/dunning/email-provider";
import { siteUrlCon } from "@/lib/site-url";

// DuLabs Developer -- correo de bienvenida. Reutiliza el proveedor de email
// existente (lib/dunning/email-provider = Resend); no crea otro proveedor.
// HTML email-safe (tablas + estilos inline, sin CSS que Gmail rompa). No lanza:
// devuelve el resultado explícito para que el orquestador lo audite.

const LOGO_URL = "https://www.dulabs.co/logo.png";
const ACCENT = "#6366f1";
const BG = "#0b0b0f";
const CARD = "#141419";
const TEXT = "#e7e7ea";
const MUTED = "#a1a1aa";

function plantillaHtml(params: { nombre: string; empresa?: string | null; dashboardUrl: string }): string {
  const saludo = params.nombre ? `Hola ${escaparHtml(params.nombre)},` : "Hola,";
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${CARD};border-radius:16px;overflow:hidden;border:1px solid #23232b;">
        <tr><td style="padding:28px 32px 8px;">
          <img src="${LOGO_URL}" width="36" height="36" alt="DuLabs" style="display:block;border-radius:8px;">
          <div style="font:600 12px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;letter-spacing:2px;color:${ACCENT};margin-top:10px;text-transform:uppercase;">DuLabs Developers</div>
        </td></tr>
        <tr><td style="padding:16px 32px 0;">
          <h1 style="margin:0;font:600 22px/1.25 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${TEXT};">¡Bienvenido a DuLabs Developer! 🚀</h1>
          <p style="margin:14px 0 0;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${MUTED};">
            ${saludo} tu cuenta${params.empresa ? ` de <strong style="color:${TEXT};">${escaparHtml(params.empresa)}</strong>` : ""} ya está activa.
            Ahora puedes construir sobre la infraestructura de DuLabs: WhatsApp Cloud API, flows, webhooks y una API pensada para desarrolladores.
          </p>
        </td></tr>
        <tr><td style="padding:22px 32px 4px;">
          <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${TEXT};margin-bottom:10px;">Tus siguientes pasos</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${paso("1", "Elige tu plan y actívalo")}
            ${paso("2", "Conecta tu WhatsApp por Embedded Signup")}
            ${paso("3", "Genera tu API key y crea tu primer flow")}
          </table>
        </td></tr>
        <tr><td style="padding:26px 32px 32px;">
          <a href="${params.dashboardUrl}" style="display:inline-block;background:#ffffff;color:#0b0b0f;font:600 14px/1 -apple-system,Segoe UI,Roboto,Arial,sans-serif;text-decoration:none;padding:13px 22px;border-radius:10px;">Ir a mi dashboard →</a>
        </td></tr>
        <tr><td style="padding:18px 32px;border-top:1px solid #23232b;">
          <p style="margin:0;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${MUTED};">
            ¿Necesitas ayuda? Escríbenos a <a href="mailto:contacto@dulabs.co" style="color:${ACCENT};text-decoration:none;">contacto@dulabs.co</a>.
            Si no creaste esta cuenta, ignora este mensaje.
          </p>
          <p style="margin:10px 0 0;font:400 11px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6b6b74;">© DuLabs · dulabs.co</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function paso(n: string, texto: string): string {
  return `<tr><td style="padding:5px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:22px;height:22px;background:#23232b;border-radius:11px;color:${ACCENT};font:600 11px/22px -apple-system,Arial,sans-serif;text-align:center;">${n}</td>
      <td style="padding-left:10px;font:400 14px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${MUTED};">${texto}</td>
    </tr></table>
  </td></tr>`;
}

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function enviarBienvenidaEmailDeveloper(params: {
  email: string;
  nombre: string;
  empresa?: string | null;
}): Promise<ResultadoEnvioEmail> {
  const dashboardUrl = siteUrlCon("/developer");
  const html = plantillaHtml({ nombre: params.nombre, empresa: params.empresa, dashboardUrl });
  const textoPlano = `${params.nombre ? `Hola ${params.nombre}, ` : ""}tu cuenta de DuLabs Developer ya está activa.\n\nSiguientes pasos:\n1. Elige tu plan y actívalo\n2. Conecta tu WhatsApp por Embedded Signup\n3. Genera tu API key y crea tu primer flow\n\nEntra a tu dashboard: ${dashboardUrl}\n\n¿Ayuda? contacto@dulabs.co`;
  return enviarNotificacionEmail({
    destinatario: params.email,
    asunto: "Bienvenido a DuLabs Developer 🚀",
    textoPlano,
    html,
  });
}
