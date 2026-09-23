/**
 * AGENDA V2 -- ÚNICA decisión de "esta profesional no tiene días para ofrecer", compartida por los tres caminos que
 * llegaban a ella por separado (elegir profesional, "cambiar fecha"/"no puedo a esa hora" sin más horarios, y el
 * prellenado de la reserva desde Gemini). Antes cada camino respondía "No encontramos días disponibles…" sin importar
 * la causa, y dos de ellos dejaban la sesión en S3_DIA/S4_HORA con CERO opciones -- una trampa donde cualquier
 * mensaje respondía "Se perdió el menú".
 *
 * La respuesta depende de la causa REAL (ver causaSinDias en disponibilidad.ts):
 * - "sin_cupo": se verificó contra su agenda real y de verdad no hay espacio -> se dice exactamente eso.
 * - "no_confirmado": su calendario no se pudo leer -> NUNCA se afirma que no tiene agenda; se dice que no se pudo
 *   consultar (verdad) y se ofrece otra profesional o una persona.
 * - "calendario_no_configurado": no se puede verificar a NADIE -> se ofrece una persona (ofrecer otra profesional
 *   solo repetiría el mismo fallo).
 * En todos los casos la profesional que falló se excluye del menú: volver a ofrecerla solo crea un bucle.
 */
import type { CausaSinDias } from "@/lib/agenda-v2/disponibilidad";
import { HORIZONTE_DIAS_A_EVALUAR } from "@/lib/agenda-v2/disponibilidad";
import type { OpcionProfesionalAgendaV2 } from "@/lib/agenda-v2/profesionales";
import type { EspecialistaElegible } from "@/lib/asignacion-categoria";
import { construirOpcionesProfesional } from "@/lib/agenda-v2/profesionales";

/** Frase que de verdad activa la atención humana de AMORE (detectarSolicitudAtencionHumana, lib/amore-entrada-gemini.ts). */
export const FRASE_PEDIR_PERSONA = "hablar con una persona";

export type DecisionSinDias =
  | { accion: "ofrecer_otras"; opciones: OpcionProfesionalAgendaV2[]; mensaje: string }
  | { accion: "sin_alternativas"; mensaje: string };

function listaNumerada(opciones: OpcionProfesionalAgendaV2[]): string {
  return opciones.map((o) => `${o.numero}. ${o.nombre}`).join("\n");
}

export function decidirSinDiasParaProfesional(params: {
  causa: CausaSinDias;
  profesional: { id: number; nombre: string };
  elegibles: EspecialistaElegible[];
  /** Solo AMORE tiene el mecanismo real de atención humana -- para otros tenants nunca se promete. */
  ofrecerAtencionHumana: boolean;
}): DecisionSinDias {
  const { causa, profesional } = params;
  const otras = construirOpcionesProfesional(params.elegibles.filter((e) => e.especialistaId !== profesional.id));
  const salidaPersona = params.ofrecerAtencionHumana ? `escribe *${FRASE_PEDIR_PERSONA}* y te ayudamos directamente 💗` : "escribe *cancelar* y vuelve a intentarlo más tarde.";

  if (causa === "calendario_no_configurado") {
    return {
      accion: "sin_alternativas",
      mensaje: `En este momento no pude consultar la agenda 😔 Para no darte información equivocada, ${salidaPersona}`,
    };
  }

  const encabezado =
    causa === "no_confirmado"
      ? `En este momento no pude consultar la agenda de ${profesional.nombre} 😔 Para no darte información equivocada`
      : `${profesional.nombre} no tiene espacios libres en los próximos ${HORIZONTE_DIAS_A_EVALUAR} días 😔`;

  if (otras.length === 0) {
    const union = causa === "no_confirmado" ? ", " : " Si quieres, ";
    return { accion: "sin_alternativas", mensaje: `${encabezado}${union}${salidaPersona}` };
  }

  const invitacion = causa === "no_confirmado" ? ", puedes elegir a otra profesional:" : " ¿Te gustaría con alguna de ellas?";
  const cierre = params.ofrecerAtencionHumana ? `\n\nO escribe *${FRASE_PEDIR_PERSONA}* y te ayudamos directamente.` : "";
  return { accion: "ofrecer_otras", opciones: otras, mensaje: `${encabezado}${invitacion}\n\n${listaNumerada(otras)}${cierre}` };
}

/** Línea de log accionable (nunca datos sensibles: ids internos + motivo técnico). */
export function lineaLogSinDias(params: {
  causa: CausaSinDias;
  idTenant: string;
  profesionalId: number;
  diasNoConfirmados?: number;
  detalleNoConfirmado?: string;
}): string {
  return `[agenda-v2] sin días para ofrecer -- causa=${params.causa} tenant=${params.idTenant} profesional=${params.profesionalId} dias_no_confirmados=${params.diasNoConfirmados ?? 0} detalle=${params.detalleNoConfirmado ?? "-"}`;
}
