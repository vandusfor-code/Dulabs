/**
 * AGENDA V2 (autorizado) — FASE 8: gestión de citas existentes (consultar,
 * cancelar, reprogramar). Lógica de presentación PURA, mismo patrón que
 * confirmacion.ts/horas.ts: nunca hace I/O, nunca inventa datos -- solo
 * formatea lo que router.ts ya resolvió con datos reales, y resuelve la
 * respuesta del cliente CONTRA las opciones ya guardadas (número exacto,
 * nunca fuzzy, nunca "sí"/"dale"/interpretación semántica).
 *
 * Reutiliza formatearPrecioCop (lib/especialistas-flow-adaptador.ts) y
 * formatearDuracion (lib/catalogo-servicios-flow-adaptador.ts), igual que
 * confirmacion.ts.
 */
import { formatearPrecioCop } from "@/lib/especialistas-flow-adaptador";
import { formatearDuracion } from "@/lib/catalogo-servicios-flow-adaptador";

export const MENSAJE_SIN_CITAS_FUTURAS = "No encontramos citas futuras a tu nombre. 💗";

/** Defensivo -- no se pudieron cargar los datos completos y reales de una cita (ej. el especialista/servicio ya no existe). Nunca inventa datos faltantes: informa y no avanza. */
export const MENSAJE_ERROR_TECNICO_GESTION = "Ups 😔 Tuvimos un problema técnico procesando tu solicitud. Por favor intenta de nuevo en un momento.";

// --- Identificación de la cita (menú "encontré estas citas") ---------------

export interface OpcionCitaAgendaV2 {
  numero: number;
  citaId: number;
  servicioNombre: string;
  profesionalNombre: string;
  fechaEtiqueta: string;
  horaTexto: string;
}

export interface CitaParaMenu {
  citaId: number;
  servicioNombre: string;
  profesionalNombre: string;
  fechaEtiqueta: string;
  horaTexto: string;
}

/** Numera EXACTAMENTE las citas reales ya resueltas (orden ya cronológico, ver consultarCitasActivasEspecialista) -- nunca inventa, nunca reordena. */
export function construirOpcionesCita(citas: CitaParaMenu[]): OpcionCitaAgendaV2[] {
  return citas.map((c, i) => ({ numero: i + 1, ...c }));
}

function listaOpcionesCitas(opciones: OpcionCitaAgendaV2[]): string {
  return opciones.map((o) => `${o.numero}. ${o.servicioNombre} — ${o.profesionalNombre}\n   ${o.fechaEtiqueta} · ${o.horaTexto}`).join("\n\n");
}

export function renderizarMenuCitas(opciones: OpcionCitaAgendaV2[]): string {
  return `💗 Encontré estas citas:\n\n${listaOpcionesCitas(opciones)}\n\nSelecciona la cita que deseas gestionar.`;
}

export function textoSeleccionInvalidaCitas(opciones: OpcionCitaAgendaV2[]): string {
  return `No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n${listaOpcionesCitas(opciones)}`;
}

/** Mismo criterio EXACTO que el resto de Agenda V2: solo número exacto contra las opciones ya mostradas. */
export function resolverSeleccionCita(mensaje: string, opciones: OpcionCitaAgendaV2[]): OpcionCitaAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}

// --- Consultar ---------------------------------------------------------

export interface ResumenCitaGestion {
  servicioNombre: string;
  profesionalNombre: string;
  fechaEtiqueta: string;
  horaTexto: string;
  duracionMin: number;
  precio: number;
  /** Estado real de dulabs_citas_especialista -- nunca inventado, nunca traducido a un estado que no exista en el sistema. */
  estado: "pendiente" | "confirmada";
}

const ETIQUETA_ESTADO: Record<ResumenCitaGestion["estado"], string> = {
  pendiente: "Pendiente de aprobación",
  confirmada: "Confirmada",
};

