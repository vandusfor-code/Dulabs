// Confirmaciones y recordatorios (Fase 8, genérico para DuLabs, autorizado)
// — tipos compartidos por todo el módulo. AMORE es el primer tenant que lo
// usa, pero nada acá lo menciona: todo llega parametrizado por idTenant.

export type TipoComunicacion = "confirmacion" | "recordatorio";

export type ConfigComunicaciones = {
  idTenant: string;
  confirmacionActiva: boolean;
  confirmacionMensaje: string;
  recordatorioActivo: boolean;
  recordatorioAnticipacionHoras: number;
  recordatorioMensaje: string;
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
