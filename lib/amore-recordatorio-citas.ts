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
// Fase 3 (autorizado, multi-servicio) -- lista real de servicios de esta
// cita (dulabs_cita_servicios, lib/agenda-v2/multi-servicio.ts). Devuelve
// [] para una cita de un solo servicio -- en ese caso el recordatorio sigue
// usando cita.servicio TAL CUAL, comportamiento 100% idéntico al de antes.
import { obtenerNombresServiciosDeCita } from "@/lib/agenda-v2/multi-servicio";
// Corrección post-deploy (auditoría real, autorizado) -- nombre ACTUAL del
// cliente, para nunca quedarse con el valor de nombre_cliente congelado en
// el momento de crear la cita (que puede ser el teléfono crudo si en ese
// instante el nombre real todavía no era conocido). Misma clave EXACTA que
// usa el resto del canal WhatsApp-QR de AMORE (whatsapp-qr:<tenant_id>, ver
// phoneNumberIdSintetico en lib/agenda-v2/router.ts/lib/amore-entrada-router.ts).
import { nombreConocido } from "@/lib/clientes-conocidos";

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
  obtenerNombresServiciosDeCita?: typeof obtenerNombresServiciosDeCita;
  buscarNombreConocido?: typeof nombreConocido;
}

/** Un valor que son solo dígitos (con o sin "+" inicial) de longitud real de teléfono -- nunca se muestra como si fuera el nombre de una clienta. */
function pareceTelefono(valor: string): boolean {
  return /^\+?\d{7,}$/.test(valor.trim());
}

/**
 * EXCLUSIVAMENTE los datos reales recibidos -- nunca inventa un
 * profesional/fecha/hora/servicio. `servicios` con 1 elemento produce el
 * MISMO texto exacto de siempre ("Servicio: {nombre}"); con más de uno,
 * pasa a una lista -- el resto del mensaje no cambia. `nombreCliente` vacío
 * (nunca se pudo resolver un nombre real, ni siquiera el congelado en la
 * cita, sección NOMBRE del pedido de corrección) usa un saludo genérico --
 * NUNCA muestra un teléfono como si fuera un nombre.
 */
export function construirTextoRecordatorioAmore(params: {
  nombreCliente: string;
  servicios: string[];
  profesionalNombre: string;
  fechaEtiqueta: string;
  horaTexto: string;
}): string {
  const lineaServicios = params.servicios.length === 1 ? `Servicio: ${params.servicios[0]}` : `Servicios:\n${params.servicios.map((s) => `- ${s}`).join("\n")}`;
  const saludo = params.nombreCliente.trim() ? `¡Hola ${params.nombreCliente}! 💗` : `¡Hola! 💗`;
  return (
    `${saludo} Te recordamos tu cita en AMORE:\n\n` +
    `${lineaServicios}\n` +
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
  const buscarNombresServicios = deps.obtenerNombresServiciosDeCita ?? obtenerNombresServiciosDeCita;
  const buscarNombreActual = deps.buscarNombreConocido ?? nombreConocido;

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

  // Fase 3 (autorizado, multi-servicio) -- si la cita tiene más de un
  // servicio real (dulabs_cita_servicios), se listan todos; si no (o si la
  // consulta falla), se usa cita.servicio TAL CUAL -- comportamiento 100%
  // idéntico al de antes de esta fase. Nunca bloquea el recordatorio por un
  // problema leyendo la lista de servicios.
  let nombresServicios: string[] = [];
  try {
    nombresServicios = await buscarNombresServicios(supabase, cita.id);
  } catch (err) {
    console.error(`[amore-recordatorio] cita ${cita.id}: error técnico leyendo servicios múltiples -- se usa el servicio único de la cita:`, err instanceof Error ? err.message : "error desconocido");
  }
  const servicios = nombresServicios.length > 0 ? nombresServicios : [cita.servicio];

  // Corrección post-deploy (autorizado) -- nombre ACTUAL y real, nunca el
  // valor congelado en nombre_cliente si es mejorable. Prioridad: (1) nombre
  // vivo en dulabs_clientes_conocidos bajo la clave sintética real de AMORE;
  // (2) nombre_cliente de la cita, SOLO si claramente no es un teléfono; (3)
  // saludo genérico -- NUNCA se muestra un número de teléfono como nombre.
  // Best-effort: un fallo consultando el nombre actual nunca bloquea el
  // envío, cae al mismo criterio (2)/(3) de arriba.
  let nombreActual: string | null = null;
  try {
    nombreActual = await buscarNombreActual(supabase, `whatsapp-qr:${idTenant}`, cita.telefono_cliente);
  } catch (err) {
    console.error(`[amore-recordatorio] cita ${cita.id}: error técnico consultando el nombre actual del cliente -- se usa el fallback disponible:`, err instanceof Error ? err.message : "error desconocido");
  }
  const nombreParaSaludo = nombreActual ?? (pareceTelefono(cita.nombre_cliente) ? "" : cita.nombre_cliente);

  const fechaIso = fechaColombiaDesdeIso(cita.inicio);
  const hora = horaColombiaDesdeIso(cita.inicio);
  const texto = construirTextoRecordatorioAmore({
    nombreCliente: nombreParaSaludo,
    servicios,
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