export function renderizarConsultaCita(resumen: ResumenCitaGestion): string {
  return (
    `💗 Esta es tu próxima cita:\n\n` +
    `Servicio: ${resumen.servicioNombre}\n` +
    `Profesional: ${resumen.profesionalNombre}\n` +
    `Fecha: ${resumen.fechaEtiqueta}\n` +
    `Hora: ${resumen.horaTexto}\n` +
    `Duración: ${formatearDuracion(resumen.duracionMin)}\n` +
    `Valor: ${formatearPrecioCop(resumen.precio)}\n` +
    `Estado: ${ETIQUETA_ESTADO[resumen.estado]}`
  );
}

// --- Confirmación binaria (Sí/No) -- reutilizada por cancelar y por el "inicio" de reprogramar ---

export type AccionSiNo = "si" | "no";

export interface OpcionSiNoAgendaV2 {
  numero: number;
  accion: AccionSiNo;
}

export const OPCIONES_SI_NO: OpcionSiNoAgendaV2[] = [
  { numero: 1, accion: "si" },
  { numero: 2, accion: "no" },
];

export function textoSeleccionInvalidaSiNo(): string {
  return "No reconocí esa opción 💗 Por favor responde con el número de una de estas:\n\n1. Sí\n2. No";
}

/** Mismo criterio EXACTO del resto de Agenda V2: solo número exacto (1-2), nunca "sí"/"no"/"dale" en texto libre. */
export function resolverSeleccionSiNo(mensaje: string, opciones: OpcionSiNoAgendaV2[]): OpcionSiNoAgendaV2 | undefined {
  const texto = mensaje.trim();
  if (!/^\d+$/.test(texto)) return undefined;
  const numero = Number(texto);
  return opciones.find((o) => o.numero === numero);
}

// --- Cancelar ---------------------------------------------------------

interface ResumenCitaCorta {
  servicioNombre: string;
  profesionalNombre: string;
  fechaEtiqueta: string;
  horaTexto: string;
}

export function renderizarConfirmacionCancelar(resumen: ResumenCitaCorta): string {
  return (
    `💗 Vas a cancelar esta cita:\n\n` +
    `Servicio: ${resumen.servicioNombre}\n` +
    `Profesional: ${resumen.profesionalNombre}\n` +
    `Fecha: ${resumen.fechaEtiqueta}\n` +
    `Hora: ${resumen.horaTexto}\n\n` +
    `¿Deseas cancelar esta cita?\n\n1. Sí, cancelar\n2. No, conservar cita`
  );
}

export const MENSAJE_CITA_CANCELADA = "Tu cita fue cancelada correctamente. 💗";
export const MENSAJE_ERROR_CANCELACION = "No pudimos cancelar tu cita en este momento. Por favor intenta nuevamente.";
export const MENSAJE_CANCELACION_ABANDONADA = "Perfecto, tu cita se mantiene tal cual estaba. 💗";

// --- Reprogramar --------------------------------------------------------

export function renderizarConfirmacionReprogramarInicio(resumen: ResumenCitaCorta): string {
  return (
    `💗 Esta es tu cita actual:\n\n` +
    `Servicio: ${resumen.servicioNombre}\n` +
    `Profesional: ${resumen.profesionalNombre}\n` +
    `Fecha: ${resumen.fechaEtiqueta}\n` +
    `Hora: ${resumen.horaTexto}\n\n` +
    `¿Deseas reprogramarla?\n\n1. Sí, reprogramar\n2. No, mantener cita`
  );
}

export const MENSAJE_REPROGRAMACION_ABANDONADA = "Perfecto, tu cita se mantiene tal cual estaba. 💗";
export const MENSAJE_ERROR_REPROGRAMACION = "No pudimos reprogramar tu cita en este momento. Por favor intenta nuevamente.";

export interface ResumenCitaReprogramada {
  servicioNombre: string;
  profesionalNombre: string;
  fechaEtiqueta: string;
  horaTexto: string;
}

export function renderizarReprogramacionExitosa(resumen: ResumenCitaReprogramada): string {
  return (
    `¡Listo! 💗 Tu cita fue reprogramada.\n\n` +
    `Servicio: ${resumen.servicioNombre}\n` +
    `Profesional: ${resumen.profesionalNombre}\n` +
    `Nueva fecha: ${resumen.fechaEtiqueta}\n` +
    `Nueva hora: ${resumen.horaTexto}\n\n` +
    `Te esperamos.`
  );
}
