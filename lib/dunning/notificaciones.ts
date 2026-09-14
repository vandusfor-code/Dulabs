// FASE F16.1 (Commercial Scale — Dunning, autorizado) — contenido de las 4
// notificaciones al cliente + envío idempotente (a lo sumo una vez por tipo
// y por ciclo, garantizado por el índice único parcial
// dulabs_dunning_eventos_notificacion_unica de la migración). Usa
// EXCLUSIVAMENTE la ruta real existente /dashboard/cuenta -- ninguna URL
// inventada.

import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarNotificacionEmail } from "./email-provider";

export type TipoNotificacionDunning = "payment_failed" | "reminder" | "expired" | "recovered";

const TIPO_A_EVENTO: Record<TipoNotificacionDunning, string> = {
  payment_failed: "notification_payment_failed",
  reminder: "notification_reminder",
  expired: "notification_expired",
  recovered: "notification_recovered",
};

function urlCuenta(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.dulabs.co";
  return `${base.replace(/\/$/, "")}/dashboard/cuenta`;
}

function envoltorio(titulo: string, cuerpoHtml: string): string {
  // HTML mínimo, sin dependencias externas ni imágenes remotas -- se ve
  // correcto en cualquier cliente de correo sin depender de que carguen
  // recursos externos.
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#111;max-width:480px;margin:0 auto;padding:24px;">
    <h2 style="color:#111;">${titulo}</h2>
    ${cuerpoHtml}
    <p style="color:#888;font-size:12px;margin-top:32px;">DuLabs · https://dulabs.co</p>
  </body></html>`;
}

function contenidoPara(tipo: TipoNotificacionDunning, params: { nombreNegocio: string | null; fechaLimite?: string }): { asunto: string; textoPlano: string; html: string } {
  const negocio = params.nombreNegocio ?? "tu negocio";
  const enlace = urlCuenta();

  switch (tipo) {
    case "payment_failed":
      return {
        asunto: "No pudimos procesar tu pago en DuLabs",
        textoPlano: `Hola,\n\nEl cobro de tu suscripción de DuLabs para ${negocio} no se pudo procesar. Tu servicio sigue activo por ahora, pero necesitamos que regularices tu método de pago para evitar una interrupción.\n\nActualiza o reintenta tu pago acá: ${enlace}\n\nGracias,\nEquipo DuLabs`,
        html: envoltorio("No pudimos procesar tu pago", `<p>El cobro de tu suscripción de DuLabs para <strong>${negocio}</strong> no se pudo procesar.</p><p>Tu servicio sigue activo por ahora, pero necesitamos que regularices tu método de pago para evitar una interrupción.</p><p><a href="${enlace}" style="color:#4d7a0a;">Actualizar o reintentar mi pago →</a></p>`),
      };
    case "reminder":
      return {
        asunto: "Recordatorio: actualiza tu método de pago en DuLabs",
        textoPlano: `Hola,\n\nTodavía no hemos podido confirmar el pago de tu suscripción de DuLabs para ${negocio}.${params.fechaLimite ? ` Tienes hasta el ${params.fechaLimite} para regularizarlo antes de que tu servicio se vea afectado.` : ""}\n\nPuedes hacerlo acá: ${enlace}\n\nGracias,\nEquipo DuLabs`,
        html: envoltorio("Actualiza tu método de pago", `<p>Todavía no hemos podido confirmar el pago de tu suscripción de DuLabs para <strong>${negocio}</strong>.</p>${params.fechaLimite ? `<p>Tienes hasta el <strong>${params.fechaLimite}</strong> para regularizarlo antes de que tu servicio se vea afectado.</p>` : ""}<p><a href="${enlace}" style="color:#4d7a0a;">Actualizar mi método de pago →</a></p>`),
      };
    case "expired":
      return {
        asunto: "Tu suscripción de DuLabs quedó vencida",
        textoPlano: `Hola,\n\nNo logramos confirmar el pago de tu suscripción de DuLabs para ${negocio} después de varios intentos, así que tu acceso quedó afectado.\n\nPuedes reactivarlo cuando quieras acá: ${enlace}\n\nGracias,\nEquipo DuLabs`,
        html: envoltorio("Tu suscripción quedó vencida", `<p>No logramos confirmar el pago de tu suscripción de DuLabs para <strong>${negocio}</strong> después de varios intentos, así que tu acceso quedó afectado.</p><p>Puedes reactivarlo cuando quieras.</p><p><a href="${enlace}" style="color:#4d7a0a;">Reactivar mi suscripción →</a></p>`),
      };
    case "recovered":
      return {
        asunto: "¡Listo! Tu pago fue confirmado",
        textoPlano: `Hola,\n\nConfirmamos el pago de tu suscripción de DuLabs para ${negocio}. Tu servicio sigue activo con normalidad y tu próxima renovación se procesará en la fecha habitual.\n\nGracias,\nEquipo DuLabs`,
        html: envoltorio("¡Pago confirmado!", `<p>Confirmamos el pago de tu suscripción de DuLabs para <strong>${negocio}</strong>.</p><p>Tu servicio sigue activo con normalidad y tu próxima renovación se procesará en la fecha habitual.</p><p><a href="${enlace}" style="color:#4d7a0a;">Ver mi cuenta →</a></p>`),
      };
  }
}

/**
 * Envía (o no-opea sin proveedor configurado) la notificación `tipo` para
 * el ciclo `cicloId`, y registra el resultado en dulabs_dunning_eventos.
 * Idempotente de verdad: el INSERT del evento "*_sent" choca con el índice
 * único parcial si ya se mandó ese tipo para este ciclo -- en ese caso esta
 * función simplemente no reintenta el envío (ya se hizo), sin error visible
 * para el caller (devuelve `yaEnviada: true`).
 */
export async function enviarNotificacionDunning(
  supabase: SupabaseClient,
  params: {
    idTenant: string;
    cicloId: number;
    tipo: TipoNotificacionDunning;
    destinatario: string | null;
    nombreNegocio: string | null;
    fechaLimite?: string;
  },
): Promise<{ yaEnviada: boolean; enviada: boolean; motivo?: string }> {
  const eventoBase = TIPO_A_EVENTO[params.tipo];

  if (!params.destinatario) {
    await supabase.from("dulabs_dunning_eventos").insert({
      id_tenant: params.idTenant,
      ciclo_id: params.cicloId,
      tipo: `${eventoBase}_failed`,
      metadata: { motivo: "sin correo de contacto conocido para este tenant" },
    });
    return { yaEnviada: false, enviada: false, motivo: "sin destinatario" };
  }

  const contenido = contenidoPara(params.tipo, { nombreNegocio: params.nombreNegocio, fechaLimite: params.fechaLimite });
  const resultado = await enviarNotificacionEmail({ destinatario: params.destinatario, ...contenido });

  const tipoEvento = resultado.enviado ? `${eventoBase}_sent` : `${eventoBase}_failed`;
  const { error } = await supabase.from("dulabs_dunning_eventos").insert({
    id_tenant: params.idTenant,
    ciclo_id: params.cicloId,
    tipo: tipoEvento,
    metadata: resultado.enviado ? { destinatario: params.destinatario } : { destinatario: params.destinatario, motivo: (resultado as { motivo: string }).motivo },
  });

  if (error) {
    // El índice único parcial (dulabs_dunning_eventos_notificacion_unica)
    // solo protege el tipo "*_sent" -- si YA existe un "_sent" para este
    // ciclo y este intento también resultó "enviado", el conflicto es
    // exactamente la protección de idempotencia funcionando: ya se mandó
    // antes, no se manda de nuevo.
    if (error.code === "23505") {
      return { yaEnviada: true, enviada: false };
    }
    console.error(`[dunning] error registrando evento de notificación (${tipoEvento}) para ${params.idTenant}:`, error.message);
  }

  return { yaEnviada: false, enviada: resultado.enviado, motivo: resultado.enviado ? undefined : (resultado as { motivo: string }).motivo };
}
