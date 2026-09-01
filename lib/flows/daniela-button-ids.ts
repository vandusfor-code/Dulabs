/**
 * IDs estables de botones de Daniela (Flow).
 * El runtime decide por ID, nunca por el texto visible del botón.
 * NO reutilizar los IDs LEGACY (opcion_spa / opcion_productos).
 */
export const DANIELA_BUTTON_IDS = {
  SERVICIOS_SPA: "servicios_spa",
  PRODUCTOS: "productos",
  CONFIRMAR_CITA: "confirmar_cita",
  OTRO_HORARIO: "otro_horario",
  CANCELAR_CITA: "cancelar_cita",
  MANTENER_CITA: "mantener_cita",
  CONFIRMAR_CAMBIO: "confirmar_cambio",
} as const;

export type DanielaButtonId = (typeof DANIELA_BUTTON_IDS)[keyof typeof DANIELA_BUTTON_IDS];
