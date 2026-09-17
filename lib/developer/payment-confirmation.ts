import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarNotificacionEmail } from "@/lib/dunning/email-provider";
import { enviarTemplateDulabs } from "@/lib/developer/dulabs-whatsapp";
import { obtenerCuentaPorId } from "@/lib/developer/accounts-store";
import { obtenerPlan } from "@/lib/developer/plans";
import { siteUrlCon } from "@/lib/site-url";

// DuLabs Developer -- confirmación de PAGO (email + WhatsApp). Se dispara desde
// el webhook de Wompi SOLO en la transición a APPROVED (una vez por activación).
// No bloqueante: un fallo se loguea, nunca revierte la activación. Reutiliza el
// proveedor de email existente (Resend) y el sender de WhatsApp de DuLabs.
//
// WhatsApp de pago: NO existe todavía una plantilla Meta aprobada específica, así
// que el envío está GATED por env DEV_PAYMENT_TEMPLATE_NAME. Sin esa env, se
// omite (MANUAL_REQUIRED: crear/aprobar la plantilla). Con ella, se valida la
// estructura real antes de enviar.

const ACCENT = "#6366f1";
const BG = "#0b0b0f";
const CARD = "#141419";
const TEXT = "#e7e7ea";
const MUTED = "#a1a1aa";

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function emailHtml(params: { nombre: string; planNombre: string; referencia: string; hasta: string | null; dashboardUrl: string }): string {
  const filas = [
    ["Plan", escaparHtml(params.planNombre)],
    ["Referencia", escaparHtml(params.referencia)],
    ...(params.hasta ? [["Próxima renovación", escaparHtml(params.hasta)]] : []),
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;font:400 13px/1.4 -apple-system,Arial,sans-serif;color:${MUTED};">${k}</td><td style="padding:6px 0;font:600 13px/1.4 -apple-system,Arial,sans-serif;color:${TEXT};text-align:right;">${v}</td></tr>`
    )
    .join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${CARD};border-radius:16px;border:1px solid #23232b;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;">
        <img src="https://www.dulabs.co/logo.png" width="36" height="36" alt="DuLabs" style="display:block;border-radius:8px;">
        <div style="font:600 12px/1 -apple-system,Arial,sans-serif;letter-spacing:2px;color:${ACCENT};margin-top:10px;text-transform:uppercase;">DuLabs Developers</div>
      </td></tr>
      <tr><td style="padding:16px 32px 0;">
        <h1 style="margin:0;font:600 22px/1.25 -apple-system,Arial,sans-serif;color:${TEXT};">Tu plan DuLabs está activo ✅</h1>
        <p style="margin:14px 0 0;font:400 15px/1.6 -apple-system,Arial,sans-serif;color:${MUTED};">
          ${params.nombre ? `Hola ${escaparHtml(params.nombre)}, ` : ""}confirmamos tu pago. Tu suscripción quedó activa y tus límites ya están disponibles.
        </p>
      </td></tr>
      <tr><td style="padding:18px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #23232b;border-bottom:1px solid #23232b;padding:6px 0;">${filas}</table>
      </td></tr>
      <tr><td style="padding:24px 32px 32px;">
        <a href="${params.dashboardUrl}" style="display:inline-block;background:#ffffff;color:#0b0b0f;font:600 14px/1 -apple-system,Arial,sans-serif;text-decoration:none;padding:13px 22px;border-radius:10px;">Ir a mi dashboard →</a>
      </td></tr>
      <tr><td style="padding:18px 32px;border-top:1px solid #23232b;">
        <p style="margin:0;font:400 12px/1.6 -apple-system,Arial,sans-serif;color:${MUTED};">¿Dudas con tu factura? Escríbenos a <a href="mailto:facturacion@dulabs.co" style="color:${ACCENT};text-decoration:none;">facturacion@dulabs.co</a>.</p>
        <p style="margin:10px 0 0;font:400 11px/1.5 -apple-system,Arial,sans-serif;color:#6b6b74;">© DuLabs · dulabs.co</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export type ResumenConfirmacionPago = {
  email: { enviado: boolean; motivo?: string };
  whatsapp: { enviado: boolean; motivo?: string; wamid?: string | null };
};

export async function dispararConfirmacionPagoDeveloper(
  supabase: SupabaseClient,
  input: { accountId: string; planCodigo: string; transactionId: string }
): Promise<ResumenConfirmacionPago> {
  const resumen: ResumenConfirmacionPago = { email: { enviado: false }, whatsapp: { enviado: false } };

  const cuenta = await obtenerCuentaPorId(supabase, input.accountId);
  if (!cuenta) {
    console.error(`[developer/payment-confirmation] cuenta ${input.accountId} no encontrada`);
    return resumen;
  }
  let email = "";
  let nombre = "";
  let whatsapp = "";
  try {
    const { data } = await supabase.auth.admin.getUserById(cuenta.owner_user_id);
    email = data?.user?.email ?? "";
    const meta = (data?.user?.user_metadata ?? {}) as Record<string, unknown>;
    nombre = typeof meta.nombre === "string" ? meta.nombre : "";
    whatsapp = typeof meta.whatsapp === "string" ? meta.whatsapp : "";
  } catch (err) {
    console.error(`[developer/payment-confirmation] no se pudo leer el owner:`, err instanceof Error ? err.message : String(err));
  }

  const plan = await obtenerPlan(supabase, input.planCodigo).catch(() => null);
  const planNombre = plan?.nombre ?? input.planCodigo;
  const primerNombre = nombre.split(/\s+/)[0] || nombre;
  const hasta = cuenta.periodo_fin ? new Date(cuenta.periodo_fin).toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" }) : null;

  // Email (Resend)
  if (email) {
    try {
      const r = await enviarNotificacionEmail({
        destinatario: email,
        asunto: "Tu plan DuLabs está activo ✅",
        textoPlano: `${primerNombre ? `Hola ${primerNombre}, ` : ""}confirmamos tu pago. Plan: ${planNombre}. Referencia: ${input.transactionId}.${hasta ? ` Próxima renovación: ${hasta}.` : ""}\n\nDashboard: ${siteUrlCon("/developer")}`,
        html: emailHtml({ nombre: primerNombre, planNombre, referencia: input.transactionId, hasta, dashboardUrl: siteUrlCon("/developer") }),
      });
      resumen.email = r.enviado ? { enviado: true } : { enviado: false, motivo: r.motivo };
    } catch {
      resumen.email = { enviado: false, motivo: "excepcion" };
    }
  } else {
    resumen.email = { enviado: false, motivo: "sin_email" };
  }

  // WhatsApp (gated: requiere plantilla Meta aprobada configurada por env)
  const tpl = process.env.DEV_PAYMENT_TEMPLATE_NAME;
  if (tpl && whatsapp) {
    const idioma = process.env.DEV_PAYMENT_TEMPLATE_LANG || "es_CO";
    // Params por convención: {{1}}=nombre, {{2}}=plan. El sender valida el nº real.
    const r = await enviarTemplateDulabs(supabase, { nombrePlantilla: tpl, idioma, destinoE164: whatsapp, params: [primerNombre || "cliente", planNombre] });
    resumen.whatsapp = r.enviado ? { enviado: true, wamid: r.wamid } : { enviado: false, motivo: r.motivo };
  } else {
    resumen.whatsapp = { enviado: false, motivo: tpl ? "sin_whatsapp" : "plantilla_no_configurada" };
  }

  console.log(`[developer/payment-confirmation] account=${input.accountId} email=${resumen.email.enviado ? "ok" : `fail:${resumen.email.motivo}`} whatsapp=${resumen.whatsapp.enviado ? "ok" : `fail:${resumen.whatsapp.motivo}`}`);
  return resumen;
}
