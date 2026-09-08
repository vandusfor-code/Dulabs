/**
 * AMORE (autorizado, Fase Final) — recordatorio real de "1 hora antes" para
 * una cita, enviado por el canal REAL de AMORE (WhatsApp-QR/Baileys vía el
 * worker, lib/whatsapp-worker-client.ts) -- NUNCA el canal de Meta Cloud API
 * que usa lib/especialistas-notificar.ts para el resto de tenants: AMORE no
 * tiene un token real de Meta (dulabs_clientes_config.phone_number_id =
 * "pendiente-amore-ed6ae77f", meta_permanent_token = null, verificado contra
 * la base real) -- por eso el cron existente (app/api/cron/recordatorios-citas)
 * nunca lograba entregarle nada a una clienta de AMORE, aunque marcara el
 * intento como fallido y lo reintentara sin fin.
 *
 * A diferencia del recordatorio de Marketplace (retirado en
 * 20260803090000_quitar_recordatorios_agenda.sql por depender de una
 * plantilla Utility de Meta nunca aprobada), Baileys no está sujeto a la
 * ventana de 24h/plantillas de la Cloud API oficial -- un mensaje de texto
 * libre funciona igual que cualquier mensaje real de WhatsApp Web.
 *
 * Reutiliza TAL CUAL (nunca duplica):
 * - enviarMensajeWhatsApp (lib/whatsapp-worker-client.ts) -- MISMO cliente
 *   exacto que ya usan Agenda V2 (Fases 1-8) y el puente de Fase 9.
 * - especialistaPorId (lib/especialistas.ts) -- mismo lookup ya usado en
 *   toda la plataforma.
 * - fechaColombiaDesdeIso/horaColombiaDesdeIso (lib/timezone-colombia.ts) +
 *   formatearFechaLarga (lib/agenda-v2/fechas.ts) + formatearHoraAmPm
 *   (lib/especialistas-flow-adaptador.ts) -- MISMOS formatters que ya usa
 *   Agenda V2 para mostrar fecha/hora reales en Colombia.
 *
 * Nunca toca crearCitaConNylas/Nylas/Agenda V2/gestión de citas -- es de
 * solo lectura + un mensaje informativo, nunca modifica la cita (la bandera
 * recordatorio_enviado la gestiona exclusivamente route.ts, después de un
 * envío exitoso).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarMensajeWhatsApp } from "@/lib/whatsapp-worker-client";
import { especialistaPorId } from "@/lib/especialistas";
import { fechaColombiaDesdeIso, horaColombiaDesdeIso } from "@/lib/timezone-colombia";
import { formatearFechaLarga } from "@/lib/agenda-v2/fechas";
import { formatearHoraAmPm } from "@/lib/especialistas-flow-adaptador";

export interface CitaParaRecordatorioAmore {
  id: number;
  especialista_id: number;
  telefono_cliente: string | null;
  nombre_cliente: string;
  servicio: string;
  inicio: string;
}

export interface DepsRecordatorioAmore {
  especialistaPorId?: typeof especialistaPorId;
  enviarMensajeWhatsApp?: typeof enviarMensajeWhatsApp;
}

/** EXCLUSIVAMENTE los datos reales recibidos -- nunca inventa un profesional/fecha/hora/servicio. */
export function construirTextoRecordatorioAmore(params: {
  nombreCliente: string;
  servicio: string;
  profesionalNombre: string;
  fechaEtiqueta: string;
  horaTexto: string;
}): string {
  return (
    `¡Hola ${params.nombreCliente}! 💗 Te recordamos tu cita en AMORE:\n\n` +
    `Servicio: ${params.servicio}\n` +
    `Profesional: ${params.profesionalNombre}\n` +
    `Fecha: ${params.fechaEtiqueta}\n` +
    `Hora: ${params.horaTexto}\n\n` +
    `¡Te esperamos!`
  );
}

/**
 * Envía el recordatorio real de ESTA cita por el canal de AMORE. Nunca
 * lanza -- devuelve `false` si falta el profesional real (nunca se inventa
 * un nombre) o si el worker no pudo enviar; el caller (route.ts) decide qué
 * hacer (nunca marca recordatorio_enviado en ese caso, así la siguiente
 * pasada del cron puede reintentar sin duplicar nada).
 */
export async function enviarRecordatorioAmore(
  supabase: SupabaseClient,
  idTenant: string,
  cita: CitaParaRecordatorioAmore,
  deps: DepsRecordatorioAmore = {},
): Promise<boolean> {
  if (!cita.telefono_cliente) return false;
  const buscarEspecialista = deps.especialistaPorId ?? especialistaPorId;
  const enviar = deps.enviarMensajeWhatsApp ?? enviarMensajeWhatsApp;

  let especialista;
  try {
    especialista = await buscarEspecialista(supabase, cita.especialista_id);
  } catch (err) {
    console.error(`[amore-recordatorio] cita ${cita.id}: error técnico buscando al especialista real:`, err instanceof Error ? err.message : "error desconocido");
    return false;
  }
  if (!especialista) {
    console.error(`[amore-recordatorio] cita ${cita.id}: no se encontró el especialista real (${cita.especialista_id}) -- nunca se inventa un nombre, se omite este recordatorio`);
    return false;
  }

  const fechaIso = fechaColombiaDesdeIso(cita.inicio);
  const hora = horaColombiaDesdeIso(cita.inicio);
  const texto = construirTextoRecordatorioAmore({
    nombreCliente: cita.nombre_cliente,
    servicio: cita.servicio,
    profesionalNombre: especialista.nombre,
    fechaEtiqueta: formatearFechaLarga(fechaIso),
    horaTexto: formatearHoraAmPm(hora),
  });

  try {
    const resultado = await enviar({ tenantId: idTenant, telefono: cita.telefono_cliente, mensaje: texto, origen: "automatico" });
    return resultado.ok;
  } catch (err) {
    console.error(`[amore-recordatorio] cita ${cita.id}: error técnico enviando por el worker:`, err instanceof Error ? err.message : "error desconocido");
    return false;
  }
}
