// Confirmaciones y recordatorios (Fase 8, genérico para DuLabs, autorizado)
// — tipos compartidos por todo el módulo. AMORE es el primer tenant que lo
// usa, pero nada acá lo menciona: todo llega parametrizado por idTenant.

export type TipoComunicacion = "confirmacion" | "recordatorio";

/** Valores válidos de anticipación real (minutos) -- los únicos que el motor (app/api/cron/recordatorios-citas) sabe interpretar. */
export const ANTICIPACIONES_RECORDATORIO_MINUTOS = [15, 30, 60, 120, 180, 360, 720, 1440, 2880] as const;
export type AnticipacionRecordatorioMinutos = (typeof ANTICIPACIONES_RECORDATORIO_MINUTOS)[number];

/** Etiquetas legibles de las 9 opciones -- ÚNICA fuente de verdad para toda pantalla (desktop admin, móvil AMORE) que muestre o edite la anticipación, nunca duplicada por pantalla. */
export const ETIQUETAS_ANTICIPACION_MINUTOS: Record<AnticipacionRecordatorioMinutos, string> = {
  15: "15 minutos antes",
  30: "30 minutos antes",
  60: "1 hora antes",
  120: "2 horas antes",
  180: "3 horas antes",
  360: "6 horas antes",
  720: "12 horas antes",
  1440: "1 día antes",
  2880: "2 días antes",
};

export type ConfigComunicaciones = {
  idTenant: string;
  confirmacionActiva: boolean;
  confirmacionMensaje: string;
  recordatorioActivo: boolean;
  /** @deprecated nunca tuvo efecto real en el motor -- se conserva solo por compatibilidad de lectura, usar recordatorioAnticipacionMinutos. */
  recordatorioAnticipacionHoras: number;
  /** Minutos antes de la cita en que el motor real envía el recordatorio -- ver ANTICIPACIONES_RECORDATORIO_MINUTOS. */
  recordatorioAnticipacionMinutos: AnticipacionRecordatorioMinutos;
  recordatorioMensaje: string;
  /**
   * true SOLO si ya existe una fila real en dulabs_comunicaciones_config
   * para este tenant -- false cuando confirmacionMensaje/recordatorioMensaje
   * son simplemente el predeterminado que rellena el campo para mostrarlo en
   * el admin (nunca una personalización real guardada). Mejora Recordatorios
   * (autorizado) -- usado por lib/amore-recordatorio-citas.ts para decidir
   * si el motor real debe usar el mensaje configurado o el texto histórico
   * de siempre (evita que, el día del deploy, TODOS los recordatorios de
   * AMORE cambien de texto de golpe sin que nadie haya guardado nada todavía).
   */
  tieneConfiguracionGuardada: boolean;
};

export type CitaComunicable = {
  citaId: number;
  idTenant: string;
  telefonoCliente: string;
  nombreCliente: string;
  servicio: string;
  profesionalNombre: string;
  inicio: string;
  fin: string;
};

export type VariablesMensaje = {
  nombre: string;
  servicio: string;
  profesional: string;
  fecha: string;
  hora: string;
};

/**
 * Lo que el motor entregaría a un adaptador de canal real (WhatsApp por QR,
 * Fase 9). Ningún adaptador real existe todavía -- este tipo documenta el
 * punto de extensión para no acoplar el motor a ningún proveedor.
 */
export type TareaComunicacion = {
  idTenant: string;
  citaId: number;
  tipo: TipoComunicacion;
  telefonoCliente: string;
  mensaje: string;
};

/** Adaptador de canal de salida -- en esta fase SIEMPRE un simulador (ver adaptador.ts). Fase 9 la reemplaza por WhatsApp-QR sin tocar el motor. */
export type AdaptadorCanal = (tarea: TareaComunicacion) => Promise<void>;
