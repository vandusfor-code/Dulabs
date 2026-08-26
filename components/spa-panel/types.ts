export type EstadoCita = "pendiente" | "confirmada" | "rechazada" | "cancelada" | "propuesta";

export type Cita = {
  id: number;
  nombre_cliente: string;
  telefono_cliente: string | null;
  servicio: string;
  inicio: string;
  fin: string;
  estado: EstadoCita;
  origen: string;
  especialista_id: number;
  /** Quién atiende esta cita de verdad -- varias personas comparten el
   * mismo link/número (ver especialistasDelMismaPersona en el backend), así
   * que nunca asumir que es el dueño del token. */
  profesional: string;
};

export type MiembroEquipo = { id: number; nombre: string };

export type Datos = {
  negocio: string;
  especialista: { nombre: string; servicio: string; duracion_min: number };
  equipo: MiembroEquipo[];
  citas: Cita[];
};

export type Accion = "confirmar" | "rechazar" | "reagendar" | "editar" | "cancelar";
