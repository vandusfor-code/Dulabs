/**
 * IDs estables de botones de Daniela (Flow).
 * El runtime decide por ID, nunca por el texto visible del botón.
 * NO reutilizar los IDs LEGACY (opcion_spa / opcion_productos).
 */
export const DANIELA_BUTTON_IDS = {
  SERVICIOS_SPA: "servicios_spa",
  PRODUCTOS: "productos",
  HABLAR_CON_DANI: "hablar_con_dani",
  CONFIRMAR_CITA: "confirmar_cita",
  OTRO_HORARIO: "otro_horario",
  CANCELAR_CITA: "cancelar_cita",
  MANTENER_CITA: "mantener_cita",
  CONFIRMAR_CAMBIO: "confirmar_cambio",
  AGENDAR_ADICIONAL: "agendar_adicional",
  NO_AGENDAR_ADICIONAL: "no_agendar_adicional",
  // Objetivo 1 (rediseño, autorizado) — categorías reales verificadas contra
  // dulabs_especialistas (Manos: Daniela+Carla, Pies: Kelly, Pestañas: Nicol).
  // Ver categoriaMenuDesdeBotonId en lib/especialistas-flow-adaptador.ts.
  CATEGORIA_MANOS: "categoria_manos",
  CATEGORIA_PIES: "categoria_pies",
  CATEGORIA_PESTANAS: "categoria_pestanas",
} as const;

export type DanielaButtonId = (typeof DANIELA_BUTTON_IDS)[keyof typeof DANIELA_BUTTON_IDS];
