// Fidelización (Fase 7, genérico para DuLabs, autorizado) — tipos
// compartidos por todo el módulo. AMORE es el primer tenant que lo usa,
// pero nada acá lo menciona: todo llega parametrizado por idTenant.

export type ReglaFidelizacion = {
  id: number;
  idTenant: string;
  servicioId: string;
  dias: number;
  activa: boolean;
  mensaje: string;
};

export type VisitaCompletada = {
  citaId: number;
  idTenant: string;
  servicioId: string;
  /** Nombre del servicio tal como quedó guardado en la cita (snapshot al momento de la visita, ver dulabs_citas_especialista.servicio) -- no el nombre actual del catálogo, que pudo cambiar desde entonces. */
  servicioNombre: string;
  phoneNumberId: string;
  telefonoCliente: string;
  nombreCliente: string;
  inicio: string;
};

export type CandidatoFidelizacion = {
  regla: ReglaFidelizacion;
  visita: VisitaCompletada;
  clienteId: number;
  nombreCliente: string;
  diasTranscurridos: number;
};

export type EstadoOportunidad = "pendiente" | "contactado" | "descartado";

/**
 * Fase 7 (autorizado) — lo que el motor entregaría más adelante a un
 * adaptador de mensajería (WhatsApp por QR, Fase 9). Ningún adaptador
 * existe todavía ni se implementa en esta fase -- este tipo solo documenta
 * el punto de extensión para no acoplar el motor a ningún proveedor.
 */
export type TareaMensajeSaliente = {
  oportunidadId: number;
  idTenant: string;
  telefonoCliente: string;
  mensaje: string;
};
