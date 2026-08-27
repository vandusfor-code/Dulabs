// Etiquetas y color (tono de <Pill>) compartidos entre las páginas del
// Panel de Operaciones -- un solo lugar para no repetir el mapeo de los 5
// estados en cada pantalla.
export type PillTone = "neutral" | "success" | "warning" | "danger" | "info";

const LABELS: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_CONFIGURACION: "En configuración",
  EN_PRUEBAS: "En pruebas",
  ACTIVO: "Activo",
  REQUIERE_ATENCION: "Requiere atención",
};

const TONOS: Record<string, PillTone> = {
  PENDIENTE: "neutral",
  EN_CONFIGURACION: "info",
  EN_PRUEBAS: "warning",
  ACTIVO: "success",
  REQUIERE_ATENCION: "danger",
};

export function labelEstadoImplementacion(estado: string): string {
  return LABELS[estado] ?? estado;
}

export function toneEstadoImplementacion(estado: string): PillTone {
  return TONOS[estado] ?? "neutral";
}

const LABELS_ONBOARDING: Record<string, string> = {
  menu_enviado: "Bienvenida enviada",
  esperando_negocio: "Respondiendo pregunta 1",
  esperando_idea: "Respondiendo pregunta 2",
  esperando_adicional: "Respondiendo pregunta 3",
  completado: "Onboarding completo",
  soporte_solicitado: "Pidió soporte directo",
};

export function labelEstadoOnboarding(estado: string): string {
  return LABELS_ONBOARDING[estado] ?? estado;
}

const LABELS_PAGO: Record<string, string> = {
  activa: "Pagado",
  pendiente_pago: "Pendiente",
  vencida: "Vencida",
};

export function labelEstadoPago(estado: string): string {
  return LABELS_PAGO[estado] ?? estado;
}

export function toneEstadoPago(estado: string): PillTone {
  if (estado === "activa") return "success";
  if (estado === "pendiente_pago") return "warning";
  return "danger";
}
