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
};

export type Datos = {
  negocio: string;
  especialista: { nombre: string; servicio: string; duracion_min: number };
  citas: Cita[];
};

export type Accion = "confirmar" | "rechazar" | "reagendar" | "editar" | "cancelar";
