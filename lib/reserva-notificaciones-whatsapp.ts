import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarWhatsApp } from "@/lib/whatsapp-outbound";
import { normalizarTelefono } from "@/lib/marketplace-store";
import type { ClienteConfig } from "@/lib/supabase";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";

/**
 * FASE FINAL (autorizado) — los dos mensajes de WhatsApp que siguen a una
 * reserva exitosa del Portal Cliente. Reutiliza la infraestructura ya
 * existente, sin duplicar nada:
 * - envío real: lib/whatsapp-outbound.ts::enviarWhatsApp (token del tenant,
 *   registra en dulabs_mensajes_log, incrementa uso).
 * - normalización de teléfono: lib/marketplace-store.ts::normalizarTelefono
 *   (la MISMA que ya arregla "3148127388" -> "573148127388" para Colombia).
 *
 * Sin ventana de 24h ni plantillas: quien reserva llega al portal DESDE la
 * conversación de WhatsApp que acaba de tener con el negocio (instrucción
 * explícita de esta fase) -- se envían ambos mensajes de sesión normales,
 * uno después del otro, sin ninguna comprobación adicional.
 *
 * Genérico por diseño: nunca recibe ni asume un tenant/teléfono/nombre
 * puntual -- todo sale de `idTenant` (resuelve el ClienteConfig real) y de
 * los datos de la cita ya creada.
 */

export type ResultadoNotificacionReserva = { enviado: true } | { enviado: false; motivo: "sin_cliente" | "sin_telefono" | "error" };

/** Función PURA -- construye el texto del mensaje 1 (confirmación). Nunca recibe datos inventados: todo viene de la cita/servicio/especialista reales ya creados. */
export function construirMensajeConfirmacionReserva(params: { servicio: string; profesional: string; inicioISO: string }): string {
  const fechaHora = formatearFechaHoraColombia(params.inicioISO);
  return `¡Tu cita ha sido confirmada! 💗\n\nTe esperamos el ${fechaHora}.\n\n📌 Servicio: ${params.servicio}\n💅 Profesional: ${params.profesional}\n\n¡Gracias por elegirnos! ✨`;
}

/** Texto fijo del mensaje 2 -- es una política del negocio, no un dato de la cita puntual. Se envía INMEDIATAMENTE después del mensaje 1, nunca programado. */
export const MENSAJE_RECORDATORIO_INMEDIATO =
  "💗 Recuerda que toda cita debe ser confirmada 1 hora antes de la hora programada.\n\nDe lo contrario, la cita se cancelará automáticamente.\n\nSi ya confirmaste tu cita, puedes ignorar este mensaje. ✨";

/** "sábado, 5 de septiembre a las 9:30 a. m." -- siempre hora de Colombia, nunca la hora del servidor. */
export function formatearFechaHoraColombia(inicioISO: string): string {
  const d = new Date(inicioISO);
  const fecha = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bogota" }).format(d);
  const hora = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" }).format(d);
  return `${fecha} a las ${hora}`;
}

/**
 * Envía los DOS mensajes (confirmación + recordatorio inmediato) tras una
 * reserva creada EXITOSAMENTE. Debe llamarse desde DENTRO del callback
 * idempotente de ejecutarConIdempotencia (ver app/api/reservar/[tenant]/route.ts)
 * -- igual que la lección ya aplicada en confirmarCita+notificar (Fase 4):
 * así un reintento con la MISMA idempotencyKey nunca reenvía nada, porque
 * simplemente no vuelve a ejecutar `operacion`. No se creó ninguna
 * columna/tabla nueva -- la idempotencia real ya la da
 * dulabs_idempotencia_reservas.
 *
 * Nunca lanza -- una notificación que falla no puede tumbar la reserva ya
 * creada (mismo criterio que enviarWhatsApp/especialistas-notificar.ts).
 */
export async function enviarConfirmacionReservaWhatsApp(
  supabase: SupabaseClient,
  idTenant: string,
  telefonoClienteCrudo: string,
  cita: { servicio: string; profesional: string; inicioISO: string }
): Promise<ResultadoNotificacionReserva> {
  try {
    const telefono = normalizarTelefono(telefonoClienteCrudo);
    if (!telefono) return { enviado: false, motivo: "sin_telefono" };

    // HALLAZGO REAL (autorizado) — un tenant conectado por WhatsApp-QR (ej.
    // AMORE) nunca tiene un phone_number_id/token real de Meta en
    // dulabs_clientes_config (esa tabla es del modelo Cloud API); antes de
    // este fix, la confirmación de reserva del portal intentaba mandarse
    // igual por la Graph API y fallaba en silencio (catch de abajo). Un
    // tenant con fila en dulabs_whatsapp_qr_sesiones usa ese canal real en
    // vez de Cloud API -- mismo cliente de envío que ya usa Chats
    // (lib/whatsapp-worker-client.ts), nunca un tercer canal nuevo.
    const { data: sesionQr } = await supabase.from("dulabs_whatsapp_qr_sesiones").select("id_tenant").eq("id_tenant", idTenant).maybeSingle();
    if (sesionQr) {
      const r1 = await enviarMensajeWhatsApp({ tenantId: idTenant, telefono, mensaje: construirMensajeConfirmacionReserva(cita) });
      if (!r1.ok) return { enviado: false, motivo: "error" };
      const r2 = await enviarMensajeWhatsApp({ tenantId: idTenant, telefono, mensaje: MENSAJE_RECORDATORIO_INMEDIATO });
      if (!r2.ok) return { enviado: false, motivo: "error" };
      return { enviado: true };
    }

    const { data: cliente } = await supabase.from("dulabs_clientes_config").select("*").eq("id_tenant", idTenant).limit(1).maybeSingle();
    if (!cliente) return { enviado: false, motivo: "sin_cliente" };

    await enviarWhatsApp(supabase, cliente as ClienteConfig, telefono, construirMensajeConfirmacionReserva(cita));
    await enviarWhatsApp(supabase, cliente as ClienteConfig, telefono, MENSAJE_RECORDATORIO_INMEDIATO);
    return { enviado: true };
  } catch (err) {
    console.error("[reserva-notificaciones-whatsapp] error enviando mensajes de reserva:", err instanceof Error ? err.message : err);
    return { enviado: false, motivo: "error" };
  }
}
