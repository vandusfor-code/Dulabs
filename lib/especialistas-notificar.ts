import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarTexto } from "@/lib/whatsapp";
import { resolverTokenMeta } from "@/lib/dumo";
import type { ClienteConfig } from "@/lib/supabase";
import type { CitaEspecialista, Especialista } from "@/lib/especialistas";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dulabs.co";

export function formatearFechaHora(iso: string): string {
  const d = new Date(iso);
  const fecha = d.toLocaleDateString("es-CO", { day: "numeric", month: "long", timeZone: "America/Bogota" });
  const hora = d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Bogota" });
  return `${fecha} a las ${hora}`;
}

// Envía usando el número y token del propio tenant (no el canal de alertas
// internas, ese es solo para avisarle al dueño de la plataforma). Nunca
// lanza: una notificación que falla no puede tumbar el flujo que la disparó.
async function enviar(cliente: Pick<ClienteConfig, "phone_number_id" | "meta_permanent_token">, para: string, texto: string): Promise<boolean> {
  const token = resolverTokenMeta(cliente);
  if (!token) {
    console.error("[especialistas-notificar] sin token de Meta");
    return false;
  }
  try {
    await enviarTexto({ phoneNumberId: cliente.phone_number_id, token, para, texto });
    return true;
  } catch (err) {
    console.error("[especialistas-notificar] error enviando WhatsApp:", err instanceof Error ? err.message : err);
    return false;
  }
}

// Avisa a la especialista que le llegó una solicitud nueva, con el link
// directo a su agenda para que la apruebe o rechace.
export async function notificarNuevaSolicitud(
  cliente: Pick<ClienteConfig, "phone_number_id" | "meta_permanent_token">,
  especialista: Especialista,
  cita: CitaEspecialista
): Promise<boolean> {
  const texto = `📋 Nueva solicitud de cita\n\n${cita.nombre_cliente} · ${cita.servicio}\n${formatearFechaHora(cita.inicio)}\n\nConfírmala o recházala aquí:\n${SITE_URL}/agenda/${especialista.token}`;
  return enviar(cliente, especialista.numero_whatsapp, texto);
}

// Avisa al cliente que su cita quedó confirmada.
export async function notificarCitaConfirmada(
  cliente: Pick<ClienteConfig, "phone_number_id" | "meta_permanent_token">,
  cita: CitaEspecialista
): Promise<boolean> {
  if (!cita.telefono_cliente) return false;
  const texto = `¡Listo, ${cita.nombre_cliente}! 💕 Tu cita quedó confirmada.\n\n✨ ${cita.servicio}\n📅 ${formatearFechaHora(cita.inicio)}\n\nTe esperamos 💕`;
  return enviar(cliente, cita.telefono_cliente, texto);
}

// Avisa a la clienta que la especialista propuso un horario distinto al que
// pidió, y le pide que responda directamente por el chat (sí/no) -- el bot
// interpreta esa respuesta la próxima vez que escriba, sin botones.
export async function notificarPropuestaReagendamiento(
  cliente: Pick<ClienteConfig, "phone_number_id" | "meta_permanent_token">,
  cita: CitaEspecialista
): Promise<boolean> {
  if (!cita.telefono_cliente) return false;
  const texto = `Hola ${cita.nombre_cliente} 😊 No tenemos disponibilidad justo en el horario que pediste, pero sí podemos en este otro:\n\n✨ ${cita.servicio}\n📅 ${formatearFechaHora(cita.inicio)}\n\n¿Te sirve? Respóndenos por aquí mismo.`;
  return enviar(cliente, cita.telefono_cliente, texto);
}

// Avisa al cliente que su solicitud no se pudo confirmar.
export async function notificarCitaRechazada(
  cliente: Pick<ClienteConfig, "phone_number_id" | "meta_permanent_token">,
  cita: CitaEspecialista
): Promise<boolean> {
  if (!cita.telefono_cliente) return false;
  const texto = `Hola ${cita.nombre_cliente} 😊 En esta ocasión no pudimos confirmar tu solicitud para ${formatearFechaHora(cita.inicio)}.${cita.motivo_rechazo ? ` ${cita.motivo_rechazo}` : ""}\n\n¿Quieres que te ayudemos a buscar otro horario?`;
  return enviar(cliente, cita.telefono_cliente, texto);
}

export async function clienteDeEspecialista(supabase: SupabaseClient, phoneNumberId: string): Promise<ClienteConfig | null> {
  const { data } = await supabase.from("dulabs_clientes_config").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
  return (data as ClienteConfig) ?? null;
}
