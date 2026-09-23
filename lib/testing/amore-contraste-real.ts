// Contraste de una respuesta del bot de AMORE contra el ESTADO REAL (sesión de Agenda V2 + agenda real con Nylas).
// Compartido por los dos harness de prueba real (scripts/amore-conversacion-real.mts -- bot DESPLEGADO por WhatsApp --
// y scripts/amore-pipeline-real.mts -- código de ESTA rama contra datos reales). Solo lectura.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";
import type { DepsDisponibilidadNylas } from "@/lib/disponibilidad-servicio-nylas";
import { calcularDiasCandidatosReales, calcularHorariosParaFecha, causaSinDias } from "@/lib/agenda-v2/disponibilidad";

export type SesionAgendaReal = {
  step: string;
  servicio_id: string | null;
  profesional_id: number | null;
  fecha_iso: string | null;
  opciones_mostradas: unknown;
  telefono_cliente: string;
} | null;

const ultimos10 = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);

export async function sesionAgendaReal(supabase: SupabaseClient, telefono: string): Promise<SesionAgendaReal> {
  const { data } = await supabase
    .from("dulabs_agenda_v2_sesiones")
    .select("step, servicio_id, profesional_id, fecha_iso, opciones_mostradas, telefono_cliente, activo")
    .eq("tenant_id", AMORE_TENANT_ID)
    .eq("activo", true);
  return ((data ?? []).find((s) => ultimos10(s.telefono_cliente as string) === ultimos10(telefono)) as SesionAgendaReal) ?? null;
}

/**
 * Devuelve los fallos (vacío = la respuesta coincide con la realidad) y va imprimiendo las verificaciones que pasan.
 * (a) "sin días / no pude consultar" para una profesional -> la agenda real debe darle la razón.
 * (b) días ofrecidos -> cada uno con horarios reales.  (c) horas ofrecidas -> todas libres en la agenda real.
 */
export async function contrastarConAgendaReal(
  supabase: SupabaseClient,
  nylasDeps: DepsDisponibilidadNylas,
  respuestas: string[],
  sesion: SesionAgendaReal,
  sesionAnterior: SesionAgendaReal,
  log: (linea: string) => void = console.log,
): Promise<string[]> {
  const fallos: string[] = [];
  const texto = respuestas.join("\n");
  const servicioId = sesion?.servicio_id ?? sesionAnterior?.servicio_id;

  if (/No encontramos días|no tiene espacios libres|no pude consultar la agenda/i.test(texto) && servicioId) {
    const opciones = (sesionAnterior?.opciones_mostradas as { profesionalId?: number; nombre?: string }[] | null) ?? [];
    const candidata = Array.isArray(opciones) ? (opciones.find((o) => o.nombre && texto.includes(o.nombre)) ?? opciones.find((o) => o.profesionalId === sesionAnterior?.profesional_id)) : undefined;
    if (candidata?.profesionalId) {
      const real = await calcularDiasCandidatosReales(supabase, { idTenant: AMORE_TENANT_ID, servicioId, profesionalId: candidata.profesionalId }, nylasDeps);
      if (real.ok && real.opciones.length > 0) {
        fallos.push(`dijo que ${candidata.nombre} no tiene días, pero la agenda REAL tiene: ${real.opciones.map((o) => o.fechaIso).join(", ")}`);
      } else if (real.ok) {
        const causa = causaSinDias(real);
        const dijoNoConsultar = /no pude consultar/i.test(texto);
        if (causa === "sin_cupo" && dijoNoConsultar) fallos.push(`dijo "no pude consultar" pero la agenda de ${candidata.nombre} se leyó bien y está llena`);
        else if (causa !== "sin_cupo" && !dijoNoConsultar) fallos.push(`presentó un error de integración (${causa}) como falta de disponibilidad de ${candidata.nombre}`);
        else log(`   ✓ contraste: ${candidata.nombre} sin días -- causa real: ${causa}${real.detalleNoConfirmado ? ` (${real.detalleNoConfirmado})` : ""}`);
      }
    }
  }

  if (sesion?.step === "S3_DIA" && servicioId && sesion.profesional_id) {
    const ofrecidos = ((sesion.opciones_mostradas as { opciones?: { fechaIso: string }[] } | null)?.opciones ?? []).map((o) => o.fechaIso);
    const antes = fallos.length;
    for (const fecha of ofrecidos) {
      const horas = await calcularHorariosParaFecha(supabase, { idTenant: AMORE_TENANT_ID, servicioId, profesionalId: sesion.profesional_id, fechaIso: fecha }, nylasDeps);
      if (!horas.ok) fallos.push(`ofreció el día ${fecha} pero la agenda REAL no tiene horarios (${horas.motivo})`);
    }
    if (ofrecidos.length > 0 && fallos.length === antes) log(`   ✓ contraste: los ${ofrecidos.length} días ofrecidos (${ofrecidos.join(", ")}) tienen horarios reales`);
  }

  if (sesion?.step === "S4_HORA" && servicioId && sesion.profesional_id && sesion.fecha_iso) {
    const ofrecidas = ((sesion.opciones_mostradas as { opciones?: { hora: string }[] } | null)?.opciones ?? []).map((o) => o.hora);
    const horas = await calcularHorariosParaFecha(supabase, { idTenant: AMORE_TENANT_ID, servicioId, profesionalId: sesion.profesional_id, fechaIso: sesion.fecha_iso }, nylasDeps);
    const libres = horas.ok ? horas.horarios : [];
    const invalidas = ofrecidas.filter((h) => !libres.includes(h));
    if (invalidas.length > 0) fallos.push(`ofreció horas que la agenda REAL no tiene libres: ${invalidas.join(", ")}`);
    else if (ofrecidas.length > 0) log(`   ✓ contraste: las ${ofrecidas.length} horas ofrecidas (${ofrecidas.join(", ")}) están libres en la agenda real`);
  }
  return fallos;
}
